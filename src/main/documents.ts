import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import writeFileAtomic from 'write-file-atomic'
import { isInside } from './links'
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
    const key = process.platform === 'win32' ? file.toLowerCase() : file
    const previous = this.queues.get(key) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(operation)
    this.queues.set(key, task)
    try {
      return await task
    } finally {
      if (this.queues.get(key) === task) this.queues.delete(key)
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
  private async assertVacant(file: string) {
    const key = process.platform === 'win32' ? file.toLowerCase() : file
    if (
      [...this.sessions.keys()].some(
        (p) => (process.platform === 'win32' ? p.toLowerCase() : p) === key,
      )
    )
      throw new Error('目标路径已在应用中打开，请选择其他位置。')
    try {
      await fs.access(this.draftPath(file))
      throw new Error('目标路径存在恢复草稿，请先恢复或备份该草稿，再使用此路径。')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  async create(file: string) {
    return this.serial(file, async () => {
      if (!/\.(md|markdown)$/i.test(file)) throw new Error('请选择 Markdown 文件名。')
      await this.assertVacant(file)
      try {
        await fs.writeFile(
          file,
          '# ' + path.basename(file).replace(/\.(md|markdown)$/i, '') + '\n\n',
          { flag: 'wx' },
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error('此位置已存在文件或文件夹，请使用其他名称。')
        throw error
      }
      return file
    })
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
  async relocate(file: string, target: string, owner: number): Promise<DocumentSnapshot> {
    // All operations use the same queues; sorted acquisition avoids opposite-move deadlocks.
    const paths = [
      ...new Set([file, target].map((p) => (process.platform === 'win32' ? p.toLowerCase() : p))),
    ].sort()
    const lock = (index: number): Promise<DocumentSnapshot> =>
      index < paths.length ? this.serial(paths[index], () => lock(index + 1)) : move()
    const move = async () => {
      const session = this.owned(file, owner)
      if (session.dirty) throw new Error('请先保存当前笔记，再重命名或移动。')
      if (file === target) return this.snapshot(session, owner)
      if (!/\.(md|markdown)$/i.test(target)) throw new Error('目标必须是 Markdown 文件。')
      await this.assertVacant(target)
      const bytes = await this.bytes(file)
      if (digest(bytes) !== session.revision)
        throw new Error('文件已被外部程序修改，请先载入磁盘版本或处理冲突。')
      const before = await fs.lstat(file)
      if (!before.isFile()) throw new Error('源路径不再是普通文件，请重新打开笔记。')
      await fs.rm(this.draftPath(file), { force: true })
      // link is exclusive: unlike rename on POSIX, it cannot overwrite an existing target.
      // A crash between link and unlink leaves both names pointing at the original bytes.
      try {
        await fs.link(file, target)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST') throw new Error('目标已存在，未覆盖任何文件。请使用其他名称。')
        if (['EXDEV', 'ENOTSUP', 'EOPNOTSUPP'].includes(code ?? ''))
          throw new Error(
            '此位置不支持安全移动；请使用同一磁盘内的文件夹，或在系统文件管理器中操作。',
          )
        if (['EPERM', 'EACCES'].includes(code ?? ''))
          throw new Error('无法在这两个位置安全移动，请检查写入权限或改用系统文件管理器。')
        throw error
      }
      try {
        const current = await fs.lstat(file)
        if (
          current.dev !== before.dev ||
          current.ino !== before.ino ||
          digest(await this.bytes(file)) !== session.revision ||
          digest(await this.bytes(target)) !== session.revision
        )
          throw new Error('移动期间文件被外部程序修改，操作已中止。')
        await fs.unlink(file)
      } catch (error) {
        try {
          const linked = await fs.lstat(target)
          if (
            linked.dev !== before.dev ||
            linked.ino !== before.ino ||
            digest(await this.bytes(target)) !== session.revision
          )
            throw new Error('Target changed')
          await fs.unlink(target)
        } catch {
          throw new Error('移动未完成，路径状态已改变。请检查源路径和目标路径后再操作。')
        }
        throw error
      }
      this.sessions.delete(file)
      session.path = target
      this.sessions.set(target, session)
      return this.snapshot(session, owner)
    }
    return lock(0)
  }
  async relocateFolder(
    sourceDir: string,
    targetDir: string,
  ): Promise<{ previous: string; document: DocumentSnapshot; owner: number }[]> {
    if (sourceDir === targetDir) return []
    const affected = [...this.sessions.values()].filter((s) => isInside(sourceDir, s.path))
    const paths = [
      ...new Set(
        [sourceDir, targetDir, ...affected.map((s) => s.path)].map((p) =>
          process.platform === 'win32' ? p.toLowerCase() : p,
        ),
      ),
    ].sort()
    const lock = (
      index: number,
    ): Promise<{ previous: string; document: DocumentSnapshot; owner: number }[]> =>
      index < paths.length ? this.serial(paths[index], () => lock(index + 1)) : move()
    const move = async () => {
      const currentAffected = [...this.sessions.values()].filter((s) => isInside(sourceDir, s.path))
      if (
        currentAffected.length !== affected.length ||
        currentAffected.some((s) => !affected.includes(s))
      )
        throw new Error('文件夹正在被其他操作访问，请稍后再试。')
      if ([...this.sessions.values()].some((s) => isInside(targetDir, s.path)))
        throw new Error('目标路径下已有打开的笔记，请选择其他位置。')
      let beforeStat
      try {
        beforeStat = await fs.lstat(sourceDir)
      } catch {
        throw new Error('源路径不再是普通文件夹，请刷新后重试。')
      }
      if (!beforeStat.isDirectory()) throw new Error('源路径不再是普通文件夹，请刷新后重试。')
      try {
        await fs.lstat(targetDir)
        throw new Error('目标已存在，未覆盖任何文件或文件夹。请使用其他名称。')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      for (const session of affected) {
        if (session.dirty) throw new Error('文件夹内有未保存的笔记，请先保存后再重命名或移动。')
        const bytes = await this.bytes(session.path)
        if (digest(bytes) !== session.revision)
          throw new Error('文件夹内有笔记已被外部程序修改，请先载入磁盘版本或处理冲突。')
      }
      try {
        const draftEntries = await fs.readdir(this.recoveryDir)
        for (const entry of draftEntries) {
          if (!entry.endsWith('.json')) continue
          let draft: { path?: unknown } | undefined
          try {
            draft = JSON.parse(await fs.readFile(path.join(this.recoveryDir, entry), 'utf8'))
          } catch {
            continue
          }
          if (typeof draft?.path !== 'string') continue
          if (isInside(targetDir, draft.path))
            throw new Error('目标路径下存在恢复草稿，请先恢复或备份该草稿，再使用此路径。')
          if (isInside(sourceDir, draft.path))
            throw new Error('文件夹内存在未恢复的草稿，请先打开并保存或处理该笔记后再移动。')
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      try {
        await fs.rename(sourceDir, targetDir)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (['EEXIST', 'ENOTEMPTY'].includes(code ?? ''))
          throw new Error('目标已存在，未覆盖任何文件或文件夹。请使用其他名称。')
        if (['EXDEV', 'ENOTSUP', 'EOPNOTSUPP'].includes(code ?? ''))
          throw new Error(
            '此位置不支持安全移动；请使用同一磁盘内的文件夹，或在系统文件管理器中操作。',
          )
        if (['EPERM', 'EACCES', 'EBUSY'].includes(code ?? ''))
          throw new Error('无法在这两个位置安全移动，请检查写入权限或关闭占用该文件夹的程序。')
        throw error
      }
      const moved: { previous: string; document: DocumentSnapshot; owner: number }[] = []
      for (const session of affected) {
        const previous = session.path
        const nextPath = path.join(targetDir, path.relative(sourceDir, previous))
        this.sessions.delete(previous)
        session.path = nextPath
        this.sessions.set(nextPath, session)
        moved.push({
          previous,
          document: this.snapshot(session, session.owner),
          owner: session.owner,
        })
      }
      return moved
    }
    return lock(0)
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
