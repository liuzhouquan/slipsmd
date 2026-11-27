import { StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import MarkdownIt from 'markdown-it'
import katex from 'katex'

const markdown = new MarkdownIt({ html: false, linkify: false })
function active(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((range) => {
    const start = state.doc.lineAt(range.from).from
    const end = state.doc.lineAt(range.to).to
    return start <= to && end >= from
  })
}
function reveal(view: EditorView, from: number) {
  view.dispatch({ selection: { anchor: from }, scrollIntoView: true })
  view.focus()
}
class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly from: number,
  ) {
    super()
  }
  eq(other: TableWidget) {
    return other.text === this.text && other.from === this.from
  }
  toDOM(view: EditorView) {
    const el = document.createElement('div')
    el.className = 'md-table-preview'
    el.innerHTML = markdown.render(this.text)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'preview-edit'
    button.textContent = '编辑表格'
    button.addEventListener('click', (e) => {
      e.preventDefault()
      reveal(view, this.from)
    })
    el.append(button)
    el.addEventListener('dblclick', () => reveal(view, this.from))
    return el
  }
  ignoreEvent() {
    return true
  }
}
class MathWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly display: boolean,
    readonly from: number,
  ) {
    super()
  }
  eq(other: MathWidget) {
    return other.text === this.text && other.display === this.display && other.from === this.from
  }
  toDOM(view: EditorView) {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = 'md-math-preview'
    katex.render(this.text, el, {
      displayMode: this.display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
    })
    el.title = '点击编辑公式'
    el.addEventListener('click', () => reveal(view, this.from))
    return el
  }
  ignoreEvent() {
    return true
  }
}
class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
    readonly readOnly: boolean,
  ) {
    super()
  }
  eq(other: TaskWidget) {
    return (
      other.checked === this.checked && other.from === this.from && other.readOnly === this.readOnly
    )
  }
  toDOM(view: EditorView) {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.checked = this.checked
    el.setAttribute('aria-label', this.checked ? '标记任务未完成' : '标记任务完成')
    el.disabled = view.state.readOnly
    el.addEventListener('change', () =>
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: el.checked ? '[x]' : '[ ]' },
      }),
    )
    return el
  }
  ignoreEvent() {
    return true
  }
}
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly from: number,
    readonly file: string,
  ) {
    super()
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.file === this.file && other.from === this.from
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = 'md-image-preview'
    const img = document.createElement('img')
    img.alt = this.alt
    img.loading = 'lazy'
    el.append(img)
    const label = document.createElement('span')
    label.className = 'image-caption'
    label.textContent = this.alt
    el.append(label)
    const failed = () => {
      label.textContent = '图片无法加载 · 点击查看路径'
      el.classList.add('image-error')
    }
    img.addEventListener('load', () => view.requestMeasure())
    img.addEventListener('error', failed)
    if (/^https?:\/\//i.test(this.src)) img.src = this.src
    else
      void window.inkisle
        .image(this.file, this.src)
        .then((url) => {
          img.src = url
        })
        .catch(failed)
    el.title = '点击编辑图片链接'
    el.addEventListener('click', () => reveal(view, this.from))
    return el
  }
  ignoreEvent() {
    return true
  }
}
export function livePreview(file: string) {
  return StateField.define<DecorationSet>({
    create: (state) => decorations(state, file),
    update: (value, tr) =>
      tr.docChanged ||
      tr.selection ||
      tr.reconfigured ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
        ? decorations(tr.state, file)
        : value,
    provide: (field) => EditorView.decorations.from(field),
  })
}
function decorations(state: EditorState, file: string): DecorationSet {
  const ranges: { from: number; to: number; decoration: Decoration }[] = []
  const replaced: [number, number][] = []
  const code: [number, number][] = []
  const add = (from: number, to: number, decoration: Decoration) => {
    ranges.push({ from, to, decoration })
  }
  const overlaps = (list: [number, number][], from: number, to: number) =>
    list.some(([a, b]) => a < to && b > from)
  syntaxTree(state).iterate({
    enter: (node) => {
      if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name))
        code.push([node.from, node.to])
    },
  })
  // Block replacements live in a StateField because they change the document's measured height.
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    if (!line.text.trim() && !active(state, line.from, line.to))
      add(line.from, line.from, Decoration.line({ class: 'md-blank' }))
    if (overlaps(code, line.from, line.to)) continue
    if (
      /^<!-- inkisle-(capture|archived|from):.*-->$/.test(line.text) &&
      !active(state, line.from, line.to)
    )
      add(line.from, line.to, Decoration.replace({}))
    if (line.text.trim() === '$$') {
      let end = n + 1
      while (end <= state.doc.lines && state.doc.line(end).text.trim() !== '$$') end++
      if (end <= state.doc.lines) {
        const last = state.doc.line(end)
        if (!active(state, line.from, last.to)) {
          const text = state.doc.sliceString(line.to + 1, last.from).trim()
          add(
            line.from,
            last.to,
            Decoration.replace({ widget: new MathWidget(text, true, line.from), block: true }),
          )
          replaced.push([line.from, last.to])
        }
        n = end
        continue
      }
    }
    if (
      n < state.doc.lines &&
      line.text.includes('|') &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(state.doc.line(n + 1).text)
    ) {
      let end = n + 1
      while (
        end < state.doc.lines &&
        state.doc.line(end + 1).text.includes('|') &&
        state.doc.line(end + 1).text.trim()
      )
        end++
      const last = state.doc.line(end)
      if (!active(state, line.from, last.to)) {
        add(
          line.from,
          last.to,
          Decoration.replace({
            widget: new TableWidget(state.doc.sliceString(line.from, last.to), line.from),
            block: true,
          }),
        )
        replaced.push([line.from, last.to])
      }
      n = end
    }
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      const { from, to, name } = node
      if (replaced.some(([a, b]) => from >= a && to <= b)) return false
      if (/^ATXHeading[1-6]$/.test(name))
        add(
          state.doc.lineAt(from).from,
          state.doc.lineAt(from).from,
          Decoration.line({ class: 'md-h' + name.slice(-1) }),
        )
      if (name === 'Blockquote') {
        for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++)
          add(
            state.doc.line(n).from,
            state.doc.line(n).from,
            Decoration.line({ class: 'md-quote' }),
          )
      }
      if (name === 'TaskMarker' && !active(state, from, to))
        add(
          from,
          to,
          Decoration.replace({
            widget: new TaskWidget(
              /x/i.test(state.doc.sliceString(from, to)),
              from,
              to,
              state.readOnly,
            ),
          }),
        )
      if (name === 'StrongEmphasis') add(from, to, Decoration.mark({ class: 'md-strong' }))
      if (name === 'Emphasis') add(from, to, Decoration.mark({ class: 'md-emphasis' }))
      if (name === 'Strikethrough') add(from, to, Decoration.mark({ class: 'md-strike' }))
      if (name === 'InlineCode') add(from, to, Decoration.mark({ class: 'md-inline-code' }))
      if (
        ['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'QuoteMark'].includes(
          name,
        ) &&
        !active(state, from, to)
      )
        add(from, to, Decoration.replace({}))
      if (name === 'Link' && !active(state, from, to)) {
        const raw = state.doc.sliceString(from, to)
        const match = /^\[([^\]]+)\]\(([^\s]+)(?:\s+"[^"]*")?\)$/.exec(raw)
        if (match) {
          add(from, from + 1, Decoration.replace({}))
          add(
            from + 1,
            from + 1 + match[1].length,
            Decoration.mark({
              class: 'md-link',
              attributes: { 'data-href': match[2], title: match[2] + ' · Ctrl+点击在新窗口打开' },
            }),
          )
          add(from + 1 + match[1].length, to, Decoration.replace({}))
        }
      }
      if (name === 'Image' && !active(state, from, to)) {
        const match = /^!\[([^\]]*)\]\(([^\s]+)(?:\s+"[^"]*")?\)$/.exec(
          state.doc.sliceString(from, to),
        )
        if (match) {
          add(
            from,
            to,
            Decoration.replace({ widget: new ImageWidget(match[2], match[1], from, file) }),
          )
          return false
        }
      }
    },
  })
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    if (
      active(state, line.from, line.to) ||
      overlaps(replaced, line.from, line.to) ||
      overlaps(code, line.from, line.to)
    )
      continue
    for (const match of line.text.matchAll(/(?<![\\$])\$([^$\n]+)\$(?!\$)/g)) {
      const from = line.from + match.index!
      add(
        from,
        from + match[0].length,
        Decoration.replace({ widget: new MathWidget(match[1], false, from) }),
      )
    }
  }
  return Decoration.set(
    ranges.map((r) => r.decoration.range(r.from, r.to)),
    true,
  )
}
