import { _electron as electron } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const root = path.resolve('.')
const packaged = process.argv.includes('--packaged')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-move-desktop-'))
const work = path.join(temp, 'notes')
await fs.mkdir(path.join(work, 'Archive'), { recursive: true })
const file = path.join(work, 'Home.md')
const moved = path.join(work, 'Archive', '改名笔记.md')
const related = path.join(work, 'Related.md')
const movedRelated = path.join(work, 'Archive', '关联笔记.md')
const loose = path.join(temp, 'Loose.md')
const home =
  '# Home\n\n[Related](Related.md) · [Second](Second.md)\n\n' +
  Array.from(
    { length: 60 },
    (_, i) => `Paragraph ${i}: Keep the document and its reading context intact. 中文笔记不丢失。`,
  ).join('\n\n') +
  '\n'
const encoded = '\uFEFF' + home.replace(/\n/g, '\r\n')
const relatedText = '# Related\n\nOriginal linked content.\n'
const futureText = '# Links\n\n[Moved note](Archive/%E6%94%B9%E5%90%8D%E7%AC%94%E8%AE%B0.md)\n'
await Promise.all([
  fs.writeFile(file, encoded),
  fs.writeFile(related, relatedText),
  fs.writeFile(path.join(work, 'Second.md'), '# Second\n'),
  fs.writeFile(path.join(work, 'Existing.md'), 'Do not overwrite this file.\n'),
  fs.writeFile(path.join(work, 'Conflict.md'), '# Conflict\n'),
  fs.writeFile(path.join(work, 'Future.md'), futureText),
  fs.writeFile(loose, '# Standalone\n'),
])
const env = {
  ...process.env,
  SLIPSMD_USER_DATA: path.join(temp, 'profile'),
  SLIPSMD_WORKSPACE: work,
}
delete env.ELECTRON_RUN_AS_NODE
const launch = (initial = file) =>
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
    args: ['--no-sandbox', ...(packaged ? [] : [root]), initial],
    env,
    timeout: 60000,
  })
