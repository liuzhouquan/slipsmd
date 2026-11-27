import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DocumentStore } from '../src/main/documents'
let root: string, file: string, store: DocumentStore
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'slips-doc-'))
  file = path.join(root, 'note.md')
  await fs.writeFile(file, '# Original\n')
  store = new DocumentStore(path.join(root, 'drafts'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})
describe('DocumentStore persistence and ownership', () => {
  it('does not rewrite an untouched file and preserves BOM / CRLF after edits', async () => {
    const original = '\uFEFF---\r\ntitle: note\r\n---\r\n\r\n# Original\r\n'
    await fs.writeFile(file, original)
    const doc = await store.open(file, 1)
    await store.save(file, 1)
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    await store.stage(file, doc.text + 'new\n', 1, doc.revision)
    await store.save(file, 1)
    expect(await fs.readFile(file, 'utf8')).toBe(original + 'new\r\n')
  })
  it('refuses external conflicts and recovers the unsaved draft across restarts', async () => {
    const doc = await store.open(file, 1)
    await store.stage(file, 'my draft', 1, doc.revision)
    await fs.writeFile(file, 'external change')
    await expect(store.save(file, 1)).rejects.toThrow('外部程序修改')
    expect(await fs.readFile(file, 'utf8')).toBe('external change')
    const restored = await new DocumentStore(path.join(root, 'drafts')).open(file, 2)
    expect(restored.text).toBe('my draft')
    expect(restored.recovered).toBe(true)
  })
  it('makes a duplicate document read only and prevents another window from staging it', async () => {
    const doc = await store.open(file, 1)
    expect((await store.open(file, 2)).readOnly).toBe(true)
    await expect(store.stage(file, 'overwrite', 2, doc.revision)).rejects.toThrow('另一个窗口')
  })
  it('does not append captures into dirty editor state', async () => {
    const doc = await store.open(file, 1)
    await store.stage(file, 'draft', 1, doc.revision)
    await expect(store.append(file, 'capture')).rejects.toThrow('未保存编辑')
    await store.save(file, 1)
    await store.append(file, 'capture')
    expect(store.getText(file)).toBe('draft\n\ncapture\n')
  })
  it('retains stale editor input as a conflict draft after another internal writer changes the file', async () => {
    const doc = await store.open(file, 1)
    await store.append(file, 'incoming capture')
    await expect(store.stage(file, 'stale editor', 1, doc.revision)).rejects.toThrow('版本已改变')
    await expect(store.save(file, 1)).rejects.toThrow('外部程序修改')
    expect(await fs.readFile(file, 'utf8')).toContain('incoming capture')
    expect(store.getText(file)).toBe('stale editor')
  })
  it('serializes multiple draft writes and saves the latest one', async () => {
    const doc = await store.open(file, 1)
    await Promise.all([
      store.stage(file, 'first', 1, doc.revision),
      store.stage(file, 'second', 1, doc.revision),
    ])
    await store.save(file, 1)
    expect(await fs.readFile(file, 'utf8')).toBe('second')
  })
  it('refreshes a clean document after an external edit without destroying a dirty one', async () => {
    await store.open(file, 1)
    await fs.writeFile(file, 'external')
    const doc = await store.open(file, 1)
    expect(doc.text).toBe('external')
    await store.stage(file, 'unsaved', 1, doc.revision)
    await fs.writeFile(file, 'another external')
    expect((await store.open(file, 1)).text).toBe('unsaved')
  })
  it('preserves recovery state when a reload fails after external deletion', async () => {
    const doc = await store.open(file, 1)
    await store.stage(file, 'recover me', 1, doc.revision)
    await fs.rm(file)
    await expect(store.reload(file, 1)).rejects.toThrow()
    expect(store.getText(file)).toBe('recover me')
    expect((await fs.readdir(path.join(root, 'drafts'))).length).toBe(1)
  })
  it('releases ownership only after changes have been saved', async () => {
    const doc = await store.open(file, 1)
    await store.stage(file, 'draft', 1, doc.revision)
    await expect(store.release(file, 1)).rejects.toThrow('先保存')
    await store.save(file, 1)
    await store.release(file, 1)
    expect((await store.open(file, 2)).readOnly).toBe(false)
  })
})
