import fs from 'node:fs/promises'
import path from 'node:path'
import { isInside } from './links'

export const excludedDirectories = new Set([
  '.git',
  'node_modules',
  '.obsidian',
  '.slipsmd',
  'dist',
])

export function relativeParts(value: unknown): string[] {
  if (typeof value !== 'string' || !value || value.length > 2048)
    throw new Error('请输入文件名或相对工作区的路径。')
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value))
    throw new Error('请使用相对路径，不能操作当前工作区外的位置。')
  const parts = value.split(/[\\/]/)
  if (
    parts.some(
      (part) =>
        !part ||
        part.length > 200 ||
        part.startsWith('.') ||
        /[<>:"|?*\x00-\x1f]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part),
    )
  )
    throw new Error('路径包含隐藏名称、无效字符或 Windows 保留名称。请使用普通文件夹和文件名。')
  return parts
}

export async function workspaceTarget(
  scope: string,
  parts: string[],
  directory = false,
  missingMessage = '父文件夹不存在或不可访问，请先创建上级文件夹。',
) {
  if (parts.slice(0, directory ? undefined : -1).some((part) => excludedDirectories.has(part)))
    throw new Error('该目录会被文件树忽略，请使用其他文件夹名称。')
  let parent: string
  try {
    parent = await fs.realpath(path.join(scope, ...parts.slice(0, -1)))
    if (!(await fs.stat(parent)).isDirectory()) throw new Error('Not a directory')
  } catch {
    throw new Error(missingMessage)
  }
  if (!isInside(scope, parent)) throw new Error('目标文件夹指向工作区外，不能操作该位置。')
  if (
    path
      .relative(scope, parent)
      .split(path.sep)
      .some((part) => part.startsWith('.') || excludedDirectories.has(part))
  )
    throw new Error('该目录会被文件树忽略，请使用其他文件夹名称。')
  return path.join(parent, parts.at(-1)!)
}
