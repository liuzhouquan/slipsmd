import { _electron as electron } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const root = path.resolve('.')
const packaged = process.argv.includes('--packaged')
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-anchors-')))
const work = path.join(temp, 'notes')
await fs.mkdir(work)
const file = path.join(work, 'Home.md')
const missing = 'missing' + 'x'.repeat(180)
const filler = (prefix, count = 22) =>
  Array.from(
    { length: count },
    (_, i) =>
      `${prefix} paragraph ${i}: Keep context while reading a long Markdown note. 中文阅读上下文。`,
  ).join('\n\n')
const home =
  '# Home\n\n' +
  `[Local](#本地-章节) · [Encoded](#%E6%9C%AC%E5%9C%B0-%E7%AB%A0%E8%8A%82) · [Top](#) · [Missing](#${missing}) · [Draft](#new-draft-heading)\n\n` +
  '[Beta first](Beta.md#first-target) · [Beta duplicate](Beta.md#repeat-1)\n\n' +
  '[Gamma first](Gamma.md#深层-目标) · [Gamma second](Gamma.md#另一个目标)\n\n' +
  filler('Home') +
  '\n\n## 本地 章节\n\nHome local marker.\n\n' +
  filler('Home tail', 8) +
  '\n'
const beta =
  '# Beta\n\n[First](#first-target) · [Second](#second-target) · [Top](#)\n\n' +
  filler('Beta before') +
  '\n\n## First Target\n\nFirst marker.\n\n' +
  filler('Beta between') +
  '\n\n## Second Target\n\nSecond marker.\n\n' +
  filler('Beta later', 8) +
  '\n\n## Repeat\n\nFirst duplicate marker.\n\n' +
  filler('Repeat gap', 5) +
  '\n\n## Repeat\n\nSecond duplicate marker.\n\n' +
  filler('Beta tail', 8) +
  '\n'
const gamma =
  '# Gamma\n\n' +
  filler('Gamma') +
  '\n\n## 深层 目标\n\nDeep marker.\n\n' +
  filler('Gamma between') +
  '\n\n## 另一个目标\n\nOther marker.\n\n' +
  filler('Gamma tail', 8) +
  '\n'
const originals = {
  'Home.md': '\uFEFF' + home.replace(/\n/g, '\r\n'),
  'Beta.md': beta,
  'Gamma.md': gamma,
}
for (const [name, text] of Object.entries(originals))
  await fs.writeFile(path.join(work, name), text)
