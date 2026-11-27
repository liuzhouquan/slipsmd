import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PinnedLocation, PinKind } from '../shared/types'

const MAX_PINS = 50
const key = (file: string) => {
  const normalized = path.normalize(file)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
const label = (file: string) => path.basename(file) || file

export function normalizePins(value: unknown): PinnedLocation[] {
  if (!Array.isArray(value)) return []
  const result: PinnedLocation[] = []
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(item.id) ||
      typeof item.path !== 'string' ||
      item.path.length > 32768 ||
      item.path.includes('\0') ||
      !path.isAbsolute(item.path) ||
      !['file', 'folder'].includes(item.kind) ||
      (item.kind === 'file' && !/\.(md|markdown)$/i.test(item.path))
    )
      continue
    if (result.some((pin) => pin.id === item.id || key(pin.path) === key(item.path))) continue
    result.push({ id: item.id, path: item.path, name: label(item.path), kind: item.kind })
    if (result.length === MAX_PINS) break
  }
  return result
}

export async function createPin(candidate: string, kind: PinKind): Promise<PinnedLocation> {
  const canonical = await fs.realpath(candidate)
  const stat = await fs.stat(canonical)
  if (
    (kind === 'folder' && !stat.isDirectory()) ||
    (kind === 'file' && (!stat.isFile() || !/\.(md|markdown)$/i.test(canonical)))
  )
    throw new Error('请选择文件夹或 Markdown 文件。')
  return { id: randomUUID(), path: canonical, name: label(canonical), kind }
}

export function addPin(pins: PinnedLocation[], pin: PinnedLocation): PinnedLocation[] {
  if (pins.some((existing) => key(existing.path) === key(pin.path))) return pins
  if (pins.length >= MAX_PINS) throw new Error('最多固定 50 个快捷方式，请先移除不常用的入口。')
  return [pin, ...pins]
}

export async function resolvePin(pin: PinnedLocation): Promise<string> {
  let current: PinnedLocation
  try {
    current = await createPin(pin.path, pin.kind)
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw new Error('快捷方式目标已移动或暂时不可用，请检查路径或重新固定。')
    throw error
  }
  if (key(current.path) !== key(pin.path))
    throw new Error('快捷方式路径已改变，请通过添加快捷方式重新选择目标。')
  return current.path
}
