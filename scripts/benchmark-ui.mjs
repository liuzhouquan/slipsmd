import { _electron as electron } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const args = process.argv.slice(2)
const packaged = args.includes('--packaged')
const positional = args.filter((arg) => !arg.startsWith('--'))
const noteCount = Number(positional[0] ?? 2000)
const lineTarget = Number(positional[1] ?? 4000)

assert.ok(
  Number.isInteger(noteCount) && noteCount >= 20 && noteCount <= 10000,
  'Use 20–10,000 notes.',
)
assert.ok(
  Number.isInteger(lineTarget) && lineTarget >= 200 && lineTarget <= 20000,
  'Use 200–20,000 lines.',
)

const root = path.resolve('.')
if (!packaged) {
  await fs
    .access(path.join(root, 'out/main/index.js'))
    .catch(() => assert.fail('Missing out/main/index.js. Run `npm run build` first.'))
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const round = (n) => Math.round(n * 100) / 100
  const percentile = (p) => {
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    return round(sorted[Math.max(0, idx)])
  }
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  return {
    count: sorted.length,
    minMs: round(sorted[0]),
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    maxMs: round(sorted[sorted.length - 1]),
    meanMs: round(sum / sorted.length),
  }
}

function buildLongMarkdown(targetLines) {
  const chunks = ['# Long Document\n\n']
  let lines = 2
  let section = 1
  while (lines < targetLines) {
    const block = [
      `## Section ${section} 中文标题示例\n\n`,
      `Paragraph ${section}: **SlipsMD** keeps ordinary Markdown with \`inlineCode\`, [Home](Home.md), and inline math $x_${section} + y^2 = z$.\n\n`,
      `> Blockquote ${section}: 先记录，再整理；用链接展开想法。\n\n`,
      `- [ ] Task item ${section} in long document\n`,
      `- Bullet item ${section} with *emphasis* and ~~strike~~\n\n`,
      `| Key | Value |\n| --- | --- |\n| Item ${section} | ${section * 42} |\n\n`,
      '$$\n\\sum_{i=1}^{n} x_i^2 = \\text{metric}\n$$\n\n',
      '```ts\nconst metric = ' + section + '\n```\n\n',
    ].join('')
    chunks.push(block)
    lines += block.split('\n').length - 1
    section++
  }
  return { content: chunks.join(''), approxLines: lines }
}

const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-ui-bench-')))
const work = path.join(temp, 'Workspace')
const profile = path.join(temp, 'profile')
await fs.mkdir(work)
await fs.mkdir(profile)

const folderCount = 20
const folders = []
for (let f = 0; f < folderCount; f++) {
  const dir = path.join(work, 'Folder-' + String(f).padStart(2, '0'))
  const sub = path.join(dir, 'Sub-' + String(f % 4))
  await fs.mkdir(sub, { recursive: true })
  folders.push(dir, sub)
}

const homePath = path.join(work, 'Home.md')
const longDocPath = path.join(work, 'LongDocument.md')
await fs.writeFile(
  homePath,
  '# Home\n\n[Long Document](LongDocument.md)\n\n[Note 0](Folder-00/Note-0.md)\n',
)
const longDoc = buildLongMarkdown(lineTarget)
await fs.writeFile(longDocPath, longDoc.content)

let cursor = 0
const remaining = noteCount - 2
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (cursor < remaining) {
      const i = cursor++
      const folder = folders[i % folders.length]
      const text = `# Note ${i}\n\nLink to [Home](../Home.md) and [Long](../LongDocument.md).\n`
      await fs.writeFile(path.join(folder, `Note-${i}.md`), text)
    }
  }),
)

const output = path.join(root, '.test-results')
await fs.mkdir(output, { recursive: true })
const env = {
  ...process.env,
  SLIPSMD_USER_DATA: profile,
  SLIPSMD_WORKSPACE: work,
  SLIPSMD_OPEN_FILE: homePath,
}
delete env.ELECTRON_RUN_AS_NODE

let application
const errors = []

