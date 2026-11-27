import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { addPin, createPin, normalizePins, resolvePin } from '../src/main/pins'

let root: string, file: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-pins-'))
  file = path.join(root, '笔记 with spaces.md')
  await fs.writeFile(file, '# Keep my content\n')
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('persistent shortcuts', () => {
  it('accepts Markdown files and folders without modifying their contents', async () => {
    const pin = await createPin(file, 'file')
    expect(await resolvePin(pin)).toBe(await fs.realpath(file))
    expect((await createPin(root, 'folder')).kind).toBe('folder')
    expect(await fs.readFile(file, 'utf8')).toBe('# Keep my content\n')
    await expect(createPin(file, 'folder')).rejects.toThrow('请选择')
    await expect(createPin(root, 'file')).rejects.toThrow('请选择')
  })
  it('deduplicates canonical targets and enforces a finite pin list', async () => {
    const first = await createPin(file, 'file')
    const second = await createPin(path.join(root, '.', path.basename(file)), 'file')
    expect(addPin([first], second)).toEqual([first])
    const full = Array.from({ length: 50 }, (_, i) => ({
      ...first,
      id: 'pin-' + i,
      path: path.join(root, i + '.md'),
    }))
    expect(() => addPin(full, first)).toThrow('50')
  })
  it('loads old settings safely and filters invalid or duplicate records', async () => {
    const pin = await createPin(file, 'file')
    expect(normalizePins(undefined)).toEqual([])
    expect(
      normalizePins([
        null,
        { ...pin, path: 'relative.md' },
        { ...pin, id: '' },
        { ...pin, path: file + '.png' },
        pin,
        { ...pin, id: 'duplicate' },
      ]),
    ).toEqual([pin])
  })
  it('reports missing or changed targets without deleting the shortcut or any file', async () => {
    const pin = await createPin(file, 'file')
    const moved = file + '.moved'
    await fs.rename(file, moved)
    await expect(resolvePin(pin)).rejects.toThrow('重新固定')
    expect(pin.path).toBe(file)
    await fs.mkdir(file)
    await expect(resolvePin(pin)).rejects.toThrow('请选择')
    expect(await fs.readFile(moved, 'utf8')).toBe('# Keep my content\n')
  })
})
