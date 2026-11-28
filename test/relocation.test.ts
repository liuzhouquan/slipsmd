import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DocumentStore, digest } from '../src/main/documents'
import { folderMoveTarget, moveTarget, replaceFolderPrefix } from '../src/main/relocation'

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

describe('folderMoveTarget and DocumentStore.relocateFolder', () => {
  it('validates folder destinations and rejects root, self/descendant, missing parent, and escaped links', async () => {
    const work = path.join(root, 'workspace')
    const folder = path.join(work, '写作')
    const nested = path.join(folder, '草稿')
    const archive = path.join(work, '归档')
    await fs.mkdir(nested, { recursive: true })
    await fs.mkdir(archive, { recursive: true })

    expect(await folderMoveTarget(folder, work, '归档/新写作')).toBe(path.join(archive, '新写作'))
    expect(
      replaceFolderPrefix(path.join(nested, 'a.md'), folder, path.join(archive, '新写作')),
    ).toBe(path.join(archive, '新写作', '草稿', 'a.md'))
    expect(
      replaceFolderPrefix(path.join(work, 'Home.md'), folder, path.join(archive, '新写作')),
    ).toBeNull()

    await expect(folderMoveTarget(work, work, 'RenamedRoot')).rejects.toThrow('工作区根目录')
    await expect(folderMoveTarget(folder, null, 'Renamed')).rejects.toThrow('工作区文件夹')
    await expect(folderMoveTarget(folder, work, '写作/草稿/子目录')).rejects.toThrow(
      '自身或其子文件夹',
    )
    await expect(folderMoveTarget(folder, work, '不存在/目标')).rejects.toThrow(
      '目标上级文件夹不存在',
    )
    await expect(folderMoveTarget(folder, work, '.git')).rejects.toThrow()
    await expect(folderMoveTarget(file, work, 'Renamed')).rejects.toThrow('工作区文件夹')
  })

  it('moves folder with multiple open sessions across owners and preserves exact bytes', async () => {
    const work = path.join(root, 'workspace')
    const folder = path.join(work, 'Drafts')
    const sub = path.join(folder, 'Sub')
    const targetFolder = path.join(work, 'Archive', 'Drafts')
    await fs.mkdir(sub, { recursive: true })
    await fs.mkdir(path.join(work, 'Archive'), { recursive: true })

    const noteA = path.join(folder, 'A.md')
    const noteB = path.join(sub, 'B.md')
    const bytesA = Buffer.from('\uFEFF# A\r\n\r\nBody A\r\n')
    const bytesB = Buffer.from('# B\n\nBody B\n')
    await fs.writeFile(noteA, bytesA)
    await fs.writeFile(noteB, bytesB)

    await store.open(noteA, 1)
    await store.open(noteB, 2)

    const moved = await store.relocateFolder(folder, targetFolder)
    expect(moved).toHaveLength(2)
    await expect(fs.stat(folder)).rejects.toMatchObject({ code: 'ENOENT' })

    const nextA = path.join(targetFolder, 'A.md')
    const nextB = path.join(targetFolder, 'Sub', 'B.md')
    expect(await fs.readFile(nextA)).toEqual(bytesA)
    expect(await fs.readFile(nextB)).toEqual(bytesB)
    expect(store.owner(noteA)).toBeUndefined()
    expect(store.owner(noteB)).toBeUndefined()
    expect(store.owner(nextA)).toBe(1)
    expect(store.owner(nextB)).toBe(2)
  })

  it('refuses to overwrite an existing empty directory, file, or symlink', async () => {
    const work = path.join(root, 'workspace')
    const folder = path.join(work, 'Source')
    const emptyTarget = path.join(work, 'ExistingEmpty')
    const fileTarget = path.join(work, 'ExistingFile')
    await fs.mkdir(folder, { recursive: true })
    await fs.mkdir(emptyTarget, { recursive: true })
    await fs.writeFile(path.join(folder, 'Note.md'), '# Note\n')
    await fs.writeFile(fileTarget, 'keep me')

    await expect(store.relocateFolder(folder, emptyTarget)).rejects.toThrow('目标已存在')
    await expect(store.relocateFolder(folder, fileTarget)).rejects.toThrow('目标已存在')
    expect(await fs.readFile(fileTarget, 'utf8')).toBe('keep me')
    expect(await fs.readFile(path.join(folder, 'Note.md'), 'utf8')).toBe('# Note\n')
  })

  it('refuses when any session is dirty, externally modified, or has a recovery draft', async () => {
    const work = path.join(root, 'workspace')
    const folder = path.join(work, 'Source')
    const targetFolder = path.join(work, 'Target')
    await fs.mkdir(folder, { recursive: true })
    const note = path.join(folder, 'Note.md')
    await fs.writeFile(note, '# Note\n')

    const snap = await store.open(note, 1)
    await store.stage(note, '# Edited\n', 1, snap.revision)
    await expect(store.relocateFolder(folder, targetFolder)).rejects.toThrow('未保存的笔记')

    await store.save(note, 1)
    await fs.writeFile(note, '# External change\n')
    await expect(store.relocateFolder(folder, targetFolder)).rejects.toThrow('外部程序修改')

    await store.reload(note, 1)
    await store.release(note, 1)

    // Closed file with leftover recovery draft under targetFolder
    const targetNote = path.join(targetFolder, 'Note.md')
    await fs.mkdir(path.join(root, 'drafts'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'drafts', digest(targetNote) + '.json'),
      JSON.stringify({ path: targetNote, text: '# Draft\n', revision: 'rev' }),
    )
    await expect(store.relocateFolder(folder, targetFolder)).rejects.toThrow('恢复草稿')
  })
})
