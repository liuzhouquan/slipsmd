import { _electron as electron } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const root = path.resolve('.')
const packaged = process.argv.includes('--packaged')
const temp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-folder-relocation-')),
)
const work = path.join(temp, 'Workspace')
const drafts = path.join(work, '写作', '草稿')
const archive = path.join(work, '归档')
const existing = path.join(work, '已有')
await fs.mkdir(drafts, { recursive: true })
await fs.mkdir(archive, { recursive: true })
await fs.mkdir(existing, { recursive: true })

const home = path.join(work, 'Home.md')
const noteA = path.join(drafts, 'NoteA.md')
const originalBytes = Buffer.from('\uFEFF# Note A\r\n\r\n[Home](../../Home.md)\r\n')
await fs.writeFile(home, '# Home\n\n[NoteA](写作/草稿/NoteA.md)\n')
await fs.writeFile(noteA, originalBytes)

const env = {
  ...process.env,
  SLIPSMD_USER_DATA: path.join(temp, 'profile'),
  SLIPSMD_WORKSPACE: work,
  SLIPSMD_OPEN_FILE: noteA,
}
delete env.ELECTRON_RUN_AS_NODE

const launchArgs = ['--no-sandbox', ...(packaged ? [] : [root])]
const executablePath = path.join(
  root,
  packaged ? 'dist' : 'node_modules/electron/dist',
  packaged
    ? process.platform === 'win32'
      ? 'win-unpacked/slipsmd.exe'
      : 'linux-unpacked/slipsmd'
    : process.platform === 'win32'
      ? 'electron.exe'
      : 'electron',
)

let application
const errors = []

async function launchApp(openFile = noteA) {
  const app = await electron.launch({
    executablePath,
    args: launchArgs,
    env: { ...env, SLIPSMD_OPEN_FILE: openFile },
    timeout: 60000,
  })
  return app
}

try {
  application = await launchApp()
  const page = await application.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.primary-document .cm-editor')

  // Pin the drafts folder as a shortcut before moving
  await application.evaluate(({ dialog }, folderPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folderPath] })
  }, drafts)
  await page.evaluate(() => window.slipsmd.pinLocation('folder'))
  await page.waitForSelector('.pin-list .pin-open')

  // Open second window with the same note (read-only mirror)
  const [second] = await Promise.all([
    application.waitForEvent('window', { timeout: 30000 }),
    page.getByRole('button', { name: '新建独立窗口', exact: true }).click(),
  ])
  second.on('pageerror', (error) => errors.push(error.message))
  await second.waitForSelector('.file-tree')
  await second.evaluate((p) => window.slipsmd.readDocument(p), noteA)

  // Ensure 写作 is expanded in file tree and click folder rename/move button on 草稿
  await page.bringToFront()
  const parentDir = path.join(work, '写作')
  const isOpen = await page.evaluate(
    (dir) => document.querySelector(`.file-tree details[data-directory="${dir}"]`)?.open === true,
    parentDir,
  )
  if (!isOpen) await page.locator(`.file-tree summary[data-path="${parentDir}"]`).click()
  const draftsSummary = page.locator(`.file-tree summary[data-path="${drafts}"]`)
  await draftsSummary.hover()
  await page.getByRole('button', { name: '重命名或移动文件夹 草稿', exact: true }).click()

  const dialog = page.locator('dialog.move-note-dialog[open]')
  await dialog.waitFor({ state: 'visible' })
  const input = dialog.locator('#move-destination')

  // Attempt moving onto an existing folder: should fail, keep dialog open and preserve input
  await input.fill('已有')
  await dialog.getByRole('button', { name: '保存并移动', exact: true }).click()
  await dialog.locator('#move-error').waitFor({ state: 'visible' })
  const errText = await dialog.locator('#move-error').textContent()
  assert.ok(errText?.includes('目标已存在'), `Expected overwrite protection error, got: ${errText}`)
  assert.equal(await input.inputValue(), '已有')

  // Move to 归档/已整理
  const targetDir = path.join(archive, '已整理')
  const targetNote = path.join(targetDir, 'NoteA.md')
  await input.fill('归档/已整理')
  await dialog.getByRole('button', { name: '保存并移动', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  await expectPathMissing(drafts)
  assert.deepEqual(await fs.readFile(targetNote), originalBytes)

  // Verify title, editor, pin, and second window state synced
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.primary-document .document-name')?.textContent === expected,
    'NoteA.md',
  )
  const secondMirror = await second.evaluate((p) => window.slipsmd.readDocument(p), targetNote)
  assert.equal(secondMirror.path, targetNote)
  assert.equal(secondMirror.readOnly, true)

  const pinText = await page.locator('.pin-list .pin-open').first().textContent()
  assert.ok(pinText?.includes('已整理'), `Expected updated pin label, got: ${pinText}`)

  await application.close()
  application = undefined

  // Restart and verify persisted pin resolves to the moved folder
  application = await launchApp(home)
  const relaunched = await application.firstWindow()
  relaunched.on('pageerror', (error) => errors.push(error.message))
  await relaunched.waitForSelector('.pin-list .pin-open')
  const persistedPin = await relaunched.locator('.pin-list .pin-open').first().textContent()
  assert.ok(persistedPin?.includes('已整理'), `Expected persisted pin label, got: ${persistedPin}`)
  await relaunched.locator('.pin-list .pin-open').first().click()
  await relaunched.waitForFunction(
    (name) => document.querySelector('.sidebar > .workspace-heading > span')?.textContent === name,
    '已整理',
  )

  assert.deepEqual(errors, [], `Uncaught renderer errors: ${errors.join('; ')}`)
  console.log(
    'PASS: folder rename/move protects existing targets and syncs views, windows, and pins',
  )
} finally {
  if (application) {
    await Promise.race([
      application.close(),
      new Promise((resolve) => {
        const t = setTimeout(resolve, 5000)
        t.unref()
      }),
    ]).catch(() => {})
  }
  await fs.rm(temp, { recursive: true, force: true })
}

async function expectPathMissing(p) {
  await assert.rejects(fs.stat(p), { code: 'ENOENT' })
}