const output = path.join(root, '.test-results')
await fs.mkdir(output, { recursive: true })
let application
const errors = []
const primary = '.primary-document'
const right = '.related-pane'
const dialog = (page) => page.getByRole('dialog', { name: '重命名或移动笔记', exact: true })
const track = (page) => page.on('pageerror', (e) => errors.push(e.message))
async function openMain(page, name) {
  await page.locator('.file-tree .file-row').filter({ hasText: name }).click()
  await expectDocument(page, primary, name + '.md')
}
async function expectDocument(page, pane, name) {
  await page.waitForFunction(
    ({ pane, name }) => document.querySelector(pane + ' .document-name')?.textContent === name,
    { pane, name },
  )
}
async function openMove(page, pane = primary) {
  await page.locator(pane).getByRole('button', { name: '重命名或移动笔记', exact: true }).click()
  await dialog(page).waitFor()
}
async function submitMove(page, destination) {
  await page.getByLabel(/新路径|新文件名/).fill(destination)
  await dialog(page).getByRole('button', { name: '保存并移动', exact: true }).click()
}
async function editorSelection(page, pane) {
  return page.locator(pane).evaluate((el) => {
    const top = el.getBoundingClientRect().top
    const line = [...el.querySelectorAll('.cm-line')].find(
      (line) => line.textContent.trim() && line.getBoundingClientRect().bottom > top,
    )
    return { text: line?.textContent, offset: line?.getBoundingClientRect().top - top }
  })
}
try {
  application = await launch()
  let page = await application.firstWindow()
  track(page)
  await page.waitForSelector(primary + ' .cm-editor')
  await openMove(page)
  assert.equal(await page.getByLabel(/新路径/).inputValue(), 'Home.md')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'move-destination')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '保存并移动')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'move-destination')
  await page.screenshot({ path: path.join(output, 'move-light.png') })
  await page.keyboard.press('Escape')
  await dialog(page).waitFor({ state: 'hidden' })
  assert.ok(
    await page
      .locator(primary)
      .getByRole('button', { name: '重命名或移动笔记', exact: true })
      .evaluate((el) => el === document.activeElement),
  )
  await openMove(page)
  for (const [target, message] of [
    ['../Escape.md', '路径包含'],
    ['Existing.md', '目标已存在'],
    ['Missing/New.md', '目标文件夹不存在'],
  ]) {
    await submitMove(page, target)
    await page.waitForFunction(
      (message) => document.querySelector('#move-error')?.textContent?.includes(message),
      message,
    )
    assert.equal(await page.getByLabel(/新路径/).inputValue(), target)
    assert.equal(await fs.readFile(file, 'utf8'), encoded)
  }
  assert.equal(
    await fs.readFile(path.join(work, 'Existing.md'), 'utf8'),
    'Do not overwrite this file.\n',
  )
  await page.evaluate(() => window.slipsmd.updateSettings({ theme: 'dark' }))
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(760, 540),
  )
  await page.waitForFunction(
    () =>
      innerWidth <= 760 && innerWidth >= 700 && document.documentElement.dataset.theme === 'dark',
  )
  await page.screenshot({ path: path.join(output, 'move-dark-narrow.png') })
  const fits = await dialog(page).evaluate((el) => {
    const r = el.getBoundingClientRect()
    return (
      r.left >= 0 &&
      r.right <= innerWidth &&
      r.top >= 0 &&
      r.bottom <= innerHeight &&
      el.scrollWidth <= el.clientWidth
    )
  })
  assert.ok(fits, 'move dialog must fit the smallest supported window')
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click()
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1240, 840),
  )
  await page.evaluate(() => window.slipsmd.updateSettings({ theme: 'light' }))
  console.log(
    'PASS: accessible modal focus/Escape, retained error input, no overwrite/traversal, light/dark narrow UI',
  )

  await page.getByRole('button', { name: '固定当前笔记', exact: true }).click()
  const pin = (await page.evaluate(() => window.slipsmd.bootstrap())).settings.pins[0]
  const next = application.waitForEvent('window')
  await page
    .locator('.file-tree .file-row')
    .filter({ hasText: 'Second' })
    .click({ modifiers: ['Control'] })
  const second = await next
  track(second)
  await second.waitForSelector(primary + ' .cm-editor')
  await openMain(second, 'Home')
  await second.waitForFunction(
    () =>
      document.querySelector('.primary-document .cm-content')?.getAttribute('contenteditable') ===
      'false',
  )
  await page.bringToFront()
  await page.locator(primary).getByRole('button', { name: '切换源码模式', exact: true }).click()
  await page.locator(primary + ' .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.waitForFunction(() => {
    const el = document.querySelector('.primary-document')
    return el.scrollTop + el.clientHeight > el.scrollHeight - 300
  })
  await page.keyboard.press('Enter')
  await page.keyboard.type('Saved before moving.', { delay: 5 })
  await page.locator(primary).evaluate((el) => {
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    el.scrollTop = 1200
  })
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ),
  )
  const location = await editorSelection(page, primary)
  await page.keyboard.press('F2')
  await dialog(page).waitFor()
  await submitMove(page, 'Archive/改名笔记')
  await dialog(page).waitFor({ state: 'hidden' })
  await expectDocument(page, primary, '改名笔记.md')
  await expectDocument(second, primary, '改名笔记.md')
  await page.waitForFunction(() => document.title === '改名笔记 — SlipsMD')
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll('.primary-document .cm-line')].some(
        (el) => el.textContent === text,
      ),
    location.text,
  )
  const restored = await editorSelection(page, primary)
  assert.equal(restored.text, location.text)
  assert.ok(Math.abs(restored.offset - location.offset) < 5)
  assert.equal(await page.locator(primary + ' .source-mode').count(), 1)
  assert.equal(await fs.readFile(moved, 'utf8'), encoded + '\r\nSaved before moving.')
  await assert.rejects(fs.stat(file), { code: 'ENOENT' })
  await second.waitForFunction(() =>
    document.querySelector('.pin-open')?.getAttribute('title')?.includes('改名笔记'),
  )
  const savedPin = (await page.evaluate(() => window.slipsmd.bootstrap())).settings.pins[0]
  assert.equal(savedPin.id, pin.id)
  assert.equal(
    savedPin.path,
    path.join(await fs.realpath(path.join(work, 'Archive')), '改名笔记.md'),
  )
  assert.ok(
    await second
      .locator(primary)
      .getByRole('button', { name: '重命名或移动笔记', exact: true })
      .isDisabled(),
  )
  await assert.rejects(
    second.evaluate((p) => window.slipsmd.moveDocument(p, 'No.md'), savedPin.path),
    /另一个窗口/,
  )
  const links = await page.evaluate((p) => window.slipsmd.links(p), savedPin.path)
  assert.ok(links.backlinks.some((link) => link.source.endsWith('Future.md')))
  assert.equal(await fs.readFile(path.join(work, 'Future.md'), 'utf8'), futureText)
  console.log(
    'PASS: F2 saves edits, preserves BOM/CRLF and reading mode/position, updates title/mirrors/pins and rebuilds links',
  )

  await page.locator(primary).evaluate((el) => (el.scrollTop = 0))
  await page.locator(primary).getByRole('button', { name: '切换实时预览', exact: true }).click()
  await page.locator(primary + ' [data-href="Related.md"]').click()
  // The moved note still has the original relative link; this must report a missing target.
  await page.waitForFunction(() =>
    document.querySelector('.notice.error')?.textContent?.includes('ENOENT'),
  )
  assert.equal(await page.locator(right).count(), 0)
  await openMain(page, 'Future')
  // Reuse a real source link into the right pane without rewriting the moved note.
  await fs.writeFile(
    path.join(work, 'Future.md'),
    futureText + '\n[Related](Related.md)\n[Second](Second.md)\n',
  )
  await openMain(page, 'Future')
  await page.locator(primary + ' [data-href="Related.md"]').click()
  await expectDocument(page, right, 'Related.md')
  await page.locator(primary + ' [data-href="Second.md"]').click()
  await expectDocument(page, right, 'Second.md')
  await page.getByRole('button', { name: '上一份关联笔记', exact: true }).click()
  await expectDocument(page, right, 'Related.md')
  await openMove(page, right)
  await submitMove(page, 'Archive/关联笔记.md')
  await dialog(page).waitFor({ state: 'hidden' })
  await expectDocument(page, right, '关联笔记.md')
  await page.getByRole('button', { name: '下一份关联笔记', exact: true }).click()
  await expectDocument(page, right, 'Second.md')
  await page.getByRole('button', { name: '上一份关联笔记', exact: true }).click()
  await expectDocument(page, right, '关联笔记.md')
  assert.equal(await fs.readFile(movedRelated, 'utf8'), relatedText)
  await page.screenshot({ path: path.join(output, 'move-result.png') })
  console.log(
    'PASS: right-pane moves update navigation history; old Markdown links remain explicit and unchanged',
  )

  await page.getByRole('button', { name: '关闭关联笔记', exact: true }).click()
  await openMain(page, 'Conflict')
  await page.locator(primary + ' .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\nunsaved draft')
  await fs.writeFile(path.join(work, 'Conflict.md'), 'External writer\n')
  await openMove(page)
  await submitMove(page, 'Conflict moved.md')
  await page.waitForFunction(() =>
    document.querySelector('#move-error')?.textContent?.includes('正文尚未保存'),
  )
  assert.equal(await fs.readFile(path.join(work, 'Conflict.md'), 'utf8'), 'External writer\n')
  await assert.rejects(fs.stat(path.join(work, 'Conflict moved.md')), { code: 'ENOENT' })
  assert.ok((await fs.readdir(path.join(temp, 'profile', 'drafts'))).length > 0)
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '载入磁盘版本', exact: true }).click()
  console.log('PASS: external save conflict blocks moving and retains recovery draft')

  await application.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, loose)
  await page.getByRole('button', { name: '打开 Markdown 文件', exact: true }).click()
  await expectDocument(page, primary, 'Loose.md')
  await openMove(page)
  await submitMove(page, 'Archive/Loose.md')
  await page.waitForFunction(() =>
    document.querySelector('#move-error')?.textContent?.includes('单文件模式'),
  )
  await submitMove(page, 'Loose renamed.md')
  await dialog(page).waitFor({ state: 'hidden' })
  await expectDocument(page, primary, 'Loose renamed.md')
  assert.equal(await fs.readFile(path.join(temp, 'Loose renamed.md'), 'utf8'), '# Standalone\n')
  await page.getByRole('button', { name: '收集箱', exact: false }).click()
  await page.waitForFunction(() =>
    document.querySelector('.file-tree')?.textContent?.includes('Chat'),
  )
  await page
    .evaluate(async () => {
      const boot = await window.slipsmd.bootstrap()
      const chat = boot.workspace.tree.find((f) => f.name === 'Chat.md')
      if (chat) {
        await window.slipsmd.readDocument(chat.path)
        return window.slipsmd.moveDocument(chat.path, 'Other chat.md')
      }
    })
    .then(
      () => assert.fail('Chat.md must not be moved'),
      (error) => assert.match(error.message, /收集箱/),
    )
  console.log('PASS: outside-workspace same-directory rename and protected Chat.md collection')

  await application.close()
  application = await launch(moved)
  page = await application.firstWindow()
  track(page)
  await expectDocument(page, primary, '改名笔记.md')
  const pins = (await page.evaluate(() => window.slipsmd.bootstrap())).settings.pins
  assert.equal(pins[0].id, pin.id)
  assert.equal(pins[0].path, savedPin.path)
  assert.deepEqual(errors, [])
  console.log('PASS: relocated pin persists across a full restart; no renderer exceptions')
} catch (error) {
  const page = application?.windows()[0]
  if (page) {
    await page.screenshot({ path: path.join(output, 'move-failure.png') }).catch(() => {})
    await fs.writeFile(path.join(output, 'move-failure.html'), await page.content())
  }
  throw error
} finally {
  await application?.close()
  if (!process.env.SLIPSMD_KEEP_TEST_DATA) await fs.rm(temp, { recursive: true, force: true })
}
