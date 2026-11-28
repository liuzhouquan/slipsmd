import fs from 'node:fs/promises'
import { relativeParts, workspaceTarget } from './workspace-paths'

export async function newNoteTarget(root: string, destination: unknown) {
  const parts = relativeParts(destination)
  const name = parts.pop()!
  parts.push(/\.(md|markdown)$/i.test(name) ? name : name + '.md')
  return workspaceTarget(root, parts)
}

export async function createDirectory(root: string, destination: unknown) {
  const parts = relativeParts(destination)
  if (parts.length === 1 && parts[0].toLowerCase() === 'chat.md')
    throw new Error('Chat.md 留作收集箱文件，请使用其他文件夹名称。')
  const target = await workspaceTarget(root, parts, true)
  try {
    await fs.mkdir(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('此位置已存在文件或文件夹，请使用其他名称。')
    throw error
  }
  return target
}
