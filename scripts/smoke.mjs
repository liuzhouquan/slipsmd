import { _electron as electron } from 'playwright-core'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import http from 'node:http'
const root = path.resolve('.')
const packaged = process.argv.includes('--packaged')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'inkisle-smoke-'))
const work = path.join(temp, 'notes')
await fs.cp(path.join(root, 'examples/workspace'), work, { recursive: true })
const file = path.join(work, 'Welcome.md')
const original =
  '\uFEFF' +
  ('---\ntitle: Inkisle\n---\n\n' + (await fs.readFile(file, 'utf8'))).replace(/\n/g, '\r\n')
await fs.writeFile(file, original)
const errors = []
const output = path.join(root, '.test-results')
await fs.mkdir(output, { recursive: true })
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='
let uploads = 0
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    const bytes = await fs.readFile(request.list[0])
    assert.ok(bytes.length > 0)
    uploads++
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: true, result: ['https://example.com/uploaded-test.png'] }))
  } else res.end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
let application
const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE
async function pasteImage(page) {
  await page.locator('.primary-document .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.evaluate((data) => {
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'paste.png', {
        type: 'image/png',
      }),
    )
    document
      .querySelector('.primary-document .cm-content')
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      )
  }, png)
}
try {
  application = await electron.launch({
    executablePath: packaged
      ? path.join(
          root,
          'dist',
          process.platform === 'win32' ? 'win-unpacked/Inkisle.exe' : 'linux-unpacked/inkisle',
        )
      : path.join(
          root,
          'node_modules/electron/dist',
          process.platform === 'win32' ? 'electron.exe' : 'electron',
        ),
    args: ['--no-sandbox', ...(packaged ? [] : [root])],
    env: {
      ...launchEnv,
      INKISLE_USER_DATA: path.join(temp, 'profile'),
      INKISLE_WORKSPACE: work,
      INKISLE_OPEN_FILE: file,
    },
    timeout: 60000,
  })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.primary-document .cm-editor')
  await page.waitForSelector('.md-table-preview table')
  await page.waitForSelector('.katex')
  assert.equal(await fs.readFile(file, 'utf8'), original, 'opening a file must not reformat it')
  await page.locator('.primary-document .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n\n桌面编辑验证。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === '已保存')
  let saved = await fs.readFile(file, 'utf8')
  assert.ok(saved.startsWith('\uFEFF'))
  assert.ok(saved.includes('\r\n'))
  assert.ok(saved.includes('桌面编辑验证。'))
  console.log('PASS: real CodeMirror editing, untouched bytes, BOM/CRLF preservation, save IPC')
  await page.locator('.primary-document .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[Read', { delay: 40 })
  await page.waitForSelector('.cm-tooltip-autocomplete')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === '已保存')
  assert.ok((await fs.readFile(file, 'utf8')).includes('[Reading](Reading.md)'))
  await page.locator('.primary-document .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('format-test')
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.press('Control+b')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === '已保存')
  assert.ok((await fs.readFile(file, 'utf8')).includes('**format-test**'))
  console.log('PASS: note-link completion and Markdown formatting shortcuts')
  await page.locator('.primary-document').evaluate((el) => (el.scrollTop = 0))
  await page.locator('.primary-document [data-href="Ideas.md"]').click()
  await page.waitForSelector('.related-pane .cm-editor')
  assert.match(await page.locator('.related-pane .document-name').innerText(), /Ideas/)
  await page
    .getByRole('button', { name: '上一份关联笔记' })
    .isDisabled()
    .then((x) => assert.ok(x))
  await page.locator('.related-pane input[type="checkbox"]').first().check()
  await page.waitForFunction(
    () => document.querySelector('.related-pane .save-status')?.textContent === '已保存',
  )
  assert.ok((await fs.readFile(path.join(work, 'Ideas.md'), 'utf8')).includes('- [x] 记录一个想法'))
  console.log('PASS: internal note opens in right-hand editor and task checkbox saves Markdown')
  const nextWindow = application.waitForEvent('window')
  await page
    .locator('.file-row')
    .filter({ hasText: 'Reading' })
    .click({ modifiers: ['Control'] })
  const second = await nextWindow
  await second.waitForSelector('.primary-document .cm-editor')
  assert.match(await second.locator('.primary-document .document-name').innerText(), /Reading/)
  assert.equal(application.windows().length, 2)
  console.log('PASS: Ctrl+click creates another real Electron window')
  await page.getByRole('button', { name: '收集箱', exact: false }).click()
  await page.getByRole('textbox', { name: '记录想法' }).fill('先记录，不需要先取标题。')
  await page.getByRole('button', { name: '记下来' }).click()
  await page.locator('.captures article').waitFor()
  assert.ok(
    (await fs.readFile(path.join(work, 'Chat.md'), 'utf8')).includes('先记录，不需要先取标题。'),
  )
  await page.getByRole('button', { name: '整理到当前笔记' }).click()
  await page.waitForFunction(() => !document.querySelector('.captures article'))
  assert.ok((await fs.readFile(file, 'utf8')).includes('先记录，不需要先取标题。'))
  console.log('PASS: capture persists and archives to current Markdown note')
  await page.getByRole('button', { name: '关闭收集箱' }).click()
  await pasteImage(page)
  await page.waitForFunction(() =>
    document.querySelector('.primary-document .cm-content')?.textContent?.includes('assets/'),
  )
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === '已保存')
  assert.equal((await fs.readdir(path.join(work, 'assets'))).length, 1)
  console.log('PASS: clipboard image saves locally and inserts Markdown link')
  await page.evaluate(
    (url) => window.inkisle.updateSettings({ imageMode: 'picgo', picgoUrl: url }),
    'http://127.0.0.1:' + port + '/upload',
  )
  await pasteImage(page)
  await page.waitForFunction(() =>
    document
      .querySelector('.primary-document .cm-content')
      ?.textContent?.includes('https://example.com/uploaded-test.png'),
  )
  assert.equal(uploads, 1)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === '已保存')
  console.log('PASS: PicGo HTTP upload receives actual image path and returns URL')
  await page.evaluate(() => window.inkisle.updateSettings({ theme: 'dark' }))
  await second.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.screenshot({ path: path.join(output, 'desktop-dark.png') })
  await page.evaluate(() => window.inkisle.updateSettings({ theme: 'light' }))
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.screenshot({ path: path.join(output, 'desktop-light.png') })
  console.log('PASS: theme is broadcast across independent windows')
  await page.locator('.primary-document .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\nunsaved conflict')
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === '未保存')
  await fs.writeFile(file, 'external writer\n')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('.error-banner').waitFor()
  assert.equal(await fs.readFile(file, 'utf8'), 'external writer\n')
  console.log('PASS: external edit is not overwritten and conflict is visible')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '载入磁盘版本' }).click()
  await page.waitForFunction(() =>
    document
      .querySelector('.primary-document .cm-content')
      ?.textContent?.includes('external writer'),
  )
  assert.deepEqual(errors, [], 'renderer must not throw errors')
  console.log('PASS: no renderer exceptions; conflict reload succeeds')
  console.log('Desktop smoke checks complete. Screenshots: ' + output)
} catch (error) {
  if (application) {
    const page = application.windows()[0]
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
      await fs.writeFile(path.join(output, 'failure.html'), await page.content())
      console.error('Renderer exceptions:', errors)
    }
  }
  throw error
} finally {
  await application?.close()
  await new Promise((resolve) => server.close(resolve))
  if (!process.env.INKISLE_KEEP_TEST_DATA) await fs.rm(temp, { recursive: true, force: true })
}
