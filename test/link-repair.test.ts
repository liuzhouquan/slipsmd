import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyUrlEdits, planUrlEdits } from '../src/main/link-repair'

const root = path.resolve('notes')
const source = path.join(root, 'Old note.md')
const target = path.join(root, 'Archive', '新 (note).md')
const move = (document = path.join(root, 'Index.md')) => ({ root, source, target, document })
const rewrite = (text: string, document?: string) => {
  const result = planUrlEdits(text, move(document))
  return { ...result, text: applyUrlEdits(text, result.edits) }
}

describe('move link rewrite planning', () => {
  it('edits only destinations, preserving labels, titles, BOM and CRLF', () => {
    const input = '\uFEFF# 😀 Index\r\n\r\n[Old note.md](Old%20note.md#标题 "Old note.md")\r\n'
    const result = rewrite(input)
    expect(result.text).toBe(
      '\uFEFF# 😀 Index\r\n\r\n[Old note.md](Archive/%E6%96%B0%20%28note%29.md#标题 "Old note.md")\r\n',
    )
    expect(result.edits).toHaveLength(1)
    expect(result.edits[0].line).toBe(3)
    expect(input.slice(result.edits[0].from, result.edits[0].to)).toBe('Old%20note.md#标题')
  })

  it('rebases moved-document relative resources but keeps root-relative note paths', () => {
    const input = '[B](Other.md#x) ![img](assets/pic.png) [root](/Other.md) [local](#h)'
    const result = rewrite(input, source)
    expect(result.text).toBe(
      '[B](../Other.md#x) ![img](../assets/pic.png) [root](/Other.md) [local](#h)',
    )
    expect(result.edits.map((e) => e.kind)).toEqual(['link', 'image'])
  })

  it('keeps root-relative incoming note syntax', () => {
    expect(rewrite('[old](/Old%20note.md#same)').text).toBe(
      '[old](/Archive/%E6%96%B0%20%28note%29.md#same)',
    )
  })

  it('preserves angle brackets and rewrites reference definitions once', () => {
    const input = '[one][ref] [two][ref]\n\n[ref]: <Old note.md#part> "title"\n'
    const result = rewrite(input)
    expect(result.edits).toHaveLength(1)
    expect(result.edits[0].kind).toBe('reference')
    expect(result.text).toBe(
      '[one][ref] [two][ref]\n\n[ref]: <Archive/%E6%96%B0%20%28note%29.md#part> "title"\n',
    )
  })

  it('rebases reference-style images without changing definition labels', () => {
    expect(rewrite('![photo][p]\n\n[p]: assets/a.png "caption"', source).text).toBe(
      '![photo][p]\n\n[p]: ../assets/a.png "caption"',
    )
  })

  it('decodes Markdown escaping and entities without mistaking encoded # for fragments', () => {
    const src = path.join(root, 'A&B (old)#file.md')
    const context = {
      root,
      source: src,
      target: path.join(root, 'New.md'),
      document: path.join(root, 'Index.md'),
    }
    const text = '[x](A&amp;B%20\\(old\\)%23file.md&#35;Title%20X)'
    const result = planUrlEdits(text, context)
    expect(applyUrlEdits(text, result.edits)).toBe('[x](New.md&#35;Title%20X)')
  })

  it('preserves raw escaped fragment separators', () => {
    expect(rewrite('[x](Old%20note.md\\#heading)').text).toBe(
      '[x](Archive/%E6%96%B0%20%28note%29.md\\#heading)',
    )
  })

  it('handles balanced parentheses and nested formatting in labels', () => {
    const text = '[**bold** note](a(b).md "title")'
    const result = planUrlEdits(text, { ...move(), source: path.join(root, 'a(b).md') })
    expect(applyUrlEdits(text, result.edits)).toBe(
      '[**bold** note](Archive/%E6%96%B0%20%28note%29.md "title")',
    )
  })

  it('does not rewrite code, metadata, math, HTML or plain text examples', () => {
    const input =
      '\uFEFF---\nfield: "[x](Old%20note.md)"\n---\n\n' +
      '`[x](Old%20note.md)`\n\n```md\n[x](Old%20note.md)\n```\n\n' +
      '    [x](Old%20note.md)\n\n' +
      '$[x](Old%20note.md)$\n\n$$\n[x](Old%20note.md)\n$$\n\n' +
      '<div>\n[x](Old%20note.md)\n</div>\n\n' +
      '<span>[x](Old%20note.md)</span>\n\n' +
      'Old note.md and [[Old note]]\n'
    expect(rewrite(input).text).toBe(input)
  })

  it('leaves external, query, ambiguous and outside paths untouched with diagnostics', () => {
    const text =
      '[web](https://example.com/Old.md) [p](file:///Old.md) [net](//server/Old.md) ' +
      '[bad](bad%QQ.md) [q](Old%20note.md?x) [out](../Outside.md) ![root](/pic.png)\n\n[r]: /Old.md'
    const result = rewrite(text, source)
    expect(result.text).toBe(text)
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      'invalid-encoding',
      'query-url',
      'outside-workspace',
      'ambiguous-root',
      'ambiguous-root',
    ])
  })

  it('keeps already-correct targets byte-for-byte, including equivalent dot paths', () => {
    const sameDirectory = { ...move(source), target: path.join(root, 'New.md') }
    const text = '![img](./assets/../assets/pic.png) [x](Other.md)'
    expect(planUrlEdits(text, sameDirectory).edits).toEqual([])
    expect(rewrite('[unrelated](Elsewhere.md)').edits).toEqual([])
  })

  it('repairs an explicit self-file link in the moved note', () => {
    expect(rewrite('[self](Old%20note.md#h) [local](#h)', source).text).toBe(
      '[self](%E6%96%B0%20%28note%29.md#h) [local](#h)',
    )
  })

  it('supports selecting only one proposed edit and detects stale or overlapping edits', () => {
    const text = '[first](Old%20note.md) [second](Old%20note.md)'
    const { edits } = rewrite(text)
    expect(applyUrlEdits(text, [edits[1]])).toBe(
      '[first](Old%20note.md) [second](Archive/%E6%96%B0%20%28note%29.md)',
    )
    expect(() => applyUrlEdits('changed ' + text, edits)).toThrow('失效')
    expect(() => applyUrlEdits(text, [edits[0], edits[0]])).toThrow('重叠')
    expect(applyUrlEdits(text, [])).toBe(text)
  })

  it('keeps directory URL semantics and does not treat a trailing slash as a file reference', () => {
    const result = rewrite('[folder](assets/) [invalid](Old%20note.md/)', source)
    expect(result.text).toBe('[folder](../assets/) [invalid](Old%20note.md/)')
    expect(result.diagnostics[0].code).toBe('directory-url')
  })

  it('rejects planning paths outside the workspace', () => {
    expect(() =>
      planUrlEdits('[x](Old.md)', { ...move(), target: path.resolve('outside.md') }),
    ).toThrow('同一工作区')
  })

  it('uses dot targets for links to the future parent directory', () => {
    const result = rewrite(
      '[folder](Archive/) [plain](Archive) [section](Archive/#heading)',
      source,
    )
    expect(result.text).toBe('[folder](./) [plain](.) [section](./#heading)')
  })

  it('excludes the whole HTML-containing block even when tags are nested in emphasis', () => {
    const text = '[old](Old%20note.md) *<span>text</span>*\n\n[separate](Old%20note.md)'
    const result = rewrite(text)
    expect(result.text).toBe(
      '[old](Old%20note.md) *<span>text</span>*\n\n[separate](Archive/%E6%96%B0%20%28note%29.md)',
    )
    expect(result.edits).toHaveLength(1)
  })

  it('never conflates case-distinct paths, including Windows sensitive-directory candidates', () => {
    const context = {
      root,
      source: path.join(root, 'Old.md'),
      target: path.join(root, 'Archive/New.md'),
      document: path.join(root, 'Index.md'),
    }
    const lower = planUrlEdits('[other](old.md)', context)
    expect(lower.edits).toEqual([])
    const distinctDocument = planUrlEdits('![image](assets/a.png)', {
      ...context,
      document: path.join(root, 'old.md'),
    })
    expect(distinctDocument.edits).toEqual([])
    if (process.platform === 'win32') {
      expect(lower.diagnostics[0].code).toBe('case-ambiguous')
      expect(distinctDocument.diagnostics[0].code).toBe('case-ambiguous')
    }
    expect(() =>
      planUrlEdits('[old](Old.md)', {
        ...context,
        source: path.resolve(root.toUpperCase(), 'Old.md'),
      }),
    ).toThrow('同一工作区')
  })

  it('bounds dense syntax and diagnostic reports rather than claiming complete proposals', () => {
    const dense = planUrlEdits('[x](Old%20note.md) '.repeat(20010), move())
    expect(dense.edits).toEqual([])
    expect(dense.diagnostics[0].code).toBe('syntax-limit')
    const malformed = planUrlEdits('[x](bad%QQ.md) '.repeat(1010), move())
    expect(malformed.diagnostics.at(-1)?.code).toBe('diagnostic-limit')
    expect(malformed.diagnostics.length).toBeLessThanOrEqual(1001)
  })
})
