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
