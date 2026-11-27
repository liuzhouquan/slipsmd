import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import writeFileAtomic from 'write-file-atomic'
import type { DocumentSnapshot } from '../shared/types'

export const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex')
const MAX_BYTES = 20 * 1024 * 1024
interface Session {
  path: string
  text: string
  revision: string
  owner: number
  dirty: boolean
  recovered: boolean
  eol: string
  bom: boolean
}
export class DocumentStore {
  private sessions = new Map<string, Session>()
  private queues = new Map<string, Promise<unknown>>()
  constructor(
    private recoveryDir: string,
    private changed: (doc: DocumentSnapshot) => void = () => {},
  ) {}
  private async serial<T>(file: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(file) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(operation)
    this.queues.set(file, task)
    try {
      return await task
    } finally {
      if (this.queues.get(file) === task) this.queues.delete(file)
    }
  }
  private draftPath(file: string) {
    return path.join(this.recoveryDir, digest(file) + '.json')
  }
  private snapshot(session: Session, owner: number): DocumentSnapshot {
    return {
      path: session.path,
      text: session.text,
      revision: session.revision,
      readOnly: session.owner !== owner,
      dirty: session.dirty,
      recovered: session.recovered,
    }
  }
  private owned(file: string, owner: number) {
    const session = this.sessions.get(file)
    if (!session || session.owner !== owner)
      throw new Error('此文件已在另一个窗口编辑，请回到原窗口。')
    return session
  }
  private async bytes(file: string) {
    const stat = await fs.stat(file)
    if (stat.size > MAX_BYTES) throw new Error('首版支持最大 20 MB 的 Markdown 文件。')
    const bytes = await fs.readFile(file)
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (bytes.includes(0)) throw new Error('此文件不是 UTF-8 Markdown 文本。')
    return bytes
  }
  async open(file: string, owner: number): Promise<DocumentSnapshot> {
    return this.serial(file, async () => {
      let session = this.sessions.get(file)
      if (session) {
        if (!session.dirty) {
          const bytes = await this.bytes(file)
          if (digest(bytes) !== session.revision) {
            const raw = bytes.toString('utf8')
            session.text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
            session.revision = digest(bytes)
            session.eol = raw.includes('\r\n') ? '\r\n' : '\n'
            session.bom = raw.startsWith('\uFEFF')
          }
        }
        return this.snapshot(session, owner)
      }
      const bytes = await this.bytes(file)
      const raw = bytes.toString('utf8')
      session = {
        path: file,
        text: raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'),
        revision: digest(bytes),
        owner,
        dirty: false,
        recovered: false,
        eol: raw.includes('\r\n') ? '\r\n' : '\n',
        bom: raw.startsWith('\uFEFF'),
      }
      try {
        const draft = JSON.parse(await fs.readFile(this.draftPath(file), 'utf8'))
        if (draft.path === file && typeof draft.text === 'string' && draft.text !== session.text) {
          session.text = draft.text
          session.revision = draft.revision
          session.dirty = true
          session.recovered = true
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('恢复草稿无法读取；请先备份应用数据目录。')
      }
      this.sessions.set(file, session)
      return this.snapshot(session, owner)
    })
  }
  async stage(file: string, text: string, owner: number, revision: string) {
    return this.serial(file, async () => {
      const session = this.owned(file, owner)
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('文档超过首版大小限制。')
      const stale = session.revision !== revision
      session.text = text
      session.revision = revision
      session.dirty = true
      await fs.mkdir(this.recoveryDir, { recursive: true })
      await writeFileAtomic(
        this.draftPath(file),
        JSON.stringify({ path: file, text, revision: session.revision }),
      )
      if (stale) throw new Error('文档版本已改变。你的编辑已保留为草稿，请另存副本或载入磁盘版本。')
    })
  }
  async save(file: string, owner: number) {
    return this.serial(file, async () => {
      const session = this.owned(file, owner)
      if (!session.dirty) return this.snapshot(session, owner)
      const disk = await this.bytes(file)
      if (digest(disk) !== session.revision)
        throw new Error(
          '文件已被外部程序修改。你的编辑仍在恢复草稿中；请另存副本，或重新载入磁盘版本。',
        )
      const encoded =
        (session.bom ? '\uFEFF' : '') +
        session.text.replace(/\r\n/g, '\n').replace(/\n/g, session.eol)
      await writeFileAtomic(file, encoded)
      session.revision = digest(encoded)
      session.dirty = false
      session.recovered = false
      await fs.rm(this.draftPath(file), { force: true })
      const result = this.snapshot(session, owner)
      this.changed(result)
      return result
    })
  }
  async append(file: string, text: string) {
    return this.serial(file, async () => {
      const session = this.sessions.get(file)
      if (session) {
        if (session.dirty) throw new Error('目标笔记还有未保存编辑，请先在原窗口保存。')
        if (digest(await this.bytes(file)) !== session.revision)
          throw new Error('目标文件有外部修改，请先处理冲突。')
        const next = session.text.replace(/\s*$/, '') + '\n\n' + text + '\n'
        const encoded = (session.bom ? '\uFEFF' : '') + next.replace(/\n/g, session.eol)
        await writeFileAtomic(file, encoded)
        session.text = next
        session.revision = digest(encoded)
        session.dirty = false
        await fs.rm(this.draftPath(file), { force: true })
        this.changed(this.snapshot(session, session.owner))
      } else {
        let raw = ''
        try {
          raw = (await this.bytes(file)).toString('utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const eol = raw.includes('\r\n') ? '\r\n' : '\n'
        await writeFileAtomic(
          file,
          raw.replace(/\s*$/, '') + eol + eol + text.replace(/\n/g, eol) + eol,
        )
      }
    })
  }
  async release(file: string, owner: number) {
    return this.serial(file, async () => {
      const session = this.sessions.get(file)
      if (session?.owner === owner) {
        if (session.dirty) throw new Error('请先保存或另存当前文档。')
        this.sessions.delete(file)
      }
    })
  }
  async reload(file: string, owner: number) {
    return this.serial(file, async () => {
      this.owned(file, owner)
      const bytes = await this.bytes(file)
      const raw = bytes.toString('utf8')
      const session: Session = {
        path: file,
        text: raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'),
        revision: digest(bytes),
        owner,
        dirty: false,
        recovered: false,
        eol: raw.includes('\r\n') ? '\r\n' : '\n',
        bom: raw.startsWith('\uFEFF'),
      }
      await fs.rm(this.draftPath(file), { force: true })
      this.sessions.set(file, session)
      return this.snapshot(session, owner)
    })
  }
  getText(file: string) {
    return this.sessions.get(file)?.text
  }
  ownedPaths(owner: number) {
    return [...this.sessions.values()].filter((s) => s.owner === owner).map((s) => s.path)
  }
  owner(file: string) {
    return this.sessions.get(file)?.owner
  }
  dirty(owner: number) {
    return [...this.sessions.values()].some((s) => s.owner === owner && s.dirty)
  }
  abandon(owner: number) {
    for (const session of this.sessions.values())
      if (session.owner === owner) this.sessions.delete(session.path)
  }
}
