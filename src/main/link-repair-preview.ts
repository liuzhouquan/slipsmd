import fs from 'node:fs/promises'
import path from 'node:path'
import { constants, type BigIntStats } from 'node:fs'
import { createHash } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { isInside } from './links'
import { moveTarget } from './relocation'
import { excludedDirectories, relativeParts } from './workspace-paths'
import { pathKey, planUrlEdits, type RepairDiagnostic, type UrlEdit } from './link-repair'

const defaults = {
  maxFiles: 10000,
  maxDepth: 24,
  maxFileBytes: 20 * 1024 * 1024,
  maxBytes: 64 * 1024 * 1024,
  maxEdits: 10000,
}
type Limits = typeof defaults
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const signature = (stat: BigIntStats) =>
  `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
const relative = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/')
export interface IdentifiedEdit extends UrlEdit {
  id: string
}
export interface RepairFilePreview {
  pathBefore: string
  pathAfter: string
  beforeRevision: string
  beforeIdentity: string
  edits: IdentifiedEdit[]
}
export interface MoveLinkPreview {
  version: 1
  readOnly: true
  root: string
  source: string
  target: string
  planId: string
  complete: boolean
  files: RepairFilePreview[]
  diagnostics: RepairDiagnostic[]
  summary: {
    scannedFiles: number
    scannedBytes: number
    affectedFiles: number
    proposedEdits: number
    selectedEdits: number
  }
}

function previewLimits(overrides: Partial<Limits>) {
  const result = { ...defaults, ...overrides }
  for (const name of Object.keys(defaults) as (keyof Limits)[])
    if (!Number.isInteger(result[name]) || result[name] <= 0 || result[name] > defaults[name])
      throw new Error('预览上限只允许设置为更小的正整数。')
  return result
}

async function listFiles(root: string, limits: Limits, diagnostics: RepairDiagnostic[]) {
  const files: string[] = []
  let limited = false
  const visit = async (folder: string, depth: number) => {
    if (limited) return
    if (depth > limits.maxDepth) {
      diagnostics.push({
        level: 'error',
        code: 'depth-limit',
        file: relative(root, folder),
        message: '目录深度超过预览上限。',
      })
      return
    }
    try {
      // Recheck each directory before traversal; never descend through an alias.
      if (pathKey(await fs.realpath(folder)) !== pathKey(folder)) throw new Error('Directory alias')
      const entries = (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )
      for (const entry of entries) {
        if (limited) break
        if (
          entry.name.startsWith('.') ||
          excludedDirectories.has(entry.name) ||
          entry.isSymbolicLink()
        )
          continue
        const file = path.join(folder, entry.name)
        if (entry.isDirectory()) await visit(file, depth + 1)
        else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
          if (files.length === limits.maxFiles) {
            limited = true
            diagnostics.push({
              level: 'error',
              code: 'file-limit',
              message: 'Markdown 文件数量超过预览上限。',
            })
            break
          }
          files.push(file)
        }
      }
    } catch {
      diagnostics.push({
        level: 'error',
        code: 'directory-unreadable',
        file: relative(root, folder),
        message: '目录不可读取或路径已改变，预览覆盖不完整。',
      })
    }
  }
  await visit(root, 0)
  return files.sort()
}

async function stampFile(root: string, file: string) {
  const canonical = await fs.realpath(file)
  if (!isInside(root, canonical) || pathKey(canonical) !== pathKey(file))
    throw new Error('文件路径已改变或越界。')
  const stat = await fs.lstat(file, { bigint: true })
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('源不是普通文件。')
  return stat
}
async function readSnapshot(file: string, before: BigIntStats) {
  const flags =
    process.platform === 'win32' ? 'r' : constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  const handle = await fs.open(file, flags)
  try {
    if (signature(await handle.stat({ bigint: true })) !== signature(before))
      throw new Error('读取前文件已改变。')
    // Bounded read, including one byte to detect growth; readFile could grow unbounded.
    const buffer = Buffer.alloc(Number(before.size) + 1)
    let length = 0
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    if (
      length !== Number(before.size) ||
      signature(await handle.stat({ bigint: true })) !== signature(before)
    )
      throw new Error('读取过程中文件已改变。')
    const bytes = buffer.subarray(0, length)
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (bytes.includes(0)) throw new Error('文件不是 UTF-8 Markdown。')
    return bytes
  } finally {
    await handle.close()
  }
}
async function assertMissing(file: string) {
  try {
    await fs.lstat(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error('目标已存在；预览不会覆盖、合并或执行移动。')
}

export async function previewLinkRepair(
  rootInput: string,
  sourceInput: string,
  targetInput: string,
  overrides: Partial<Limits> = {},
): Promise<MoveLinkPreview> {
  const limits = previewLimits(overrides)
  const root = await fs.realpath(rootInput)
  if (!(await fs.stat(root)).isDirectory()) throw new Error('请选择工作区目录。')
  const source = path.join(root, ...relativeParts(sourceInput))
  if (
    !/\.(md|markdown)$/i.test(source) ||
    path
      .relative(root, source)
      .split(path.sep)
      .some((part) => excludedDirectories.has(part))
  )
    throw new Error('源必须是工作区可见的 Markdown 文件。')
  await stampFile(root, source)
  const target = await moveTarget(source, root, targetInput)
  if (pathKey(source) === pathKey(target)) throw new Error('源与目标相同，无需移动预览。')
  if ([source, target].some((file) => pathKey(file) === pathKey(path.join(root, 'Chat.md'))))
    throw new Error('Chat.md 是工作区收集箱，不能作为移动源或目标。')
  await assertMissing(target)
  const diagnostics: RepairDiagnostic[] = []
  const paths = await listFiles(root, limits, diagnostics)
  const files: RepairFilePreview[] = []
  const inventory: { file: string; revision: string; stamp: string }[] = []
  let scannedBytes = 0
  let budgetBytes = 0
  let proposedEdits = 0
  for (const file of paths) {
    try {
      const before = await stampFile(root, file)
      if (before.size > limits.maxFileBytes) {
        diagnostics.push({
          level: 'error',
          code: 'file-size-limit',
          file: relative(root, file),
          message: '文件超过单篇预览大小上限。',
        })
        continue
      }
      if (budgetBytes + Number(before.size) > limits.maxBytes) {
        diagnostics.push({
          level: 'error',
          code: 'bytes-limit',
          file: relative(root, file),
          message: '累计正文超过预览读取上限，停止扫描。',
        })
        break
      }
      budgetBytes += Number(before.size)
      const bytes = await readSnapshot(file, before)
      if (signature(await stampFile(root, file)) !== signature(before))
        throw new Error('File changed')
      const revision = hash(bytes)
      const result = planUrlEdits(bytes.toString('utf8'), { root, source, target, document: file })
      diagnostics.push(
        ...result.diagnostics.map((item) => ({ ...item, file: relative(root, file) })),
      )
      if (diagnostics.length > 1000) {
        diagnostics.push({
          level: 'error',
          code: 'diagnostic-limit',
          message: '诊断数量超过 1,000 项上限，停止扫描。',
        })
        break
      }
      inventory.push({ file: relative(root, file), revision, stamp: signature(before) })
      scannedBytes += bytes.length
      if (proposedEdits + result.edits.length > limits.maxEdits) {
        diagnostics.push({
          level: 'error',
          code: 'edit-limit',
          message: '建议编辑超过预览上限，停止扫描。',
        })
        break
      }
      if (result.edits.length)
        files.push({
          pathBefore: relative(root, file),
          pathAfter: relative(root, pathKey(file) === pathKey(source) ? target : file),
          beforeRevision: revision,
          beforeIdentity: `${before.dev}:${before.ino}`,
          edits: result.edits.map((edit) => ({
            ...edit,
            id: 'e' + String(++proposedEdits).padStart(6, '0'),
          })),
        })
    } catch {
      diagnostics.push({
        level: 'error',
        code: 'file-unreadable',
        file: relative(root, file),
        message: '文件不可读取、UTF-8 无效或读取过程中发生变化。',
      })
    }
    if (inventory.length % 16 === 0) await setImmediate()
  }
  const afterPaths = await listFiles(root, limits, diagnostics)
  if (paths.length !== afterPaths.length || paths.some((file, i) => file !== afterPaths[i]))
    diagnostics.push({
      level: 'error',
      code: 'tree-changed',
      message: '扫描期间目录清单改变，请重新预览。',
    })
  for (const item of inventory) {
    try {
      if (signature(await stampFile(root, path.join(root, ...item.file.split('/')))) !== item.stamp)
        throw new Error('Changed')
    } catch {
      diagnostics.push({
        level: 'error',
        code: 'file-changed',
        file: item.file,
        message: '文件在扫描结束前已改变，请重新预览。',
      })
    }
  }
  if (!inventory.some((item) => pathKey(item.file) === pathKey(relative(root, source))))
    diagnostics.push({
      level: 'error',
      code: 'source-not-scanned',
      message: '未能完整读取移动源，不能形成完整预览。',
    })
  try {
    await assertMissing(target)
  } catch {
    diagnostics.push({
      level: 'error',
      code: 'target-changed',
      message: '移动目标在扫描期间出现，请重新选择目标。',
    })
  }
  const complete = !diagnostics.some((item) => item.level === 'error')
  const move = { root, source: relative(root, source), target: relative(root, target) }
  const planId = hash(
    JSON.stringify({
      version: 1,
      ...move,
      complete,
      inventory,
      files,
      diagnostics,
    }),
  )
  return {
    version: 1,
    readOnly: true,
    ...move,
    planId,
    complete,
    files,
    diagnostics,
    summary: {
      scannedFiles: inventory.length,
      scannedBytes,
      affectedFiles: files.length,
      proposedEdits,
      selectedEdits: proposedEdits,
    },
  }
}

export function selectPreview(
  preview: MoveLinkPreview,
  expectedPlanId: string,
  ids: readonly string[],
): MoveLinkPreview {
  if (preview.planId !== expectedPlanId) throw new Error('预览已过期，请重新生成并检查计划。')
  if (!preview.complete) throw new Error('扫描未完成，不能生成选中方案。')
  const known = new Set(preview.files.flatMap((file) => file.edits.map((edit) => edit.id)))
  const selected = new Set(ids)
  if (selected.size !== ids.length || ids.some((id) => !known.has(id)))
    throw new Error('选择含未知或重复编辑 ID。')
  const files = preview.files
    .map((file) => ({ ...file, edits: file.edits.filter((edit) => selected.has(edit.id)) }))
    .filter((file) => file.edits.length)
  return {
    ...preview,
    files,
    summary: { ...preview.summary, affectedFiles: files.length, selectedEdits: selected.size },
  }
}
