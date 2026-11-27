import path from 'node:path'
import MarkdownIt from 'markdown-it'
import type { LinkEntry } from '../shared/types'
const parser = new MarkdownIt({ html: false, linkify: false })
export function resolveNote(source: string, href: string, root: string): string | null {
  if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//'))
    return null
  let decoded: string
  try {
    decoded = decodeURIComponent(href.split('#')[0])
  } catch {
    return null
  }
  if (!/\.(md|markdown)$/i.test(decoded)) return null
  return decoded.startsWith('/')
    ? path.resolve(root, '.' + decoded)
    : path.resolve(path.dirname(source), decoded)
}
export function extractLinks(source: string, text: string, root: string): LinkEntry[] {
  const result: LinkEntry[] = []
  const lines = text.split('\n')
  for (const block of parser.parse(text, {})) {
    if (block.type !== 'inline' || !block.children) continue
    for (let i = 0; i < block.children.length; i++) {
      const token = block.children[i]
      if (token.type !== 'link_open') continue
      const href = token.attrGet('href') ?? ''
      const target = resolveNote(source, href, root)
      if (!target) continue
      let label = ''
      for (let j = i + 1; j < block.children.length && block.children[j].type !== 'link_close'; j++)
        label += block.children[j].content
      const line = (block.map?.[0] ?? 0) + 1
      result.push({ source, target, href, label, line, context: lines[line - 1]?.trim() ?? label })
    }
  }
  return result
}
export function isInside(root: string, file: string) {
  const relative = path.relative(root, file)
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  )
}
