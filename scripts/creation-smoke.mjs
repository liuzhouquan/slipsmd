import { _electron as electron } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const root = path.resolve('.')
const packaged = process.argv.includes('--packaged')
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-create-desktop-')))
const work = path.join(temp, 'notes')
await fs.mkdir(path.join(work, 'Existing'), { recursive: true })
const home = path.join(work, 'Home.md')
const original = '\uFEFF# Home\r\n\r\nWrite here.\r\n'
await fs.writeFile(home, original)
await fs.writeFile(path.join(work, 'Existing', 'Keep.md'), '# Keep these bytes.\n')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const launch = (standalone = false) =>
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
    args: ['--no-sandbox', ...(packaged ? [] : [root])],
    env: {
      ...env,
      SLIPSMD_USER_DATA: path.join(temp, standalone ? 'standalone-profile' : 'profile'),
      SLIPSMD_WORKSPACE: standalone ? '' : work,
      SLIPSMD_OPEN_FILE: standalone ? '' : home,
    },
    timeout: 60000,
  })
const output = path.join(root, '.test-results')
await fs.mkdir(output, { recursive: true })
let application
const errors = []
const track = (page) => page.on('pageerror', (e) => errors.push(e.message))
const dialog = (page, kind) =>
  page.getByRole('dialog', { name: kind === 'file' ? '新建笔记' : '新建文件夹', exact: true })
