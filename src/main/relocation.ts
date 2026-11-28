import fs from 'node:fs/promises'
import path from 'node:path'
import { isInside } from './links'
import { relativeParts, workspaceTarget } from './workspace-paths'

export async function moveTarget(source: string, root: string | null, destination: unknown) {
  const parts = relativeParts(destination)
  const inWorkspace = !!root && isInside(root, source)
  if (!inWorkspace && parts.length !== 1)
    throw new Error('单文件模式只支持同目录重命名；移动文件请先打开所在文件夹。')
  const scope = inWorkspace ? root! : path.dirname(source)
  const name = parts.pop()!
  parts.push(/\.(md|markdown)$/i.test(name) ? name : name + '.md')
  const target = await workspaceTarget(
    scope,
    parts,
    false,
    '目标文件夹不存在或不可访问，请先创建文件夹再移动。',
  )
  if (
    process.platform === 'win32' &&
    source !== target &&
    source.toLowerCase() === target.toLowerCase()
  )
    throw new Error('仅修改大小写时，请先改为一个临时文件名，再改为目标名称。')
  return target
}

export async function folderMoveTarget(source: string, root: string | null, destination: unknown) {
  if (!root || !isInside(root, source))
    throw new Error('请先打开所在工作区文件夹，再重命名或移动文件夹。')
  if (path.relative(root, source) === '') throw new Error('不能直接重命名或移动当前工作区根目录。')
  try {
    const stat = await fs.lstat(source)
    if (!stat.isDirectory()) throw new Error('Not a directory')
  } catch {
    throw new Error('源路径不是可移动的普通文件夹。')
  }
  const parts = relativeParts(destination)
  const target = await workspaceTarget(
    root,
    parts,
    true,
    '目标上级文件夹不存在或不可访问，请先创建上级文件夹。',
  )
  if (target !== source && isInside(source, target))
    throw new Error('不能将文件夹移动到自身或其子文件夹内。')
  if (
    process.platform === 'win32' &&
    source !== target &&
    source.toLowerCase() === target.toLowerCase()
  )
    throw new Error('仅修改大小写时，请先改为一个临时文件夹名，再改为目标名称。')
  return target
}

export function replaceFolderPrefix(
  candidate: string,
  fromDir: string,
  toDir: string,
): string | null {
  if (!isInside(fromDir, candidate)) return null
  const rel = path.relative(fromDir, candidate)
  return rel ? path.join(toDir, rel) : toDir
}
