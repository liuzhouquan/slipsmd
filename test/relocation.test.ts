import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DocumentStore, digest } from '../src/main/documents'
import { moveTarget } from '../src/main/relocation'

let root: string, file: string, target: string, store: DocumentStore
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-move-')))
  file = path.join(root, 'Original.md')
  target = path.join(root, 'Moved.md')
  await fs.writeFile(file, '\uFEFF# 原笔记\r\n\r\n[Keep](other.md)\r\n')
  store = new DocumentStore(path.join(root, 'drafts'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

describe('DocumentStore relocation', () => {
  it('moves exact bytes and ownership; subsequent editing writes only to the new path', async () => {
    const original = await fs.readFile(file)
    await store.open(file, 1)
    const moved = await store.relocate(file, target, 1)
    expect(await fs.readFile(target)).toEqual(original)
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(store.owner(file)).toBeUndefined()
    expect(store.owner(target)).toBe(1)
    await expect(store.stage(file, 'stale', 1, moved.revision)).rejects.toThrow('另一个窗口')
    await store.stage(target, moved.text + 'new\n', 1, moved.revision)
    await store.save(target, 1)
    expect(await fs.readFile(target, 'utf8')).toBe(original.toString() + 'new\r\n')
  })
  it('refuses another window, unsaved changes and external conflicts without moving data', async () => {
    const doc = await store.open(file, 1)
    await expect(store.relocate(file, target, 2)).rejects.toThrow('另一个窗口')
    await store.stage(file, 'draft', 1, doc.revision)
    await expect(store.relocate(file, target, 1)).rejects.toThrow('先保存')
    await store.save(file, 1)
    await fs.writeFile(file, 'external writer')
    await expect(store.relocate(file, target, 1)).rejects.toThrow('外部程序修改')
    expect(await fs.readFile(file, 'utf8')).toBe('external writer')
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(store.owner(file)).toBe(1)
  })
  it('never overwrites an existing destination', async () => {
    await store.open(file, 1)
    const original = await fs.readFile(file)
    await fs.writeFile(target, 'Do not overwrite me')
    await expect(store.relocate(file, target, 1)).rejects.toThrow('目标已存在')
    expect(await fs.readFile(target, 'utf8')).toBe('Do not overwrite me')
    expect(await fs.readFile(file)).toEqual(original)
  })
  it('protects destination editor sessions and orphan recovery drafts', async () => {
    await store.open(file, 1)
    await fs.writeFile(target, 'Other session')
    const other = await store.open(target, 2)
    await store.stage(target, 'Recovery content', 2, other.revision)
    await fs.unlink(target)
    const alias = process.platform === 'win32' ? target.replace('Moved.md', 'moved.md') : target
    await expect(store.relocate(file, alias, 1)).rejects.toThrow('已在应用中打开')
    store.abandon(2)
    await expect(store.relocate(file, target, 1)).rejects.toThrow('恢复草稿')
    const draft = JSON.parse(
      await fs.readFile(path.join(root, 'drafts', digest(target) + '.json'), 'utf8'),
    )
    expect(draft.text).toBe('Recovery content')
  })
  it('rolls back its new hard link if removing the old name fails', async () => {
    await store.open(file, 1)
    const unlink = fs.unlink.bind(fs)
    vi.spyOn(fs, 'unlink').mockImplementation(async (candidate) => {
      if (candidate === file) throw Object.assign(new Error('Permission denied'), { code: 'EPERM' })
      return unlink(candidate)
    })
    await expect(store.relocate(file, target, 1)).rejects.toThrow('Permission denied')
    expect(await fs.readFile(file, 'utf8')).toContain('原笔记')
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(store.owner(file)).toBe(1)
  })
  it('serializes competing moves so one succeeds and the other source remains intact', async () => {
    const second = path.join(root, 'Second.md')
    await fs.writeFile(second, 'Second contents')
    await store.open(file, 1)
    await store.open(second, 2)
    const results = await Promise.allSettled([
      store.relocate(file, target, 1),
      store.relocate(second, target, 2),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const loser = results[0].status === 'fulfilled' ? second : file
    expect(await fs.readFile(loser, 'utf8')).toContain(
      loser === second ? 'Second contents' : '原笔记',
    )
    expect(await fs.readFile(target, 'utf8')).toContain(
      loser === second ? '原笔记' : 'Second contents',
    )
  })
  it('finishes opposite moves without a lock cycle and leaves both files unchanged', async () => {
    await fs.writeFile(target, 'Other')
    await store.open(file, 1)
    await store.open(target, 2)
    const results = await Promise.allSettled([
      store.relocate(
        file,
        process.platform === 'win32' ? target.replace('Moved.md', 'moved.md') : target,
        1,
      ),
      store.relocate(
        target,
        process.platform === 'win32' ? file.replace('Original.md', 'original.md') : file,
        2,
      ),
    ])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(await fs.readFile(file, 'utf8')).toContain('原笔记')
    expect(await fs.readFile(target, 'utf8')).toBe('Other')
  }, 3000)
  it('detects replacement of the source during moving and preserves the external version', async () => {
    await store.open(file, 1)
    const link = fs.link.bind(fs)
    const backup = path.join(root, 'Original backup.md')
    vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      await link(source, destination)
      await fs.rename(file, backup)
      await fs.writeFile(file, 'Replacement from external writer')
    })
    await expect(store.relocate(file, target, 1)).rejects.toThrow('移动期间')
    expect(await fs.readFile(file, 'utf8')).toBe('Replacement from external writer')
    expect(await fs.readFile(backup, 'utf8')).toContain('原笔记')
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('refuses an unsupported cross-device move before changing either path', async () => {
    await store.open(file, 1)
    vi.spyOn(fs, 'link').mockRejectedValue(
      Object.assign(new Error('Cross device'), { code: 'EXDEV' }),
    )
    await expect(store.relocate(file, target, 1)).rejects.toThrow('不支持安全移动')
    expect(await fs.readFile(file, 'utf8')).toContain('原笔记')
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('authorized move destinations', () => {
  it('accepts existing workspace subfolders and standalone same-directory renames', async () => {
    await fs.mkdir(path.join(root, '写作 notes'))
    expect(await moveTarget(file, root, '写作 notes/新名字')).toBe(
      path.join(root, '写作 notes', '新名字.md'),
    )
    expect(await moveTarget(file, null, 'Standalone.markdown')).toBe(
      path.join(root, 'Standalone.markdown'),
    )
    await expect(moveTarget(file, null, '写作 notes/Other.md')).rejects.toThrow('单文件模式')
  })
  it('rejects absolute paths, traversal, invisible names, reserved names and missing folders', async () => {
    for (const destination of [
      '../Escape.md',
      '/tmp/escape.md',
      'C:\\escape.md',
      'CON.md',
      '.hidden.md',
      'folder/NUL.md',
      'bad?.md',
      'folder//file.md',
    ])
      await expect(moveTarget(file, root, destination)).rejects.toThrow()
    await expect(moveTarget(file, root, 'missing/note.md')).rejects.toThrow('目标文件夹不存在')
  })
  it('rejects a directory link that escapes the authorized workspace', async () => {
    const work = path.join(root, 'workspace')
    const outside = path.join(root, 'outside')
    await fs.mkdir(work)
    await fs.mkdir(outside)
    await fs.symlink(
      outside,
      path.join(work, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(moveTarget(path.join(work, 'Note.md'), work, 'escape/New.md')).rejects.toThrow(
      '工作区外',
    )
  })
})