const input = (page) => page.getByLabel('路径（相对工作区）', { exact: true })
async function openCreate(page, kind) {
  await page
    .getByRole('button', { name: kind === 'file' ? '新建笔记' : '新建文件夹', exact: true })
    .click()
  await dialog(page, kind).waitFor()
}
async function submit(page, kind, value) {
  await input(page).fill(value)
  await dialog(page, kind).getByRole('button', { name: '创建', exact: true }).click()
}
async function folderOpen(page, name) {
  return page
    .locator('.file-tree details[data-directory]')
    .evaluateAll(
      (nodes, name) =>
        nodes.find((node) => node.dataset.directory.replace(/\\/g, '/').endsWith('/' + name))?.open,
      name,
    )
}
async function expectName(page, name) {
  await page.waitForFunction(
    (name) => document.querySelector('.primary-document .document-name')?.textContent === name,
    name,
  )
}
try {
  application = await launch()
  let page = await application.firstWindow()
  track(page)
  await page.waitForSelector('.primary-document .cm-editor')
  await page.locator('.file-tree summary').filter({ hasText: 'Existing' }).click()
  const next = application.waitForEvent('window')
  await page.getByRole('button', { name: '新建独立窗口', exact: true }).click()
  const second = await next
  track(second)
  await second.waitForSelector('.file-tree')
  await page.bringToFront()
  await page.locator('.primary-document .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Remember while creating folders.', { delay: 5 })
  await openCreate(page, 'folder')
  assert.equal(await input(page).inputValue(), 'Existing/')
  await input(page).fill('写作')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'create-destination')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '创建')
  await page.keyboard.press('Tab')
  await page.screenshot({ path: path.join(output, 'creation-folder-light.png') })
  await dialog(page, 'folder').getByRole('button', { name: '创建', exact: true }).click()
  await dialog(page, 'folder').waitFor({ state: 'hidden' })
  await expectName(page, 'Home.md')
  assert.ok(
    (await page.locator('.primary-document .cm-content').innerText()).includes(
      'Remember while creating folders.',
    ),
  )
  assert.equal(await folderOpen(page, '写作'), true)
  assert.equal(await folderOpen(page, 'Existing'), true)
  await second.waitForFunction(() =>
    document.querySelector('.file-tree')?.textContent?.includes('写作'),
  )
  assert.ok((await fs.stat(path.join(work, '写作'))).isDirectory())
  console.log(
    'PASS: keyboard-accessible folder creation retains current edits, expands new folder, preserves other branches and synchronizes windows',
  )

  await openCreate(page, 'folder')
  assert.equal(await input(page).inputValue(), '写作/')
  await submit(page, 'folder', '写作/草稿')
  await dialog(page, 'folder').waitFor({ state: 'hidden' })
  await openCreate(page, 'file')
  assert.equal(await input(page).inputValue(), '写作/草稿/')
  await input(page).fill('写作/草稿/第一篇')
  await page.screenshot({ path: path.join(output, 'creation-note-light.png') })
  await dialog(page, 'file').getByRole('button', { name: '创建', exact: true }).click()
  await dialog(page, 'file').waitFor({ state: 'hidden' })
  await expectName(page, '第一篇.md')
  await page.waitForFunction(() => document.activeElement?.closest('.primary-document .cm-content'))
  assert.equal(await page.title(), '第一篇 — SlipsMD')
  assert.equal(await folderOpen(page, '写作'), true)
  assert.equal(await folderOpen(page, '草稿'), true)
  assert.ok(await page.locator('.file-row.selected').isVisible())
  assert.equal(
    await fs.readFile(path.join(work, '写作', '草稿', '第一篇.md'), 'utf8'),
    '# 第一篇\n\n',
  )
  assert.equal(await fs.readFile(home, 'utf8'), original + '\r\nRemember while creating folders.')
  console.log(
    'PASS: nested-note default path, save-before-create, automatic expansion, selection, title and editor focus',
  )

  await openCreate(page, 'file')
  for (const [value, message] of [
    ['Existing/Keep', '已存在'],
    ['Missing/New', '父文件夹不存在'],
    ['../Escape', '路径包含'],
  ]) {
    await submit(page, 'file', value)
    await page.waitForFunction(
      (message) => document.querySelector('#create-error')?.textContent?.includes(message),
      message,
    )
    assert.equal(await input(page).inputValue(), value)
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'create-destination')
  }
  assert.equal(
    await fs.readFile(path.join(work, 'Existing', 'Keep.md'), 'utf8'),
    '# Keep these bytes.\n',
  )
  await page.keyboard.press('Escape')
  await dialog(page, 'file').waitFor({ state: 'hidden' })
  await openCreate(page, 'folder')
  for (const [value, message] of [
    ['Existing', '已存在'],
    ['node_modules', '忽略'],
    ['Chat.md', '收集箱'],
  ]) {
    await submit(page, 'folder', value)
    await page.waitForFunction(
      (message) => document.querySelector('#create-error')?.textContent?.includes(message),
      message,
    )
  }
  await page.evaluate(() => window.slipsmd.updateSettings({ theme: 'dark' }))
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(760, 540),
  )
  await page.waitForFunction(
    () =>
      innerWidth <= 760 && innerWidth >= 700 && document.documentElement.dataset.theme === 'dark',
  )
  await page.screenshot({ path: path.join(output, 'creation-dark-narrow.png') })
  assert.ok(
    await dialog(page, 'folder').evaluate((el) => {
      const r = el.getBoundingClientRect()
      return (
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= innerWidth &&
        r.bottom <= innerHeight &&
        el.scrollWidth <= el.clientWidth
      )
    }),
  )
  await dialog(page, 'folder').getByRole('button', { name: '取消', exact: true }).click()
  const longName = 'Long folder '.repeat(5) + '名字'.repeat(12)
  await page.evaluate((name) => window.slipsmd.createFolder(name), longName)
  await page.waitForFunction(
    (name) => document.querySelector('.file-tree')?.textContent?.includes(name),
    longName,
  )
  assert.ok(await page.locator('.tree-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth))
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1240, 840),
  )
  await page.evaluate(() => window.slipsmd.updateSettings({ theme: 'light' }))
  console.log(
    'PASS: recoverable errors, Escape, collision/traversal/missing-parent/ignored-folder guards, and dark minimum-window layout',
  )

  await page.locator('.file-tree .file-row').filter({ hasText: 'Home' }).click()
  await expectName(page, 'Home.md')
  await page.keyboard.press('F2')
  const move = page.getByRole('dialog', { name: '重命名或移动笔记', exact: true })
  await move.waitFor()
  await page.getByLabel('新路径（相对工作区）', { exact: true }).fill('写作/草稿/Home moved.md')
  await move.getByRole('button', { name: '保存并移动', exact: true }).click()
  await move.waitFor({ state: 'hidden' })
  await expectName(page, 'Home moved.md')
  assert.equal(
    await fs.readFile(path.join(work, '写作', '草稿', 'Home moved.md'), 'utf8'),
    original + '\r\nRemember while creating folders.',
  )
  await assert.rejects(fs.stat(home), { code: 'ENOENT' })
  await page.screenshot({ path: path.join(output, 'creation-result.png') })
  console.log(
    'PASS: create folders, create a note inside them, and move an existing note there without changing bytes',
  )

  await application.close()
  application = await launch(true)
  page = await application.firstWindow()
  track(page)
  await page.waitForSelector('.welcome')
  assert.ok(await page.getByRole('button', { name: '新建文件夹', exact: true }).isDisabled())
  await assert.rejects(
    page.evaluate(() => window.slipsmd.createFolder('No workspace')),
    /先打开文件夹/,
  )
  await assert.rejects(
    page.evaluate(() => window.slipsmd.createFile('No workspace')),
    /先打开文件夹/,
  )
  assert.deepEqual(errors, [])
  console.log('PASS: workspace authorization enforced in main process; no renderer exceptions')
} catch (error) {
  const page = application?.windows()[0]
  if (page) {
    await page.screenshot({ path: path.join(output, 'creation-failure.png') }).catch(() => {})
    await fs.writeFile(path.join(output, 'creation-failure.html'), await page.content())
  }
  throw error
} finally {
  await application?.close()
  if (!process.env.SLIPSMD_KEEP_TEST_DATA) await fs.rm(temp, { recursive: true, force: true })
}
