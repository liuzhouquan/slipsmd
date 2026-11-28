import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DocumentStore } from '../src/main/documents'
import { createDirectory, newNoteTarget } from '../src/main/workspace-files'

let root: string, store: DocumentStore, home: string
const original = '\uFEFF# Existing\r\n\r\nKeep these bytes.\r\n'
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-create-')))
  home = path.join(root, 'Home.md')
  await fs.writeFile(home, original)
  await fs.mkdir(path.join(root, 'Existing'))
  store = new DocumentStore(path.join(root, 'drafts'))
})
afterEach(async () => fs.rm(root, { recursive: true, force: true }))

describe('workspace folders and notes', () => {
  it('creates nested folders and a UTF-8 note without modifying existing Markdown', async () => {
    expect(await createDirectory(root, '项目 notes')).toBe(path.join(root, '项目 notes'))
    await createDirectory(root, '项目 notes/草稿')
    const target = await newNoteTarget(root, '项目 notes/草稿/思考')
    await store.create(target)
    expect(await fs.readFile(target, 'utf8')).toBe('# 思考\n\n')
    expect(await fs.readFile(home, 'utf8')).toBe(original)
    expect(await newNoteTarget(root, 'Existing/Explicit.markdown')).toBe(
      path.join(root, 'Existing', 'Explicit.markdown'),
    )
  })
  it('never overwrites files or merges an existing folder', async () => {
    await expect(createDirectory(root, 'Home.md')).rejects.toThrow('已存在')
    await expect(createDirectory(root, 'Existing')).rejects.toThrow('已存在')
    await expect(store.create(await newNoteTarget(root, 'Home'))).rejects.toThrow('已存在')
    expect(await fs.readFile(home, 'utf8')).toBe(original)
    expect((await fs.stat(path.join(root, 'Existing'))).isDirectory()).toBe(true)
  })
  it('rejects a note name occupied by a directory', async () => {
    await fs.mkdir(path.join(root, 'Occupied.md'))
    await expect(store.create(await newNoteTarget(root, 'Occupied'))).rejects.toThrow('已存在')
    expect((await fs.stat(path.join(root, 'Occupied.md'))).isDirectory()).toBe(true)
  })
  it('preserves active edit sessions and orphan drafts when their original file was deleted', async () => {
    const doc = await store.open(home, 1)
    await store.stage(home, 'My recovery draft', 1, doc.revision)
    await fs.unlink(home)
    await expect(store.create(home)).rejects.toThrow('已在应用中打开')
    store.abandon(1)
    await expect(store.create(home)).rejects.toThrow('恢复草稿')
    await expect(fs.stat(home)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.readdir(path.join(root, 'drafts'))).length).toBe(1)
  })
  it('serializes concurrent creation and refuses duplicate directories', async () => {
    const file = await newNoteTarget(root, 'Concurrent')
    const notes = await Promise.allSettled([store.create(file), store.create(file)])
    const folders = await Promise.allSettled([
      createDirectory(root, 'Folder'),
      createDirectory(root, 'Folder'),
    ])
    for (const results of [notes, folders]) {
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    }
    expect(await fs.readFile(file, 'utf8')).toBe('# Concurrent\n\n')
  })
  it('rejects invalid paths and names without creating any directories', async () => {
    const before = await fs.readdir(root)
    for (const value of [
      undefined,
      null,
      '',
      '../escape',
      '/absolute',
      'C:\\escape',
      'CON',
      '.hidden',
      'Bad?',
      'Parent//Child',
      'Trailing.',
    ]) {
      await expect(createDirectory(root, value)).rejects.toThrow()
      await expect(newNoteTarget(root, value)).rejects.toThrow()
    }
    await expect(createDirectory(root, 'node_modules')).rejects.toThrow('忽略')
    await expect(createDirectory(root, 'dist')).rejects.toThrow('忽略')
    await expect(createDirectory(root, 'Chat.md')).rejects.toThrow('收集箱')
    expect(await fs.readdir(root)).toEqual(before)
  })
  it('requires the parent to exist rather than partially creating a hierarchy', async () => {
    await expect(createDirectory(root, 'Missing/Child')).rejects.toThrow('父文件夹不存在')
    await expect(newNoteTarget(root, 'Missing/Note')).rejects.toThrow('父文件夹不存在')
    await expect(fs.stat(path.join(root, 'Missing'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects directory links to outside or hidden workspace locations', async () => {
    const work = path.join(root, 'work')
    const outside = path.join(root, 'outside')
    await fs.mkdir(work)
    await fs.mkdir(outside)
    await fs.mkdir(path.join(work, '.private'))
    const kind = process.platform === 'win32' ? 'junction' : 'dir'
    await fs.symlink(outside, path.join(work, 'escape'), kind)
    await fs.symlink(path.join(work, '.private'), path.join(work, 'hidden-alias'), kind)
    await expect(createDirectory(work, 'escape/Folder')).rejects.toThrow('工作区外')
    await expect(newNoteTarget(work, 'escape/Note')).rejects.toThrow('工作区外')
    await expect(createDirectory(work, 'hidden-alias/Folder')).rejects.toThrow('忽略')
    await expect(newNoteTarget(work, 'hidden-alias/Note')).rejects.toThrow('忽略')
    expect(await fs.readdir(outside)).toEqual([])
  })
})
