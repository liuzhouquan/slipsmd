import { _electron as electron } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const root = path.resolve('.')
const packaged = process.argv.includes('--packaged')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-positions-'))
const work = path.join(temp, 'notes')
await fs.mkdir(work)
const files = {}
for (const name of ['Home', 'Alpha', 'Beta']) {
  files[name] =
    `# ${name}\n\n[Alpha](Alpha.md) · [Beta](Beta.md)\n\n` +
    Array.from(
      { length: 150 },
      (_, i) =>
        `${name} paragraph ${String(i).padStart(3, '0')}: A long note keeps its reading position when you leave and return. 中文笔记也要保留阅读上下文。`,
    ).join('\n\n') +
    '\n'
  await fs.writeFile(path.join(work, name + '.md'), files[name])
}
files.Short = '# Short\n\nA new note starts at the top.\n'
await fs.writeFile(path.join(work, 'Short.md'), files.Short)
const env = {
  ...process.env,
  SLIPSMD_USER_DATA: path.join(temp, 'profile'),
  SLIPSMD_WORKSPACE: work,
}
delete env.ELECTRON_RUN_AS_NODE
const output = path.join(root, '.test-results')
await fs.mkdir(output, { recursive: true })
let application
const errors = []
const pane = '.primary-document'
const related = '.related-pane'
const nameIn = (selector) => selector + ' .document-name'
async function openMain(page, name) {
  await page.locator('.file-tree .file-row').filter({ hasText: name }).click()
  await page.waitForFunction(
    ({ selector, name }) => document.querySelector(selector)?.textContent === name + '.md',
    { selector: nameIn(pane), name },
  )
}
async function setScroll(page, selector, top) {
  await page.locator(selector).evaluate((el, top) => {
    // Like a user's scroll gesture, cancel any initial restoration before scrolling.
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    el.scrollTop = top
  }, top)
  // CodeMirror measures newly visible blocks and can adjust the scroll anchor.
  // Capture the resulting position after that layout, not its initial estimate.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ),
  )
  return readingLocation(page, selector)
}
function readingLocation(page, selector) {
  return page.locator(selector).evaluate((el) => {
    const top =
      el.getBoundingClientRect().top +
      (el.querySelector(':scope > .related-toolbar')?.offsetHeight ?? 0)
    const line = [...el.querySelectorAll('.cm-line')].find(
      (line) => line.textContent.trim() && line.getBoundingClientRect().bottom > top,
    )
    return { text: line?.textContent, offset: line?.getBoundingClientRect().top - top }
  })
}
async function expectLocation(page, selector, location) {
  try {
    await page.waitForFunction(
      ({ selector, location }) => {
        const el = document.querySelector(selector)
        const top =
          el.getBoundingClientRect().top +
          (el.querySelector(':scope > .related-toolbar')?.offsetHeight ?? 0)
        const line = [...el.querySelectorAll('.cm-line')].find(
          (line) => line.textContent.trim() && line.getBoundingClientRect().bottom > top,
        )
        return (
          line?.textContent === location.text &&
          Math.abs(line.getBoundingClientRect().top - top - location.offset) < 4
        )
      },
      { selector, location },
    )
  } catch (error) {
    throw new Error(
      `${selector}: expected ${JSON.stringify(location)}, got ${JSON.stringify(await readingLocation(page, selector))}`,
      { cause: error },
    )
  }
}
async function expectScroll(page, selector, top, tolerance = 8) {
  try {
    await page.waitForFunction(
      ({ selector, top, tolerance }) =>
        Math.abs(document.querySelector(selector).scrollTop - top) <= tolerance,
      { selector, top, tolerance },
    )
  } catch (error) {
    const actual = await page.locator(selector).evaluate((el) => el.scrollTop)
    throw new Error(`${selector}: expected scroll ${top}, got ${actual}`, { cause: error })
  }
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
    args: ['--no-sandbox', ...(packaged ? [] : [root]), path.join(work, 'Home.md')],
    env,
    timeout: 60000,
  })
  const page = await application.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForSelector(pane + ' .cm-editor')
  await page.locator(pane).getByRole('button', { name: '切换源码模式' }).click()
  await page
    .locator(pane + ' .cm-line')
    .filter({ hasText: 'Home paragraph 002:' })
    .click({ position: { x: 20, y: 10 } })
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  const selected = await page.evaluate(() => window.getSelection().toString())
  assert.ok(selected.includes('Home paragraph 002:'))
  const homeTop = await setScroll(page, pane, 1300)
  await openMain(page, 'Alpha')
  await expectScroll(page, pane, 0)
  const alphaTop = await setScroll(page, pane, 2700)
  await openMain(page, 'Home')
  await expectLocation(page, pane, homeTop)
  assert.equal(await page.locator(pane + ' .source-mode').count(), 1)
  await openMain(page, 'Home') // Focus without moving the restored selection.
  assert.equal(await page.evaluate(() => window.getSelection().toString()), selected)
  await openMain(page, 'Alpha')
  await expectLocation(page, pane, alphaTop)
  await openMain(page, 'Short')
  await expectScroll(page, pane, 0)
  console.log(
    'PASS: independent main-document scroll, selection and source mode; fresh notes start at top',
  )

  await openMain(page, 'Home')
  await expectLocation(page, pane, homeTop)
  await page.locator(pane).getByRole('button', { name: '切换实时预览' }).click()
  await setScroll(page, pane, 0)
  await page.locator(pane + ' [data-href="Alpha.md"]').click()
  await page.waitForSelector(related + ' .cm-editor')
  await expectScroll(page, related, 0)
  const relatedAlphaTop = await setScroll(page, related, 1600)
  await page.locator(pane + ' [data-href="Beta.md"]').click()
  await page.waitForFunction(
    () => document.querySelector('.related-pane .document-name')?.textContent === 'Beta.md',
  )
  await expectScroll(page, related, 0)
  const relatedBetaTop = await setScroll(page, related, 3100)
  await page.getByRole('button', { name: '上一份关联笔记', exact: true }).click()
  await expectLocation(page, related, relatedAlphaTop)
  await page.getByRole('button', { name: '下一份关联笔记', exact: true }).click()
  await expectLocation(page, related, relatedBetaTop)
  await page.getByRole('button', { name: '关闭关联笔记', exact: true }).click()
  await page.locator(pane + ' [data-href="Alpha.md"]').click()
  await expectLocation(page, related, relatedAlphaTop)
  console.log('PASS: related-note back/forward and close/reopen retain separate reading positions')

  const beforeAlign = await setScroll(page, pane, 2200)
  const narrowTop = await page.locator(pane).evaluate((el) => el.scrollTop)
  const narrowLocation = await setScroll(page, pane, narrowTop + beforeAlign.offset - 12)
  await openMain(page, 'Short')
  await page.getByRole('button', { name: '关闭关联笔记', exact: true }).click()
  await openMain(page, 'Home')
  await expectLocation(page, pane, narrowLocation)
  const userLocation = await setScroll(page, pane, 1500)
  await page.waitForTimeout(1700) // Longer than the initial layout-restoration window.
  await expectLocation(page, pane, userLocation)
  console.log(
    'PASS: content anchors survive width changes and user scrolling overrides restoration',
  )

  await openMain(page, 'Alpha')
  await expectLocation(page, pane, alphaTop)
  const next = application.waitForEvent('window')
  await page
    .locator('.file-tree .file-row')
    .filter({ hasText: 'Beta' })
    .click({ modifiers: ['Control'] })
  const second = await next
  second.on('pageerror', (e) => errors.push(e.message))
  await second.waitForSelector(pane + ' .cm-editor')
  await openMain(second, 'Alpha')
  await expectScroll(second, pane, 0)
  await setScroll(second, pane, 600)
  await expectLocation(page, pane, alphaTop)
  console.log('PASS: the same file has independent positions in separate windows')

  for (const [name, original] of Object.entries(files))
    assert.equal(await fs.readFile(path.join(work, name + '.md'), 'utf8'), original)
  await openMain(page, 'Short')
  await fs.writeFile(path.join(work, 'Home.md'), '# Now short\n')
  await openMain(page, 'Home')
  await expectScroll(page, pane, 0)
  assert.ok((await page.locator(pane + ' .cm-content').innerText()).includes('Now short'))
  assert.equal(
    (await page.evaluate((file) => window.slipsmd.readDocument(file), path.join(work, 'Home.md')))
      .text,
    '# Now short\n',
  )
  await page.screenshot({ path: path.join(output, 'positions.png') })
  assert.deepEqual(errors, [])
  console.log('PASS: navigation never rewrites Markdown; shortened disk documents restore safely')
} catch (error) {
  const page = application?.windows()[0]
  if (page) {
    await page.screenshot({ path: path.join(output, 'positions-failure.png') }).catch(() => {})
    await fs.writeFile(path.join(output, 'positions-failure.html'), await page.content())
  }
  throw error
} finally {
  await application?.close()
  if (!process.env.SLIPSMD_KEEP_TEST_DATA) await fs.rm(temp, { recursive: true, force: true })
}
