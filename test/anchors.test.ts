import { describe, expect, it } from 'vitest'
import { fragmentOf, headingAnchors } from '../src/shared/anchors'

describe('Markdown heading anchors', () => {
  it('generates lower-case English and Chinese heading identifiers', () => {
    expect(headingAnchors('# Hello World!\n\n## 中文 标题：说明\n').map((h) => h.slug)).toEqual([
      'hello-world',
      '中文-标题说明',
    ])
  })
  it('uses visible inline text including code, links, images and decoded entities', () => {
    const [heading] = headingAnchors('# **Bold** and `code` [label](A.md) &amp; ![Image](x.png)')
    expect(heading.text).toBe('Bold and code label & Image')
    expect(heading.slug).toBe('bold-and-code-label--image')
  })
  it('supports setext headings and headings inside block quotes', () => {
    const headings = headingAnchors('Title\n=====\n\n> ## Quoted\n')
    expect(headings.map((h) => [h.slug, h.level, h.line])).toEqual([
      ['title', 1, 1],
      ['quoted', 2, 4],
    ])
  })
  it('does not count code examples or YAML front matter as headings', () => {
    const text = '---\n# Hidden\n---\n\n```md\n# Fake\n```\n\n`# Inline`\n\n# Hidden\n'
    expect(headingAnchors(text).map((h) => h.slug)).toEqual(['hidden'])
  })
  it('assigns duplicate suffixes without colliding with explicit numbered titles', () => {
    expect(headingAnchors('# Note\n# Note\n# Note-1\n# Note\n').map((h) => h.slug)).toEqual([
      'note',
      'note-1',
      'note-1-1',
      'note-2',
    ])
  })
  it('keeps source UTF-16 offsets correct with CRLF and non-BMP characters', () => {
    const source = '# 😀 Title\r\n\r\n## 第二节\r\n'
    const heading = headingAnchors(source)[1]
    expect(heading.from).toBe(source.indexOf('## 第二节'))
    expect(heading.line).toBe(3)
    expect(source.slice(heading.from)).toBe('## 第二节\r\n')
  })
  it('decodes only the fragment and distinguishes no fragment from document top', () => {
    expect(fragmentOf('A%23part.md')).toBeUndefined()
    expect(fragmentOf('A%23part.md#')).toBe('')
    expect(fragmentOf('A.md#%E4%B8%AD%E6%96%87-%E6%A0%87%E9%A2%98')).toBe('中文-标题')
    expect(fragmentOf('#HELLO')).toBe('hello')
    expect(fragmentOf('#cafe%CC%81')).toBe('café')
    expect(headingAnchors('# Cafe\u0301')[0].slug).toBe('café')
  })
  it('reports malformed, control-character and oversized anchors instead of throwing URI errors', () => {
    for (const href of ['#%bad', '#%00', '#%0A', '#' + 'a'.repeat(2049)])
      expect(() => fragmentOf(href)).toThrow('标题锚点')
  })
  it('provides stable identifiers for punctuation-only or empty headings', () => {
    expect(headingAnchors('# !!!\n\n##\n').map((h) => h.slug)).toEqual(['section', 'section-1'])
  })
})
