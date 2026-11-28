import fs from 'node:fs/promises'
import path from 'node:path'
import { isInside } from './links'

export async function moveTarget(source: string, root: string | null, destination: unknown) {
  if (typeof destination !== 'string' || !destination || destination.length > 2048)
    throw new Error('请输入新文件名或相对工作区的路径。')
  if (path.posix.isAbsolute(destination) || path.win32.isAbsolute(destination))
    throw new Error('请使用相对路径，不能移到当前工作区外。')
  const parts = destination.split(/[\\/]/)
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
  const inWorkspace = !!root && isInside(root, source)
  if (!inWorkspace && parts.length !== 1)
    throw new Error('单文件模式只支持同目录重命名；移动文件请先打开所在文件夹。')
  const scope = inWorkspace ? root! : path.dirname(source)
  const name = parts.pop()!
  parts.push(/\.(md|markdown)$/i.test(name) ? name : name + '.md')
  let parent: string
  try {
    parent = await fs.realpath(path.join(scope, ...parts.slice(0, -1)))
    if (!(await fs.stat(parent)).isDirectory()) throw new Error('Not a directory')
  } catch {
    throw new Error('目标文件夹不存在或不可访问，请先创建文件夹再移动。')
  }
  if (!isInside(scope, parent)) throw new Error('目标文件夹指向工作区外，不能移到该位置。')
  const target = path.join(parent, parts.at(-1)!)
  if (
    process.platform === 'win32' &&
    source !== target &&
    source.toLowerCase() === target.toLowerCase()
  )
    throw new Error('仅修改大小写时，请先改为一个临时文件名，再改为目标名称。')
  return target
}
