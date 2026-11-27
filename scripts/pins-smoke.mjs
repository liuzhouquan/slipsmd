import { _electron as electron } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const root = path.resolve('.')
const packaged = process.argv.includes('--packaged')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-pins-desktop-'))
const work = path.join(temp, 'Current notes')
const other = path.join(temp, 'Other notes')
const file = path.join(work, 'Home.md')
const loose = path.join(temp, 'Loose note.md')
await fs.mkdir(work)
await fs.mkdir(other)
await fs.mkdir(path.join(temp, 'assets'))
await fs.writeFile(file, '# Current note\n\nReady to write.\n')
const parallel = [path.join(work, 'Parallel A.md'), path.join(work, 'Parallel B.md')]
for (const target of parallel) await fs.writeFile(target, '# Concurrent pin\n')
await fs.writeFile(path.join(other, 'Shelf.md'), '# Other workspace\n')
await fs.writeFile(loose, '# Loose note\n\n[Sibling](Sibling.md)\n\n![Local](assets/pixel.png)\n')
await fs.writeFile(
  path.join(temp, 'assets/pixel.png'),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
    'base64',
  ),
)
const env = {
  ...process.env,
  SLIPSMD_USER_DATA: path.join(temp, 'profile'),
  SLIPSMD_WORKSPACE: work,
}
delete env.ELECTRON_RUN_AS_NODE
const launch = () =>
  electron.launch({
    executablePath: path.join(
      root,
      packaged ? 'dist' : 'node_modules/electron/dist',
      packaged
        ? process.platform === 'win32'
          ? 'win-unpacked/slipsmd.exe'
          : 'linux-unpacked/slipsmd'
        : process.platform === 'win32'
          ? 'electron.exe'
          : 'electron',
    ),
    args: ['--no-sandbox', ...(packaged ? [] : [root]), file],
    env,
    timeout: 60000,
  })