try {
  const launchStart = performance.now()
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
  await page.waitForSelector(`.file-tree .file-row[data-path="${homePath}"]`)
  const appReadyMs = Math.round((performance.now() - launchStart) * 100) / 100

  const coldIndexStart = performance.now()
  const homeLinks = await page.evaluate((p) => window.slipsmd.links(p), homePath)
  const coldIndexMs = Math.round((performance.now() - coldIndexStart) * 100) / 100

  const refreshStart = performance.now()
  await page.evaluate(async () => {
    await window.slipsmd.refreshWorkspace()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  const refreshWorkspaceMs = Math.round((performance.now() - refreshStart) * 100) / 100

  const treeMetrics = await page.evaluate(() => {
    const tree = document.querySelector('.file-tree')
    return {
      totalElements: tree ? tree.querySelectorAll('*').length : 0,
      detailsCount: tree ? tree.querySelectorAll('details[data-directory]').length : 0,
      fileRowsCount: tree ? tree.querySelectorAll('.file-row').length : 0,
    }
  })

  const filterInput = page.locator('.sidebar input[placeholder="查找笔记…"]')
  const filterApplyStart = performance.now()
  await filterInput.fill('Note-100')
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const filterApplyMs = Math.round((performance.now() - filterApplyStart) * 100) / 100
  const filteredRowsCount = await page.locator('.file-tree .file-row').count()

  const filterClearStart = performance.now()
  await filterInput.fill('')
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const filterClearMs = Math.round((performance.now() - filterClearStart) * 100) / 100

  const firstFolderSummary = page.locator('.file-tree details[data-directory] > summary').first()
  const folderToggleStart = performance.now()
  await firstFolderSummary.click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const folderToggleMs = Math.round((performance.now() - folderToggleStart) * 100) / 100

  // Open LongDocument.md via file tree click
  const longDocOpenStart = performance.now()
  await page.locator(`.file-tree .file-row[data-path="${longDocPath}"]`).click()
  await page.waitForFunction(() =>
    document.querySelector('.primary-document .cm-content')?.textContent?.includes('Long Document'),
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const longDocOpenMs = Math.round((performance.now() - longDocOpenStart) * 100) / 100

  async function measureInputAndCursor(label) {
    await page.locator('.primary-document .cm-content').click()
    await page.keyboard.press('Control+Home')
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )

    const typingSamples = []
    const chars = 'abcdefghijklmnopqrst'
    for (const ch of chars) {
      const t0 = performance.now()
      await page.keyboard.press(ch)
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      typingSamples.push(performance.now() - t0)
    }

    const cursorSamples = []
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now()
      await page.keyboard.press('ArrowDown')
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      cursorSamples.push(performance.now() - t0)
    }

    return {
      mode: label,
      typing: summarize(typingSamples),
      cursorMove: summarize(cursorSamples),
    }
  }

  const previewMeasurements = await measureInputAndCursor('live-preview')

  const toSourceStart = performance.now()
  await page.locator('.primary-document button[aria-label="切换源码模式"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const switchToSourceMs = Math.round((performance.now() - toSourceStart) * 100) / 100

  const sourceMeasurements = await measureInputAndCursor('source')

  const toPreviewStart = performance.now()
  await page.locator('.primary-document button[aria-label="切换实时预览"]').click()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const switchToPreviewMs = Math.round((performance.now() - toPreviewStart) * 100) / 100

  assert.deepEqual(errors, [], `Uncaught renderer errors: ${errors.join('; ')}`)

  const report = {
    node: process.version,
    platform: process.platform,
    packaged,
    workload: {
      notes: noteCount,
      folders: folders.length,
      longDocumentLines: longDoc.approxLines,
      longDocumentBytes: Buffer.byteLength(longDoc.content, 'utf8'),
    },
    initialScan: {
      appReadyMs,
      coldLinkIndexMs: coldIndexMs,
      homeBacklinks: homeLinks.backlinks.length,
      refreshWorkspaceMs,
    },
    fileTree: {
      ...treeMetrics,
      filterApplyMs,
      filteredRowsCount,
      filterClearMs,
      folderToggleMs,
    },
    longDocument: {
      openMs: longDocOpenMs,
      switchToSourceMs,
      switchToPreviewMs,
      livePreview: previewMeasurements,
      source: sourceMeasurements,
    },
    scope:
      'Synthetic desktop UI measurement via Playwright + Electron. Includes IPC and requestAnimationFrame settle; not cross-machine latency guarantees.',
  }

  await fs.writeFile(path.join(output, 'ui-benchmark.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (application) {
    await Promise.race([
      application.close(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]).catch(() => {})
  }
  await fs.rm(temp, { recursive: true, force: true })
}
