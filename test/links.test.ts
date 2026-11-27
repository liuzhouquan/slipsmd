import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { extractLinks, isInside, resolveNote } from '../src/main/links'
const root = path.resolve('fixture')
const note = path.join(root, 'notes', 'A.md')
describe('Markdown note links', () => {
  it('resolves relative, root-relative, encoded paths and anchors', () => {
    expect(resolveNote(note, '../B%20note.md#heading', root)).toBe(path.join(root, 'B note.md'))
    expect(resolveNote(note, '/notes/B.md', root)).toBe(path.join(root, 'notes', 'B.md'))
  })
  it('ignores web links, images and examples inside code', () => {
    const text =
      '[B](B.md)\n\n![image](photo.png)\n\n`[fake](C.md)`\n\n```md\n[code](D.md)\n```\n\n[web](https://example.com/note.md)'
    expect(extractLinks(note, text, root).map((l) => l.label)).toEqual(['B'])
  })
  it('indexes reference style Markdown links', () => {
    const links = extractLinks(note, '[Reference][ref]\n\n[ref]: ../B.md', root)
    expect(links[0].target).toBe(path.join(root, 'B.md'))
  })
  it('rejects protocols and does not treat sibling names as authorized children', () => {
    expect(resolveNote(note, 'javascript:alert(1)', root)).toBe(null)
    expect(resolveNote(note, '%broken.md', root)).toBe(null)
    expect(isInside(root, root + '-other/file.md')).toBe(false)
    expect(isInside(root, path.join(root, 'notes', 'A.md'))).toBe(true)
  })
})
