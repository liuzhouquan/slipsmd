import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUrlEdits } from '../src/main/link-repair'
import { previewLinkRepair, selectPreview } from '../src/main/link-repair-preview'

let temp: string
let root: string
const file = (name: string) => path.join(root, name)
const preview = () => previewLinkRepair(root, 'Old.md', 'Archive/New.md')
beforeEach(async () => {
  temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-repair-')))
  root = path.join(temp, 'notes')
  await fs.mkdir(root)
  await fs.mkdir(file('Archive'))
  await fs.writeFile(file('Old.md'), '\uFEFF# Old\r\n\r\n![img](assets/a.png)\r\n')
  await fs.writeFile(file('Index.md'), '# Index\n\n[old](Old.md#heading) [unrelated](Other.md)\n')
  await fs.writeFile(file('Other.md'), '# Other\n')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(temp, { recursive: true, force: true })
})

describe('read-only workspace link repair preview', () => {
  it('reports both incoming links and moved resources, with raw hashes and positions', async () => {
    const result = await preview()
    expect(result.readOnly).toBe(true)
    expect(result.complete).toBe(true)
    expect(result.source).toBe('Old.md')
    expect(result.target).toBe('Archive/New.md')
    expect(result.files.map((f) => [f.pathBefore, f.pathAfter])).toEqual([
      ['Index.md', 'Index.md'],
      ['Old.md', 'Archive/New.md'],
    ])
    expect(result.summary).toMatchObject({
      scannedFiles: 3,
      affectedFiles: 2,
      proposedEdits: 2,
      selectedEdits: 2,
    })
    for (const f of result.files) {
      const bytes = await fs.readFile(file(f.pathBefore))
      expect(f.beforeRevision).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(f.beforeIdentity).toMatch(/^\d+:\d+$/)
      for (const edit of f.edits)
        expect(bytes.toString('utf8').slice(edit.from, edit.to)).toBe(edit.before)
    }
    const moved = result.files[1]
    expect(applyUrlEdits(await fs.readFile(file('Old.md'), 'utf8'), moved.edits)).toBe(
      '\uFEFF# Old\r\n\r\n![img](../assets/a.png)\r\n',
    )
    await expect(fs.access(file('Old.md'))).resolves.toBeUndefined()
    await expect(fs.access(file('Archive/New.md'))).rejects.toThrow()
  })

  it('has no writer side effects and keeps every original byte and file mtime', async () => {
    const names = ['Old.md', 'Index.md', 'Other.md']
    const original = await Promise.all(
      names.map(async (n) => ({
        n,
        bytes: await fs.readFile(file(n)),
        stat: await fs.stat(file(n), { bigint: true }),
      })),
    )
    const spies = ['writeFile', 'appendFile', 'rename', 'unlink', 'mkdir', 'rm'].map((name) =>
      vi.spyOn(fs, name as 'writeFile'),
    )
    await preview()
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    for (const { n, bytes, stat } of original) {
      expect(await fs.readFile(file(n))).toEqual(bytes)
      expect((await fs.stat(file(n), { bigint: true })).mtimeNs).toBe(stat.mtimeNs)
    }
  })

  it('binds selection to a stable complete plan and rejects stale or unknown IDs', async () => {
    const first = await preview()
    const second = await preview()
    expect(second.planId).toBe(first.planId)
    const chosen = first.files[0].edits[0].id
    const selected = selectPreview(second, first.planId, [chosen])
    expect(selected.summary.selectedEdits).toBe(1)
    expect(selected.files).toHaveLength(1)
    expect(selectPreview(second, first.planId, []).files).toEqual([])
    expect(() => selectPreview(second, first.planId, ['unknown'])).toThrow('未知')
    expect(() => selectPreview(second, first.planId, [chosen, chosen])).toThrow('重复')
    await fs.appendFile(file('Other.md'), '\n[old](Old.md)\n')
    const changed = await preview()
    expect(changed.planId).not.toBe(first.planId)
    expect(() => selectPreview(changed, first.planId, [chosen])).toThrow('过期')
  })

  it('invalidates a plan when a file identity changes even if all bytes are identical', async () => {
    const first = await preview()
    const bytes = await fs.readFile(file('Other.md'))
    await fs.rename(file('Other.md'), file('Previous.txt'))
    await fs.writeFile(file('Other.md'), bytes)
    const next = await preview()
    expect(next.planId).not.toBe(first.planId)
  })

  it('omits hidden and ignored notes and never reads through directory symlinks', async () => {
    for (const name of ['.hidden', 'node_modules']) {
      await fs.mkdir(file(name))
      await fs.writeFile(file(name + '/Hidden.md'), '[old](../Old.md)')
    }
    const outside = path.join(temp, 'outside')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'Secret.md'), '[old](Old.md)')
    await fs.symlink(outside, file('Alias'), 'junction')
    const result = await preview()
    expect(result.complete).toBe(true)
    expect(result.summary.scannedFiles).toBe(3)
    await expect(previewLinkRepair(root, 'Alias/Secret.md', 'Archive/New.md')).rejects.toThrow(
      '越界',
    )
  })

  it('rejects existing targets, missing parents, escapes, aliases and protected collection paths', async () => {
    await fs.writeFile(file('Archive/New.md'), 'Never overwrite')
    await expect(preview()).rejects.toThrow('已存在')
    await expect(previewLinkRepair(root, 'Old.md', 'Missing/New.md')).rejects.toThrow('文件夹')
    await expect(previewLinkRepair(root, 'Old.md', '../Escape.md')).rejects.toThrow('路径')
    await expect(previewLinkRepair(root, 'Old.md', 'Old.md')).rejects.toThrow('相同')
    await expect(previewLinkRepair(root, 'Old.md', '.hidden/New.md')).rejects.toThrow('路径')
    await fs.writeFile(file('Chat.md'), '# Chat')
    await expect(previewLinkRepair(root, 'Chat.md', 'Archive/Chat.md')).rejects.toThrow('收集箱')
    expect(await fs.readFile(file('Archive/New.md'), 'utf8')).toBe('Never overwrite')
  })

  it('marks invalid UTF-8 and binary sources incomplete, with no selectable plan', async () => {
    for (const bytes of [Buffer.from([0xff]), Buffer.from('[old](Old.md)\0')]) {
      await fs.writeFile(file('Other.md'), bytes)
      const result = await preview()
      expect(result.complete).toBe(false)
      expect(result.diagnostics.some((d) => d.code === 'file-unreadable')).toBe(true)
      expect(() => selectPreview(result, result.planId, [])).toThrow('未完成')
    }
  })

  it('enforces file, byte, count, depth and edit limits without returning complete coverage', async () => {
    for (const limits of [{ maxFileBytes: 8 }, { maxBytes: 8 }, { maxFiles: 1 }, { maxEdits: 1 }]) {
      const result = await previewLinkRepair(root, 'Old.md', 'Archive/New.md', limits)
      expect(result.complete).toBe(false)
      expect(result.diagnostics.some((d) => d.level === 'error')).toBe(true)
    }
    await fs.mkdir(file('Deep'))
    await fs.mkdir(file('Deep/Nested'))
    await fs.writeFile(file('Deep/Nested/Note.md'), '[old](../../Old.md)')
    const deep = await previewLinkRepair(root, 'Old.md', 'Archive/New.md', { maxDepth: 1 })
    expect(deep.diagnostics.some((d) => d.code === 'depth-limit')).toBe(true)
    await expect(
      previewLinkRepair(root, 'Old.md', 'Archive/New.md', { maxFiles: 10001 }),
    ).rejects.toThrow('上限')
  })

  it('detects a file added during scanning instead of claiming full coverage', async () => {
    const readdir = fs.readdir.bind(fs)
    let added = false
    vi.spyOn(fs, 'readdir').mockImplementation(async (...args: Parameters<typeof fs.readdir>) => {
      const result = await readdir(...args)
      if (!added && args[0] === root) {
        added = true
        await fs.writeFile(file('Added.md'), '[old](Old.md)')
      }
      return result
    })
    const result = await preview()
    expect(result.complete).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 'tree-changed')).toBe(true)
  })

  it('detects an earlier source changing while later notes are being read', async () => {
    await fs.writeFile(file('ZZZ.md'), '# Later note')
    const open = fs.open.bind(fs)
    let changed = false
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (!changed && args[0] === file('ZZZ.md')) {
        changed = true
        await fs.appendFile(file('Index.md'), '\nChanged during scan\n')
      }
      return open(...args)
    })
    const result = await preview()
    expect(result.complete).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 'file-changed')).toBe(true)
  })
})
