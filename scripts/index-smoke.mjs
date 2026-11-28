import { _electron as electron } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const root = path.resolve('.')
const packaged = process.argv.includes('--packaged')
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-index-desktop-')))
const work = path.join(temp, 'Current')
const other = path.join(temp, 'Other')
await fs.mkdir(work)
await fs.mkdir(other)
const home = path.join(work, 'Home.md')
const target = path.join(work, 'Target.md')
const source = path.join(work, 'Source.md')
const external = path.join(work, 'External.md')
const original = '\uFEFF# Source\r\n\r\n[home](Home.md)\r\n'
await fs.writeFile(home, '# Home\n\n[Target](Target.md)\n')
await fs.writeFile(target, '# Target\n')
await fs.writeFile(source, original)
await fs.writeFile(external, '# External\n\n[home](Home.md)\n')
for (let i = 0; i < 120; i++)
  await fs.writeFile(
    path.join(work, 'Note-' + i + '.md'),
    '# Note ' + i + '\n\n[Target](Target.md#section)\n',
  )
await fs.mkdir(path.join(work, '.hidden'))
await fs.writeFile(path.join(work, '.hidden', 'Hidden.md'), '[Home](../Home.md)')
await fs.writeFile(path.join(other, 'Home.md'), '# Other home\n')
await fs.writeFile(path.join(other, 'Source.md'), '[other home](Home.md)')
const env = {
  ...process.env,
  SLIPSMD_USER_DATA: path.join(temp, 'profile'),
  SLIPSMD_WORKSPACE: work,
  SLIPSMD_OPEN_FILE: home,
}
delete env.ELECTRON_RUN_AS_NODE
const output = path.join(root, '.test-results')
await fs.mkdir(output, { recursive: true })
let application
const errors = []
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
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.primary-document .cm-editor')
  const cold = await page.evaluate((p) => window.slipsmd.links(p), home)
  assert.deepEqual(
    cold.backlinks.map((link) => path.basename(link.source)),
    ['External.md', 'Source.md'],
  )
  const [second] = await Promise.all([
    application.waitForEvent('window', { timeout: 30000 }),
    page.getByRole('button', { name: '新建独立窗口', exact: true }).click(),
  ])
  second.on('pageerror', (error) => errors.push(error.message))
  await second.waitForSelector('.file-tree')
  const concurrent = await Promise.all([
    page.evaluate((p) => window.slipsmd.links(p), home),
    second.evaluate((p) => window.slipsmd.links(p), home),
    page.evaluate((p) => window.slipsmd.links(p), target),
    second.evaluate((p) => window.slipsmd.links(p), target),
  ])
  assert.deepEqual(concurrent[0], cold)
  assert.deepEqual(concurrent[1], cold)
  assert.equal(concurrent[2].backlinks.length, 121)
  assert.deepEqual(concurrent[2], concurrent[3])
  console.log(
    'PASS: real multi-window index queries agree and preserve the workspace directory boundary',
  )

  await second.evaluate(
    async ({ source }) => {
      const doc = await window.slipsmd.readDocument(source)
      await window.slipsmd.stageDocument(source, '# Source\n\n[Target](Target.md)\n', doc.revision)
    },
    { source },
  )
  assert.equal(await fs.readFile(source, 'utf8'), original)
  assert.equal((await page.evaluate((p) => window.slipsmd.links(p), home)).backlinks.length, 1)
  assert.equal((await page.evaluate((p) => window.slipsmd.links(p), target)).backlinks.length, 122)
  await second.evaluate(async (p) => {
    await window.slipsmd.saveDocument(p)
    await window.slipsmd.releaseDocument(p)
  }, source)
  assert.equal(await fs.readFile(source, 'utf8'), '\uFEFF# Source\r\n\r\n[Target](Target.md)\r\n')
  assert.equal((await page.evaluate((p) => window.slipsmd.links(p), target)).backlinks.length, 122)
  console.log(
    'PASS: staged text is indexed across windows before save; release falls back to BOM/CRLF-preserving disk content',
  )

  await fs.writeFile(external, '# External\n\n[Target](Target.md)\n')
  assert.equal((await page.evaluate((p) => window.slipsmd.links(p), target)).backlinks.length, 123)
  assert.equal((await page.evaluate((p) => window.slipsmd.links(p), home)).backlinks.length, 0)
  await fs.unlink(external)
  assert.equal((await page.evaluate((p) => window.slipsmd.links(p), target)).backlinks.length, 122)
  console.log(
    'PASS: immediate queries detect external writes and deletions without stale cached backlinks',
  )

  await application.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, other)
  await second.locator('.sidebar').getByRole('button', { name: '打开文件夹', exact: true }).click()
  await second.waitForFunction(
    async (folder) => (await window.slipsmd.bootstrap()).workspace?.root === folder,
    other,
  )
  const otherHome = path.join(other, 'Home.md')
  const different = await second.evaluate((p) => window.slipsmd.links(p), otherHome)
  assert.equal(different.backlinks.length, 1)
  assert.equal(different.backlinks[0].source, path.join(other, 'Source.md'))
  await assert.rejects(
    second.evaluate((p) => window.slipsmd.links(p), home),
    /授权/,
  )
  assert.equal((await page.evaluate((p) => window.slipsmd.links(p), target)).backlinks.length, 122)
  assert.equal(await fs.readFile(home, 'utf8'), '# Home\n\n[Target](Target.md)\n')
  assert.deepEqual(errors, [])
  console.log(
    'PASS: switching one window to another root isolates identically named notes while the first workspace stays valid',
  )
} catch (error) {
  console.error(error)
  const page = application?.windows()[0]
  if (page) {
    await page.screenshot({ path: path.join(output, 'index-failure.png') }).catch(() => {})
    await fs.writeFile(path.join(output, 'index-failure.html'), await page.content())
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
