import MarkdownIt from 'markdown-it'

const parser = new MarkdownIt({ html: false, linkify: false })
export interface HeadingAnchor {
  slug: string
  text: string
  level: number
  line: number
  from: number
}

export function fragmentOf(href: string): string | undefined {
  const hash = href.indexOf('#')
  if (hash < 0) return undefined
  try {
    const value = decodeURIComponent(href.slice(hash + 1))
      .normalize('NFC')
      .toLowerCase()
    if (value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid fragment')
    return value
  } catch {
    throw new Error('标题锚点编码或长度无效，请检查链接中的 # 部分。')
  }
}

export function headingAnchors(text: string): HeadingAnchor[] {
  const lines = text.split(/\r?\n/)
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  let metadataEnd = 0
  if (/^\uFEFF?---\s*$/.test(lines[0])) {
    const close = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line))
    if (close > 0) metadataEnd = close + 1
  }
  const used = new Set<string>()
  const result: HeadingAnchor[] = []
  const tokens = parser.parse(text, {})
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'heading_open' || !token.map || token.map[0] < metadataEnd) continue
    const inline = tokens[i + 1]
    const label = (inline.children ?? [])
      .map((child) =>
        ['text', 'code_inline', 'image'].includes(child.type)
          ? child.content
          : ['softbreak', 'hardbreak'].includes(child.type)
            ? ' '
            : '',
      )
      .join('')
    const base =
      label
        .normalize('NFC')
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '')
        .replace(/\s/g, '-') || 'section'
    let slug = base
    for (let suffix = 1; used.has(slug); suffix++) slug = base + '-' + suffix
    used.add(slug)
    result.push({
      slug,
      text: label,
      level: Number(token.tag.slice(1)),
      line: token.map[0] + 1,
      from: starts[token.map[0]],
    })
  }
  return result
}
