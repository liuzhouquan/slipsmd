import fs from 'node:fs/promises'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'
import type { BigIntStats } from 'node:fs'
import { extractLinks, isInside } from './links'
import type { LinkEntry, LinkInfo } from '../shared/types'

const MAX_BYTES = 20 * 1024 * 1024
const CONCURRENCY = 8
const key = (file: string) =>
  process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file)
const stamp = (stat: BigIntStats) =>
  `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
interface Entry {
  text?: string
  stamp?: string
  links: LinkEntry[]
}

// The index is disposable. Markdown and DocumentStore remain the only sources of text.
export class LinkIndex {
  private entries = new Map<string, Entry>()
  private backlinks = new Map<string, LinkEntry[]>()
  private paths: string[] = []
  private pending: Promise<number> | undefined
  private generation = 0
  private changed = true
  private counters = { scans: 0, reads: 0, parses: 0, hits: 0 }

  constructor(
    private root: string,
    private listFiles: () => Promise<string[]>,
    private currentText: (file: string) => string | undefined,
  ) {}

  get statistics() {
    return { ...this.counters }
  }

  invalidate(file: string) {
    this.generation++
    this.changed = true
    this.entries.delete(key(file))
  }

  async query(file: string): Promise<LinkInfo> {
    // Concurrent windows share the scan. An edit arriving during it gets another pass.
    for (;;) {
      if (!this.pending) {
        const task = this.refresh()
        this.pending = task
        void task
          .finally(() => {
            if (this.pending === task) this.pending = undefined
          })
          .catch(() => {})
      }
      const generation = await this.pending
      if (generation === this.generation) break
    }
    return {
      outgoing: this.entries.get(key(file))?.links ?? [],
      backlinks: this.backlinks.get(key(file)) ?? [],
    }
  }

  private async inspect(file: string): Promise<Entry | undefined> {
    if (!isInside(this.root, file)) return undefined
    const cached = this.entries.get(key(file))
    const text = this.currentText(file)
    if (text !== undefined) {
      if (cached?.text === text) {
        this.counters.hits++
        return cached
      }
      this.counters.parses++
      return { text, links: extractLinks(file, text, this.root) }
    }
    // Do not retain closed documents, and do not trust only a watcher notification.
    const canonical = await fs.realpath(file)
    if (!isInside(this.root, canonical) || key(canonical) !== key(file)) return undefined
    const before = await fs.stat(file, { bigint: true })
    if (!before.isFile() || before.size > MAX_BYTES) return undefined
    const signature = stamp(before)
    if (cached?.text === undefined && cached?.stamp === signature) {
      this.counters.hits++
      return cached
    }
    const handle = await fs.open(file, 'r')
    try {
      if (stamp(await handle.stat({ bigint: true })) !== signature) return undefined
      this.counters.reads++
      const bytes = await handle.readFile()
      if (
        bytes.length > MAX_BYTES ||
        bytes.includes(0) ||
        stamp(await handle.stat({ bigint: true })) !== signature ||
        stamp(await fs.stat(file, { bigint: true })) !== signature
      )
        return undefined
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      this.counters.parses++
      return { stamp: signature, links: extractLinks(file, content, this.root) }
    } finally {
      await handle.close()
    }
  }

  private async refresh() {
    const started = this.generation
    this.counters.scans++
    const paths = (await this.listFiles()).filter((file) => isInside(this.root, file))
    const present = new Set(paths.map(key))
    for (const file of this.entries.keys())
      if (!present.has(file)) {
        this.entries.delete(file)
        this.changed = true
      }
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, paths.length) }, async () => {
        let count = 0
        while (cursor < paths.length) {
          const file = paths[cursor++]
          const generation = this.generation
          let entry: Entry | undefined
          try {
            entry = await this.inspect(file)
          } catch {
            // Unreadable/deleted/invalid files must not leave cached ghost links.
          }
          if (generation === this.generation) {
            if (this.entries.get(key(file)) !== entry) this.changed = true
            if (entry) this.entries.set(key(file), entry)
            else this.entries.delete(key(file))
          }
          // In-memory documents can otherwise keep a large scan in the microtask queue.
          if (++count % 16 === 0) await setImmediate()
        }
      }),
    )
    if (paths.length !== this.paths.length || paths.some((file, i) => file !== this.paths[i]))
      this.changed = true
    this.paths = paths
    if (!this.changed) return started
    this.backlinks.clear()
    for (const source of this.paths)
      for (const link of this.entries.get(key(source))?.links ?? []) {
        const target = key(link.target)
        let incoming = this.backlinks.get(target)
        if (!incoming) this.backlinks.set(target, (incoming = []))
        incoming.push(link)
      }
    this.changed = false
    return started
  }
}
