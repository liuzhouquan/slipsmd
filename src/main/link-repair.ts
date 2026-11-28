import path from 'node:path'
import { markdownLanguage } from '@codemirror/lang-markdown'
import MarkdownIt from 'markdown-it'
import { isInside } from './links'

const unescape = new MarkdownIt().utils.unescapeAll
export const pathKey = (file: string) =>
  process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file)
export interface MoveContext {
  root: string
  source: string
  target: string
  document: string
}
export interface UrlEdit {
  from: number
  to: number
  before: string
  after: string
  line: number
  kind: 'link' | 'image' | 'reference'
}
export interface RepairDiagnostic {
  code: string
  message: string
  line?: number
  file?: string
  level: 'warning' | 'error'
}
type Range = { from: number; to: number }

// Map decoded Markdown characters back to their raw positions, before URI decoding.
// A fragment written as &#35; or \# must keep its original bytes in the proposal.
function decodeMarkdown(raw: string) {
  let value = ''
  const offsets: number[] = []
  for (let i = 0; i < raw.length;) {
    const escaped = /^\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.exec(raw.slice(i))
    const entity = /^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/.exec(raw.slice(i))
    const token = escaped?.[0] ?? entity?.[0]
    const decoded = token ? unescape(token) : undefined
    if (decoded !== undefined && decoded !== token) {
      value += decoded
      for (let j = 0; j < decoded.length; j++) offsets.push(i)
      i += token!.length
    } else {
      value += raw[i]
      offsets.push(i++)
    }
  }
  return { value, offsets }
}
function mergedRanges(ranges: Range[]) {
  const result: Range[] = []
  for (const range of ranges.sort((a, b) => a.from - b.from || b.to - a.to)) {
    const last = result.at(-1)
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to)
    else result.push({ ...range })
  }
  return result
}
function metadataEnd(text: string) {
  const first = /^\uFEFF?---[ \t]*\r?\n/.exec(text)
  if (!first) return 0
  const end = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm
  end.lastIndex = first[0].length
  const match = end.exec(text)
  return match ? end.lastIndex : 0
}
const encodedPath = (file: string) =>
  file
    .split(path.sep)
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join('/')