const env = {
  ...process.env,
  SLIPSMD_USER_DATA: path.join(temp, 'profile'),
  SLIPSMD_WORKSPACE: work,
  SLIPSMD_OPEN_FILE: file,
}
delete env.ELECTRON_RUN_AS_NODE
const output = path.join(root, '.test-results')
await fs.mkdir(output, { recursive: true })
let application
const errors = []
const primary = '.primary-document'
const related = '.related-pane'
const track = (page) => page.on('pageerror', (error) => errors.push(error.message))
async function clickLink(page, pane, href, modifiers = []) {
  await page.locator(pane).evaluate((el) => {
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    el.scrollTop = 0
  })
  await page.waitForFunction(
    ({ pane, href }) =>
      [...document.querySelectorAll(pane + ' [data-href]')].some(
        (el) => el.getAttribute('data-href') === href,
      ),
    { pane, href },
  )
  // Use an attribute selector escaped for CSS, including non-ASCII hrefs.
  const selector = await page.evaluate((href) => '[data-href="' + CSS.escape(href) + '"]', href)
  await page.locator(pane + ' ' + selector).click({ modifiers })
}
async function expectHeading(page, pane, heading) {
  await page.waitForFunction(
    ({ pane, heading }) => {
      const container = document.querySelector(pane)
      const line = container?.querySelector('.cm-activeLine')
      if (!container || !line || !line.textContent.includes(heading)) return false
      const top =
        container.getBoundingClientRect().top +
        (container.querySelector(':scope > .related-toolbar')?.offsetHeight ?? 0)
      const rect = line.getBoundingClientRect()
      return rect.top >= top - 1 && rect.bottom <= container.getBoundingClientRect().bottom
    },
    { pane, heading },
  )
}
try {
  application = await electron.launch({
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
    env,
    timeout: 60000,
  })
  const page = await application.firstWindow()
  track(page)
  await page.waitForSelector(primary + ' .cm-editor')
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="新建独立窗口"]')?.disabled,
  )
  await clickLink(page, primary, '#本地-章节')
  await expectHeading(page, primary, '本地 章节')
  await page.screenshot({ path: path.join(output, 'anchors-main-light.png') })
  await clickLink(page, primary, '#')
  await expectHeading(page, primary, 'Home')
  assert.ok(await page.locator(primary).evaluate((el) => el.scrollTop < 5))
  await clickLink(page, primary, '#%E6%9C%AC%E5%9C%B0-%E7%AB%A0%E8%8A%82')
  await expectHeading(page, primary, '本地 章节')
  console.log('PASS: Chinese document anchors and empty-fragment top navigation')

  await clickLink(page, primary, 'Beta.md#first-target')
  await expectHeading(page, related, 'First Target')
  await clickLink(page, related, '#second-target')
  await expectHeading(page, related, 'Second Target')
  await page.getByRole('button', { name: '上一份关联笔记', exact: true }).click()
  await expectHeading(page, related, 'First Target')
  await page.getByRole('button', { name: '下一份关联笔记', exact: true }).click()
  await expectHeading(page, related, 'Second Target')
  await page.screenshot({ path: path.join(output, 'anchors-related-light.png') })
  await clickLink(page, primary, 'Beta.md#repeat-1')
  await expectHeading(page, related, 'Repeat')
  assert.ok(
    await page
      .locator(related + ' .cm-activeLine')
      .evaluate((el) =>
        el.nextElementSibling?.nextElementSibling?.textContent?.includes(
          'Second duplicate marker.',
        ),
      ),
  )
  await clickLink(page, primary, 'Beta.md#first-target', ['Control'])
  await expectHeading(page, related, 'First Target')
  assert.equal(await page.locator(primary + ' .document-name').innerText(), 'Home.md')
  assert.equal(application.windows().length, 1)
  console.log(
    'PASS: cross-note targets, same-note right history, duplicate titles, sticky-toolbar clearance and existing-pane reuse',
  )

  const [second] = await Promise.all([
    application.waitForEvent('window', { timeout: 30000 }),
    clickLink(page, primary, 'Gamma.md#深层-目标', ['Control']),
  ])
  track(second)
  await expectHeading(second, primary, '深层 目标')
  await second.getByRole('button', { name: '新建文件夹', exact: true }).click()
  const dialog = second.getByRole('dialog', { name: '新建文件夹', exact: true })
  await dialog.waitFor()
  await second.getByLabel('路径（相对工作区）', { exact: true }).fill('Keep this input')
  await clickLink(page, primary, 'Gamma.md#另一个目标', ['Control'])
  assert.equal(
    await second.getByLabel('路径（相对工作区）', { exact: true }).inputValue(),
    'Keep this input',
  )
  assert.ok(await dialog.isVisible())
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expectHeading(second, primary, '另一个目标')
  assert.equal(application.windows().length, 2)
  for (const [name, original] of Object.entries(originals))
    assert.equal(await fs.readFile(path.join(work, name), 'utf8'), original)
  console.log(
    'PASS: new-window fragment bootstrap, queued owner-window target and byte-preserving navigation',
  )

  await clickLink(page, primary, '#' + missing)
  await page.waitForFunction(() =>
    document.querySelector('.notice.error')?.textContent.includes('未找到标题锚点'),
  )
  await page.evaluate(() => window.slipsmd.updateSettings({ theme: 'dark' }))
  const nativeWindow = await application.browserWindow(page)
  await nativeWindow.evaluate((win) => win.setSize(760, 540))
  await page.waitForFunction(
    () => innerWidth <= 760 && document.documentElement.dataset.theme === 'dark',
  )
  await page.screenshot({ path: path.join(output, 'anchors-missing-dark-narrow.png') })
  assert.ok(await page.locator('.main-area').evaluate((el) => el.scrollWidth <= el.clientWidth))
  assert.equal(await fs.readFile(file, 'utf8'), originals['Home.md'])
  await nativeWindow.evaluate((win) => {
    win.setSize(1240, 840)
    win.focus()
  })
  await page.evaluate(() => window.slipsmd.updateSettings({ theme: 'light' }))
  await page.locator(primary + ' .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.waitForFunction(() => {
    const pane = document.querySelector('.primary-document')
    return pane.scrollTop + pane.clientHeight > pane.scrollHeight - 300
  })
  await page.keyboard.press('Enter')
  await page.keyboard.type('## New Draft Heading', { delay: 5 })
  await clickLink(page, primary, '#new-draft-heading')
  await expectHeading(page, primary, 'New Draft Heading')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.primary-document .save-status')?.textContent === '已保存',
  )
  assert.equal(await fs.readFile(file, 'utf8'), originals['Home.md'] + '\r\n## New Draft Heading')
  assert.deepEqual(errors, [])
  console.log(
    'PASS: missing-target recovery, narrow dark notice, and invalidation of the heading index after editing',
  )
} catch (error) {
  console.error(error)
  const page = application?.windows()[0]
  if (page) {
    await page.screenshot({ path: path.join(output, 'anchors-failure.png') }).catch(() => {})
    await fs.writeFile(path.join(output, 'anchors-failure.html'), await page.content())
  }
  throw error
} finally {
  for (const page of application?.windows() ?? [])
    await page
      .evaluate(() => document.querySelectorAll('dialog[open]').forEach((el) => el.close()))
      .catch(() => {})
  const deadline = setTimeout(() => application?.process().kill('SIGKILL'), 10000)
  try {
    await application?.close()
  } finally {
    clearTimeout(deadline)
  }
  if (!process.env.SLIPSMD_KEEP_TEST_DATA) await fs.rm(temp, { recursive: true, force: true })
}
