import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { importLegacyProfiles } from '../src/main/migration'

let root: string, legacy: string, current: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'slips-migration-'))
  legacy = path.join(root, 'previous-profile')
  current = path.join(root, 'slips.md')
  await fs.mkdir(path.join(legacy, 'drafts'), { recursive: true })
  await fs.mkdir(path.join(legacy, 'pending-images'))
  await fs.writeFile(path.join(legacy, 'settings.json'), '{"theme":"dark"}')
  await fs.writeFile(path.join(legacy, 'drafts', 'note.json'), 'unsaved text')
  await fs.writeFile(path.join(legacy, 'pending-images', 'image.png'), new Uint8Array([1, 2, 3]))
  await fs.writeFile(path.join(legacy, 'Cookies'), 'unrelated browser data')
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('profile migration', () => {
  it('copies settings, recovery drafts and pending images and leaves the old profile intact', async () => {
    await importLegacyProfiles(current, [path.join(root, 'missing'), legacy])
    for (const name of ['settings.json', 'drafts/note.json', 'pending-images/image.png']) {
      expect(await fs.readFile(path.join(current, name))).toEqual(
        await fs.readFile(path.join(legacy, name)),
      )
    }
    await expect(fs.access(path.join(current, 'Cookies'))).rejects.toThrow()
  })

  it('preserves existing settings and drafts while importing other missing drafts', async () => {
    await fs.mkdir(path.join(current, 'drafts'), { recursive: true })
    await fs.writeFile(path.join(current, 'settings.json'), '{"theme":"light"}')
    await fs.writeFile(path.join(current, 'drafts', 'note.json'), 'newer draft')
    await fs.writeFile(path.join(legacy, 'drafts', 'other.json'), 'another recovery')
    await importLegacyProfiles(current, [legacy])
    expect(await fs.readFile(path.join(current, 'settings.json'), 'utf8')).toBe('{"theme":"light"}')
    expect(await fs.readFile(path.join(current, 'drafts', 'note.json'), 'utf8')).toBe('newer draft')
    expect(await fs.readFile(path.join(current, 'drafts', 'other.json'), 'utf8')).toBe(
      'another recovery',
    )
  })

  it('runs once so removed drafts are not resurrected from the old profile', async () => {
    await importLegacyProfiles(current, [legacy])
    await fs.rm(path.join(current, 'drafts', 'note.json'))
    await importLegacyProfiles(current, [legacy])
    await expect(fs.access(path.join(current, 'drafts', 'note.json'))).rejects.toThrow()
  })
})
