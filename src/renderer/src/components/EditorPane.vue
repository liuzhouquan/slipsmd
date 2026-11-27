<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { EditorState, Compartment, Prec } from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  drawSelection,
  dropCursor,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
} from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap, type CompletionContext } from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'
import { livePreview } from '../editor/preview'
import type { DocumentSnapshot } from '../../../shared/types'
import Icon from './Icon.vue'
import 'katex/dist/katex.min.css'
const props = defineProps<{ document: DocumentSnapshot; files?: string[] }>()
const emit = defineEmits<{
  saved: [doc: DocumentSnapshot]
  change: [path: string, dirty: boolean]
  link: [path: string, href: string, newWindow: boolean]
}>()
const host = ref<HTMLElement>()
const error = ref('')
const status = ref(props.document.recovered ? '已恢复草稿，请检查后保存' : '')
const preview = ref(true)
const dirty = ref(props.document.dirty)
const source = new Compartment()
let view: EditorView
let pending = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
let destroyed = false
let uploading = 0
let applying = false
let revision = props.document.revision
const text = () => view?.state.doc.toString() ?? props.document.text
function stage() {
  generation++
  dirty.value = true
  emit('change', props.document.path, true)
  const value = text()
  pending = pending
    .catch(() => {})
    .then(() => window.inkisle.stageDocument(props.document.path, value, revision))
    .catch((e) => {
      error.value = e.message
      throw e
    })
  // Observe the rejection here while save() still receives it through pending.
  void pending.catch(() => {})
  clearTimeout(timer)
  timer = setTimeout(() => {
    void save()
  }, 1000)
}
async function save(): Promise<boolean> {
  clearTimeout(timer)
  if (!dirty.value || props.document.readOnly) return true
  const version = generation
  const operation = pending.then(async () => {
    const result = await window.inkisle.saveDocument(props.document.path)
    revision = result.revision
    if (generation === version) {
      dirty.value = false
      emit('change', props.document.path, false)
    }
    error.value = ''
    status.value = '已保存'
    emit('saved', result)
  })
  pending = operation
  try {
    await operation
    return true
  } catch (e) {
    error.value = (e as Error).message
    return false
  }
}
async function reload() {
  if (!confirm('放弃当前编辑并载入磁盘版本？恢复草稿也会被清除。')) return
  try {
    const doc = await window.inkisle.reloadDocument(props.document.path)
    pending = Promise.resolve()
    apply(doc)
    error.value = ''
    status.value = '已载入磁盘版本'
    emit('saved', doc)
  } catch (e) {
    error.value = (e as Error).message
  }
}
async function copy() {
  try {
    await pending
    const path = await window.inkisle.saveCopy(props.document.path)
    if (path) status.value = '副本已保存：' + path
  } catch (e) {
    error.value = (e as Error).message
  }
}
function apply(doc: DocumentSnapshot) {
  revision = doc.revision
  if (!view) return
  if (doc.text === text()) {
    dirty.value = doc.dirty
    emit('change', doc.path, doc.dirty)
    return
  }
  applying = true
  const selection = Math.min(view.state.selection.main.head, doc.text.length)
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: doc.text },
    selection: { anchor: selection },
  })
  applying = false
  dirty.value = doc.dirty
  emit('change', doc.path, doc.dirty)
}
function wrap(before: string, after = before) {
  if (props.document.readOnly) return false
  const range = view.state.selection.main
  const selected = view.state.sliceDoc(range.from, range.to)
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: before + selected + after },
    selection: {
      anchor: range.from + before.length,
      head: range.from + before.length + selected.length,
    },
  })
  return true
}
function completeLink(context: CompletionContext) {
  const match = context.matchBefore(/\[[^\]\n]*/)
  if (!match || match.from === match.to) return null
  const query = match.text.slice(1).toLowerCase()
  const options = (props.files ?? [])
    .filter((file) => file !== props.document.path && file.toLowerCase().includes(query))
    .slice(0, 50)
    .map((file) => {
      const label = file
        .split(/[\\/]/)
        .pop()!
        .replace(/\.(md|markdown)$/i, '')
      const source = props.document.path.replace(/\\/g, '/').split('/').slice(0, -1)
      const target = file.replace(/\\/g, '/').split('/')
      let common = 0
      while (common < source.length && common < target.length && source[common] === target[common])
        common++
      const relative = [...source.slice(common).map(() => '..'), ...target.slice(common)]
        .map((part) => encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29'))
        .join('/')
      const insert = '[' + label.replace(/[\[\]]/g, '') + '](' + relative + ')'
      return {
        label,
        detail: '链接到笔记',
        type: 'text',
        apply: (editor: EditorView, _completion: unknown, from: number, to: number) =>
          editor.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          }),
      }
    })
  return { from: match.from, to: context.pos, options, filter: false }
}
function toggleSource() {
  preview.value = !preview.value
  view.dispatch({
    effects: source.reconfigure(preview.value ? livePreview(props.document.path) : []),
  })
  view.focus()
}
async function pasteImage(event: ClipboardEvent) {
  const item = [...(event.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
  if (!item || props.document.readOnly) return
  event.preventDefault()
  const file = item.getAsFile()
  if (!file) return
  const operation = crypto.randomUUID()
  const placeholder = `![正在处理图片](inkisle-pending:${operation})`
  view.dispatch(view.state.replaceSelection(placeholder))
  uploading++
  status.value = '正在处理图片…'
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = reject
      r.readAsDataURL(file)
    })
    const url = await window.inkisle.uploadImage(props.document.path, dataUrl)
    if (destroyed) return
    const index = text().indexOf(placeholder)
    if (index >= 0)
      view.dispatch({
        changes: { from: index, to: index + placeholder.length, insert: `![图片](${url})` },
      })
    status.value = '图片已插入'
  } catch (e) {
    if (!destroyed) {
      const index = text().indexOf(placeholder)
      if (index >= 0)
        view.dispatch({
          changes: {
            from: index,
            to: index + placeholder.length,
            insert: '![图片上传失败，请重试粘贴]()',
          },
        })
      error.value = (e as Error).message
    }
  } finally {
    uploading--
  }
}
onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.document.text,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        highlightActiveLine(),
        bracketMatching(),
        indentOnInput(),
        highlightSelectionMatches(),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(
          HighlightStyle.define([
            { tag: tags.heading, color: 'var(--text)', fontWeight: '600' },
            { tag: tags.strong, fontWeight: '700' },
            { tag: tags.emphasis, fontStyle: 'italic' },
            { tag: [tags.url, tags.link], color: 'var(--accent)' },
            { tag: tags.comment, color: 'var(--muted)' },
            { tag: [tags.keyword, tags.operator], color: '#95643a' },
            { tag: tags.string, color: '#32796a' },
            { tag: tags.number, color: '#8c5b8e' },
            { tag: tags.meta, color: 'var(--muted)' },
          ]),
        ),
        autocompletion({ override: [completeLink], interactionDelay: 0 }),
        Prec.highest(keymap.of(completionKeymap)),
        EditorView.lineWrapping,
        EditorState.readOnly.of(props.document.readOnly),
        EditorView.editable.of(!props.document.readOnly),
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown 编辑器', spellcheck: 'false' }),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void save()
              return true
            },
          },
          { key: 'Mod-b', run: () => wrap('**') },
          { key: 'Mod-i', run: () => wrap('*') },
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        source.of(livePreview(props.document.path)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applying) stage()
        }),
        EditorView.domEventHandlers({
          paste: (event) => {
            const image = [...(event.clipboardData?.items ?? [])].some((i) =>
              i.type.startsWith('image/'),
            )
            if (image) {
              void pasteImage(event)
              return true
            }
            return false
          },
          mousedown: (event) => {
            const el = (event.target as HTMLElement).closest<HTMLElement>('[data-href],a[href]')
            if (!el) return false
            const href = el.dataset.href || el.getAttribute('href')
            if (!href) return false
            event.preventDefault()
            emit('link', props.document.path, href, event.ctrlKey || event.metaKey)
            return true
          },
        }),
      ],
    }),
  })
})
watch(
  () => props.document,
  (doc) => {
    if (!dirty.value) apply(doc)
  },
)
onBeforeUnmount(() => {
  destroyed = true
  clearTimeout(timer)
  view?.destroy()
})
defineExpose({
  save,
  apply,
  get dirty() {
    return dirty.value
  },
  get uploading() {
    return uploading
  },
  focus: () => view?.focus(),
  getText: text,
})
</script>
<template>
  <section class="editor-pane">
    <div class="document-tools">
      <span class="document-name">{{ document.path.split(/[\\/]/).pop() }}</span><span
        v-if="document.readOnly"
        class="muted"
        >另一个窗口正在编辑 · 只读</span
      ><span v-else class="save-status" aria-live="polite">{{ dirty ? '未保存' : status }}</span
      ><button
        class="icon-button"
        :title="preview ? '切换源码模式' : '切换实时预览'"
        :aria-label="preview ? '切换源码模式' : '切换实时预览'"
        @click="toggleSource"
      >
        <Icon :name="preview ? 'code' : 'eye'" />
      </button>
    </div>
    <div v-if="error" class="error-banner" role="alert">
      <span>{{ error }}</span><button @click="copy">另存副本</button
      ><button @click="reload">载入磁盘版本</button>
    </div>
    <div ref="host" class="live-editor" :class="{ 'source-mode': !preview }" />
  </section>
</template>
