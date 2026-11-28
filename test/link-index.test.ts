import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkIndex } from '../src/main/link-index'

let root: string
let files: string[]
let drafts: Map<string, string>
let index: LinkIndex
const file = (name: string) => path.join(root, name)
async function note(name: string, text: string) {
  const target = file(name)
  await fs.writeFile(target, text)
  if (!files.includes(target)) files.push(target)
  return target
}
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-index-')))
  files = []
  drafts = new Map()
  index = new LinkIndex(
    root,
    async () => [...files],
    (p) => drafts.get(p),
  )
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

describe('incremental workspace link index', () => {
  it('reuses unchanged disk links without reading or parsing their bodies again', async () => {
    const a = await note('A.md', '[B](B.md#target)')
    const b = await note('B.md', '# B')
    expect((await index.query(b)).backlinks[0].source).toBe(a)
    const cold = index.statistics
    expect(cold.reads).toBe(2)
    expect(cold.parses).toBe(2)
    expect((await index.query(a)).outgoing[0].href).toBe('B.md#target')
    expect(index.statistics.reads).toBe(cold.reads)
    expect(index.statistics.parses).toBe(cold.parses)
    expect(index.statistics.hits).toBe(2)
  })

  it('detects external edits without relying on watcher delivery, including restored mtime', async () => {
    const a = await note('A.md', '[B](B.md)')
    await note('B.md', '# B')
    const c = await note('C.md', '# C')
    await index.query(a)
    const original = await fs.stat(a)
    await fs.writeFile(a, '[C](C.md)')
    await fs.utimes(a, original.atime, original.mtime)
    expect((await index.query(c)).backlinks.map((l) => l.source)).toEqual([a])
    expect((await index.query(file('B.md'))).backlinks).toEqual([])
    expect(index.statistics.reads).toBe(4)
    expect(index.statistics.parses).toBe(4)
  })

  it('indexes current drafts and switches back to disk text when the editor closes', async () => {
    const a = await note('A.md', '[B](B.md)')
    const b = await note('B.md', '# B')
    const c = await note('C.md', '# C')
    await index.query(a)
    drafts.set(a, '[C](C.md)')
    expect((await index.query(c)).backlinks[0].source).toBe(a)
    expect((await index.query(b)).backlinks).toEqual([])
    expect(await fs.readFile(a, 'utf8')).toBe('[B](B.md)')
    drafts.delete(a)
    expect((await index.query(b)).backlinks[0].source).toBe(a)
    expect((await index.query(c)).backlinks).toEqual([])
  })

  it('coalesces overlapping queries and bounds simultaneously open disk files', async () => {
    for (let i = 0; i < 40; i++) await note(i + '.md', '[next](' + ((i + 1) % 40) + '.md)')
    const open = fs.open.bind(fs)
    let active = 0
    let peak = 0
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args)
      peak = Math.max(peak, ++active)
      const close = handle.close.bind(handle)
      handle.close = async () => {
        try {
          return await close()
        } finally {
          active--
        }
      }
      return handle
    })
    const results = await Promise.all(files.slice(0, 12).map((p) => index.query(p)))
    expect(index.statistics.scans).toBe(1)
    expect(index.statistics.reads).toBe(40)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(8)
    expect(active).toBe(0)
    expect(
      results.every((links) => links.outgoing.length === 1 && links.backlinks.length === 1),
    ).toBe(true)
  })

  it('does not serve a stale scan to queries joining after an in-flight edit', async () => {
    const a = await note('A.md', '[old](Old.md)')
    const old = await note('Old.md', '# Old')
    const target = await note('New.md', '# New')
    let trigger = true
    let join!: () => void
    const joined = new Promise<Awaited<ReturnType<LinkIndex['query']>>>((resolve) => {
      join = () => resolve(index.query(target))
    })
    index = new LinkIndex(
      root,
      async () => [...files],
      (p) => {
        const current = drafts.get(p)
        if (p === a && trigger) {
          trigger = false
          queueMicrotask(() => {
            drafts.set(a, '[new](New.md)')
            index.invalidate(a)
            join()
          })
        }
        return current
      },
    )
    const first = index.query(target)
    for (const result of await Promise.all([first, joined]))
      expect(result.backlinks.map((l) => l.source)).toEqual([a])
    expect((await index.query(old)).backlinks).toEqual([])
  })

  it('removes deleted and moved sources without retaining ghost backlinks', async () => {
    const a = await note('A.md', '[B](B.md)')
    const b = await note('B.md', '# B')
    await index.query(b)
    const moved = file('Moved.md')
    await fs.rename(a, moved)
    files = [b, moved]
    expect((await index.query(b)).backlinks.map((l) => l.source)).toEqual([moved])
    expect((await index.query(a)).outgoing).toEqual([])
    await fs.unlink(moved)
    files = [b]
    expect((await index.query(b)).backlinks).toEqual([])
  })

  it('drops invalid UTF-8, binary and oversized files rather than keeping old cached links', async () => {
    const a = await note('A.md', '[B](B.md)')
    const b = await note('B.md', '# B')
    await index.query(b)
    for (const bytes of [Buffer.from([0xff, 0xfe]), Buffer.from('[B](B.md)\0')]) {
      await fs.writeFile(a, bytes)
      index.invalidate(a)
      expect((await index.query(b)).backlinks).toEqual([])
    }
    const handle = await fs.open(a, 'w')
    await handle.truncate(20 * 1024 * 1024 + 1)
    await handle.close()
    const reads = index.statistics.reads
    expect((await index.query(b)).backlinks).toEqual([])
    expect(index.statistics.reads).toBe(reads)
    await fs.writeFile(a, '[B](B.md)')
    expect((await index.query(b)).backlinks[0].source).toBe(a)
  })

  it('rejects sources escaping the root, including directory symlinks', async () => {
    const b = await note('B.md', '# B')
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-index-outside-'))
    try {
      const secret = path.join(outside, 'Secret.md')
      await fs.writeFile(secret, '[B](' + b.replaceAll('\\', '/') + ')')
      await fs.symlink(outside, file('escape'), 'junction')
      files.push(secret, file('escape/Secret.md'))
      expect((await index.query(b)).backlinks).toEqual([])
      expect(index.statistics.reads).toBe(1)
    } finally {
      await fs.rm(file('escape'), { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('recovers after a failed directory scan and preserves deterministic source order', async () => {
    const b = await note('B.md', '# B')
    const c = await note('C.md', '[B](B.md)')
    const a = await note('A.md', '[B](B.md)')
    let failure = true
    index = new LinkIndex(
      root,
      async () => {
        if (failure) throw new Error('Temporary directory error')
        return [...files]
      },
      () => undefined,
    )
    await expect(index.query(b)).rejects.toThrow('Temporary directory error')
    failure = false
    expect((await index.query(b)).backlinks.map((l) => l.source)).toEqual([c, a])
    index.invalidate(c)
    expect((await index.query(b)).backlinks.map((l) => l.source)).toEqual([c, a])
  })

  it('yields to the event loop even when every file is already open in memory', async () => {
    files = Array.from({ length: 300 }, (_, i) => file(i + '.md'))
    for (const p of files) drafts.set(p, '# Note\n\n[B](B.md)')
    let ticked = false
    setImmediate(() => {
      ticked = true
    })
    await index.query(files[0])
    expect(ticked).toBe(true)
    expect(index.statistics.reads).toBe(0)
  })
})