const output = path.join(root, '.test-results')
await fs.mkdir(output, { recursive: true })
let application
const errors = []
const track = (page) => page.on('pageerror', (e) => errors.push(e.message))
try {
  application = await launch()
  let page = await application.firstWindow()
  track(page)
  await page.waitForSelector('.primary-document .cm-editor')
  assert.equal(await page.locator('.pin-open').count(), 0)
  await page.getByRole('button', { name: '固定当前笔记', exact: true }).click()
  await page.getByRole('button', { name: '固定当前工作区', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.pin-open').length === 2)
  await page.evaluate((f) => window.slipsmd.pinLocation('file', f), file)
  assert.equal(await page.locator('.pin-open').count(), 2)
  await page.getByRole('button', { name: '打开固定文件夹：Current notes', exact: true }).click()
  assert.equal(await page.locator('.primary-document .document-name').innerText(), 'Home.md')
  await assert.rejects(
    page.evaluate((f) => window.slipsmd.pinLocation('file', f), loose),
    /授权/,
  )
  console.log('PASS: current file/folder pinning, deduplication and explicit path authorization')

  const next = application.waitForEvent('window')
  await page
    .getByRole('button', { name: '打开固定文件夹：Current notes', exact: true })
    .click({ modifiers: ['Control'] })
  const second = await next
  track(second)
  await second.waitForSelector('.file-tree')
  assert.equal(await second.locator('.pin-open').count(), 2)
  assert.equal(await second.locator('.primary-document').count(), 0)
  assert.equal(await page.locator('.primary-document .document-name').innerText(), 'Home.md')

  await Promise.all([
    page.evaluate((f) => window.slipsmd.pinLocation('file', f), parallel[0]),
    second.evaluate((f) => window.slipsmd.pinLocation('file', f), parallel[1]),
  ])
  await page.waitForFunction(() => document.querySelectorAll('.pin-open').length === 4)
  await second.waitForFunction(() => document.querySelectorAll('.pin-open').length === 4)
  const added = (await page.evaluate(() => window.slipsmd.bootstrap())).settings.pins.filter((p) =>
    p.name.startsWith('Parallel '),
  )
  assert.equal(added.length, 2)
  await Promise.all(added.map((pin) => page.evaluate((id) => window.slipsmd.removePin(id), pin.id)))
  await page.waitForFunction(() => document.querySelectorAll('.pin-open').length === 2)
  await second.waitForFunction(() => document.querySelectorAll('.pin-open').length === 2)
  console.log('PASS: simultaneous pin additions from separate windows preserve both records')

  // Only the native picker is stubbed. The real main-process handlers still validate all targets.
  await application.evaluate(
    ({ dialog }, selections) => {
      const original = dialog.showOpenDialog
      dialog.showOpenDialog = async (...args) =>
        selections.length ? { canceled: false, filePaths: [selections.shift()] } : original(...args)
    },
    [loose, other],
  )
  for (const label of ['固定文件…', '固定文件夹…']) {
    await page.getByLabel('添加快捷方式', { exact: true }).click()
    await page.getByRole('button', { name: label, exact: true }).click()
  }
  await page.waitForFunction(() => document.querySelectorAll('.pin-open').length === 4)
  await second.waitForFunction(() => document.querySelectorAll('.pin-open').length === 4)
  console.log('PASS: native-picker file/folder selection and live synchronization across windows')

  await page.getByRole('button', { name: '打开固定文件：Loose note.md', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('.primary-document .document-name')?.textContent === 'Loose note.md',
  )
  assert.equal(
    (await page.locator('.workspace-heading > span').allTextContents()).at(-1),
    'Current notes',
  )
  const links = await page.evaluate((f) => window.slipsmd.links(f), loose)
  assert.ok((await page.locator('.breadcrumb').innerText()).includes('工作区外文件'))
  assert.deepEqual(links, { outgoing: [], backlinks: [] })
  await page.waitForFunction(
    () => document.querySelector('.md-image-preview img')?.naturalWidth > 0,
  )
  await page.locator('.primary-document .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\nSaved before switching workspace.')
  await page.getByRole('button', { name: '打开固定文件夹：Other notes', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('.file-tree')?.textContent?.includes('Shelf'),
  )
  assert.ok((await fs.readFile(loose, 'utf8')).includes('Saved before switching workspace.'))
  assert.equal(await page.locator('.primary-document').count(), 0)
  assert.ok((await second.locator('.file-tree').innerText()).includes('Home'))
  console.log(
    'PASS: outside file editing/local images, workspace-scoped links, save-before-switch and independent roots',
  )

  await page.getByRole('button', { name: '打开固定文件夹：Current notes', exact: true }).click()
  await page.getByRole('button', { name: '打开固定文件：Home.md', exact: true }).click()
  await page.waitForSelector('.primary-document .cm-editor')
  await fs.rename(loose, loose + '.moved')
  await page.getByRole('button', { name: '打开固定文件：Loose note.md', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('.notice.error')?.textContent?.includes('重新固定'),
  )
  assert.equal(await page.locator('.primary-document .document-name').innerText(), 'Home.md')
  assert.equal(await page.locator('.pin-open').count(), 4)
  await page.getByRole('button', { name: '取消固定：Loose note.md', exact: true }).click()
  await second.waitForFunction(() => document.querySelectorAll('.pin-open').length === 3)
  assert.ok(
    (await fs.readFile(loose + '.moved', 'utf8')).includes('Saved before switching workspace.'),
  )
  await page.getByRole('button', { name: '关闭提示', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'pins-light.png') })
  await page.evaluate(() => window.slipsmd.updateSettings({ theme: 'dark' }))
  await second.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.screenshot({ path: path.join(output, 'pins-dark.png') })
  console.log('PASS: missing-target recovery, removal without deletion, light/dark shortcut UI')

  await application.close()
  application = await launch()
  page = await application.firstWindow()
  track(page)
  await page.waitForSelector('.primary-document .cm-editor')
  assert.equal(await page.locator('.pin-open').count(), 3)
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  await page.getByRole('button', { name: '打开固定文件夹：Other notes', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('.file-tree')?.textContent?.includes('Shelf'),
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS: shortcuts persist across a full application restart and still open their targets',
  )
} catch (error) {
  const page = application?.windows()[0]
  if (page) {
    await page.screenshot({ path: path.join(output, 'pins-failure.png') }).catch(() => {})
    await fs.writeFile(path.join(output, 'pins-failure.html'), await page.content())
  }
  throw error
} finally {
  await application?.close()
  if (!process.env.SLIPSMD_KEEP_TEST_DATA) await fs.rm(temp, { recursive: true, force: true })
}