export function planUrlEdits(text: string, move: MoveContext) {
  if (!path.isAbsolute(move.root)) throw new Error('规划工作区必须使用绝对路径。')
  for (const candidate of [move.source, move.target, move.document])
    if (!path.isAbsolute(candidate) || !isInside(move.root, candidate))
      throw new Error('规划路径必须位于同一工作区。')
  const tree = markdownLanguage.parser.parse(text)
  const ignored: Range[] = [{ from: 0, to: metadataEnd(text) }]
  const urls: (Range & { kind: UrlEdit['kind'] })[] = []
  let syntaxLimited = false
  tree.iterate({
    enter(node) {
      if (urls.length + ignored.length >= 20000) {
        syntaxLimited = true
        return false
      }
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'].includes(node.name))
        ignored.push({ from: node.from, to: node.to })
      if (node.name === 'HTMLTag') {
        const parent = node.node.parent
        if (parent) ignored.push({ from: parent.from, to: parent.to })
      }
      if (node.name !== 'URL') return
      const parent = node.node.parent?.name
      if (parent !== 'Link' && parent !== 'Image' && parent !== 'LinkReference') return
      let { from, to } = node
      if (text[from] === '<' && text[to - 1] === '>') {
        from++
        to--
      }
      urls.push({
        from,
        to,
        kind: parent === 'Image' ? 'image' : parent === 'LinkReference' ? 'reference' : 'link',
      })
    },
  })
  if (syntaxLimited)
    return {
      edits: [] as UrlEdit[],
      diagnostics: [
        {
          level: 'error',
          code: 'syntax-limit',
          message: '单篇 URL／排除区段达到 20,000 项上限，预览不完整。',
        } satisfies RepairDiagnostic,
      ],
    }
  // Math is an app extension rather than CommonMark; mask code/metadata first.
  const chunks: string[] = []
  let cursor = 0
  for (const range of mergedRanges(ignored)) {
    chunks.push(
      text.slice(cursor, range.from),
      text.slice(range.from, range.to).replace(/[^\r\n]/g, ' '),
    )
    cursor = range.to
  }
  chunks.push(text.slice(cursor))
  const visible = chunks.join('')
  for (const match of visible.matchAll(
    /(?<![\\$])\$\$[\s\S]*?\$\$|(?<![\\$])\$(?:\\.|[^$\\\r\n])+\$(?!\$)/g,
  ))
    ignored.push({ from: match.index, to: match.index + match[0].length })
  const exclusions = mergedRanges(ignored)
  const diagnostics: RepairDiagnostic[] = []
  const edits: UrlEdit[] = []
  const afterDocument =
    pathKey(move.document) === pathKey(move.source) ? move.target : move.document
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  let line = 0
  let exclusion = 0
  for (const url of urls) {
    if (diagnostics.length >= 1000) {
      diagnostics.push({
        level: 'error',
        code: 'diagnostic-limit',
        message: '诊断数量达到上限，预览不完整。',
      })
      break
    }
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= url.from) line++
    while (exclusion < exclusions.length && exclusions[exclusion].to <= url.from) exclusion++
    if (exclusions[exclusion]?.from < url.to && exclusions[exclusion].to > url.from) continue
    const before = text.slice(url.from, url.to)
    if (before.length > 8192) {
      diagnostics.push({
        level: 'warning',
        code: 'url-length',
        line: line + 1,
        message: '目标过长，保持原样并手动核对。',
      })
      continue
    }
    const decoded = decodeMarkdown(before)
    const hash = decoded.value.indexOf('#')
    const pathname = hash < 0 ? decoded.value : decoded.value.slice(0, hash)
    const fragment = hash < 0 ? '' : before.slice(decoded.offsets[hash])
    if (!pathname || /^[a-z][a-z\d+.-]*:/i.test(pathname) || pathname.startsWith('//')) continue
    const warn = (code: string, message: string) =>
      diagnostics.push({ code, message, line: line + 1, level: 'warning' })
    if (pathname.includes('?')) {
      warn('query-url', '含查询参数的本地目标需要手动核对。')
      continue
    }
    let local: string
    try {
      local = decodeURIComponent(pathname)
    } catch {
      warn('invalid-encoding', '目标的百分号编码无效，保持原样。')
      continue
    }
    if (/[\x00-\x1f\x7f\\]/.test(local)) {
      warn('unsupported-path', '控制字符或反斜杠目标不自动规划。')
      continue
    }
    const rooted = local.startsWith('/')
    if (rooted && url.kind !== 'link') {
      warn('ambiguous-root', '图片／引用定义的根路径语义不明确，保持原样。')
      continue
    }
    const resolve = (document: string) =>
      rooted ? path.resolve(move.root, '.' + local) : path.resolve(path.dirname(document), local)
    const originalTarget = resolve(move.document)
    if (!isInside(move.root, originalTarget)) {
      warn('outside-workspace', '目标位于工作区外，保持原样。')
      continue
    }
    const directory = local.endsWith('/')
    if (directory && pathKey(originalTarget) === pathKey(move.source)) {
      warn('directory-url', '尾斜杠目标不是笔记文件引用，保持原样。')
      continue
    }
    const desired = pathKey(originalTarget) === pathKey(move.source) ? move.target : originalTarget
    if (pathKey(resolve(afterDocument)) === pathKey(desired)) continue
    const rebuilt = rooted
      ? '/' + encodedPath(path.relative(move.root, desired))
      : encodedPath(path.relative(path.dirname(afterDocument), desired))
    const after = rebuilt + (directory && !rebuilt.endsWith('/') ? '/' : '') + fragment
    edits.push({ ...url, before, after, line: line + 1 })
    if (edits.length > 10000) {
      edits.pop()
      diagnostics.push({
        level: 'error',
        code: 'edit-limit',
        message: '单文件建议达到 10,000 项上限，预览不完整。',
      })
      break
    }
  }
  return { edits, diagnostics }
}

// Pure, guarded string construction. No writer or filesystem capability is accepted.
export function applyUrlEdits(text: string, edits: readonly UrlEdit[]) {
  const chunks: string[] = []
  let cursor = 0
  for (const edit of [...edits].sort((a, b) => a.from - b.from)) {
    if (
      !Number.isInteger(edit.from) ||
      !Number.isInteger(edit.to) ||
      edit.from < cursor ||
      edit.to <= edit.from ||
      edit.to > text.length ||
      text.slice(edit.from, edit.to) !== edit.before
    )
      throw new Error('编辑范围已失效或重叠，请重新预览。')
    chunks.push(text.slice(cursor, edit.from), edit.after)
    cursor = edit.to
  }
  return chunks.join('') + text.slice(cursor)
}
