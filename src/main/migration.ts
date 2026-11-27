import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'

/** Import only user data; never move the old profile or overwrite existing data. */
export async function importLegacyProfiles(destination: string, sources: string[]): Promise<void> {
  const marker = path.join(destination, '.legacy-profile-imported')
  try {
    await fs.access(marker)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await fs.mkdir(destination, { recursive: true })
  for (const source of new Set(sources)) {
    for (const name of ['settings.json', 'drafts', 'pending-images']) {
      const original = path.join(source, name)
      const target = path.join(destination, name)
      try {
        const stat = await fs.lstat(original)
        if (stat.isSymbolicLink()) continue
        if (name === 'settings.json' && stat.isFile()) {
          await fs.copyFile(original, target, constants.COPYFILE_EXCL)
        } else if (name !== 'settings.json' && stat.isDirectory()) {
          await fs.cp(original, target, { recursive: true, force: false })
        }
      } catch (error) {
        if (!['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
    }
  }
  await fs.writeFile(marker, '1\n', { flag: 'wx' })
}
