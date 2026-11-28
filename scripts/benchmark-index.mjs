import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const count = Number(process.argv[2] ?? 1000)
assert.ok(Number.isInteger(count) && count >= 10 && count <= 10000, 'Use 10–10,000 notes.')
const output = path.resolve('.test-results')
await fs.mkdir(output, { recursive: true })
const bundle = await fs.mkdtemp(path.join(output, 'index-benchmark-'))
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-benchmark-')))
try {
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: true,
      outDir: bundle,
      rollupOptions: {
        input: {
          index: path.resolve('src/main/link-index.ts'),
          links: path.resolve('src/main/links.ts'),
        },
        output: { entryFileNames: '[name].mjs' },
      },
    },
  })
  const { LinkIndex } = await import(pathToFileURL(path.join(bundle, 'index.mjs')).href)
  const { extractLinks } = await import(pathToFileURL(path.join(bundle, 'links.mjs')).href)
  const names = Array.from({ length: count }, (_, i) => 'Note-' + i + '.md')
  let cursor = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (cursor < names.length) {
        const i = cursor++
        const text =
          '# Note ' +
          i +
          '\n\n' +
          '[next](Note-' +
          ((i + 1) % count) +
          '.md#reading)\n\n' +
          Array.from(
            { length: 25 },
            (_, n) =>
              'Paragraph ' +
              n +
              ': **Markdown** reading context with `code`, 中文笔记和关联阅读。\n\n' +
              '- Keep ordinary Markdown as the source of truth.\n',
          ).join('\n') +
          '\n## Reading\n\n| Name | Value |\n| --- | --- |\n| Example | 42 |\n'
        await fs.writeFile(path.join(root, names[i]), text)
      }
    }),
  )
  const listFiles = async () => (await fs.readdir(root)).sort().map((name) => path.join(root, name))
  const index = new LinkIndex(root, listFiles, () => undefined)
  const target = path.join(root, names[0])
  const measurements = []
  async function measure(label, task) {
    const before = index.statistics
    const start = performance.now()
    const result = await task()
    const elapsed = Math.round((performance.now() - start) * 100) / 100
    const after = index.statistics
    const delta = Object.fromEntries(
      Object.keys(after).map((key) => [key, after[key] - before[key]]),
    )
    const row = { label, milliseconds: elapsed, ...delta }
    measurements.push(row)
    return { result, row }
  }
  const cold = await measure('cold index', () => index.query(target))
  assert.equal(cold.result.backlinks.length, 1)
  assert.equal(cold.row.reads, count)
  const warm = await measure('unchanged repeat query', () => index.query(target))
  assert.equal(warm.row.reads, 0)
  assert.equal(warm.row.parses, 0)
  await fs.appendFile(path.join(root, names[1]), '\n[return](Note-0.md)\n')
  const edited = await measure('one external file edited', () => index.query(target))
  assert.equal(edited.result.backlinks.length, 2)
  assert.equal(edited.row.reads, 1)
  assert.equal(edited.row.parses, 1)
  const concurrent = await measure('four overlapping window queries', () =>
    Promise.all(names.slice(0, 4).map((name) => index.query(path.join(root, name)))),
  )
  assert.equal(concurrent.row.scans, 1)
  assert.equal(concurrent.row.reads, 0)
  assert.equal(concurrent.row.parses, 0)

  // Same files, with bounded I/O, but deliberately no parsed-link cache.
  // This isolates re-reading/parsing costs rather than modeling full application latency.
  const start = performance.now()
  const files = await listFiles()
  let position = 0
  let links = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (position < files.length) {
        const source = files[position++]
        const text = await fs.readFile(source, 'utf8')
        links += extractLinks(source, text, root).length
      }
    }),
  )
  assert.equal(links, count + 1)
  const report = {
    node: process.version,
    platform: process.platform,
    notes: count,
    measurements,
    uncachedBaseline: {
      milliseconds: Math.round((performance.now() - start) * 100) / 100,
      reads: count,
      parses: count,
      concurrency: 8,
    },
    scope:
      'Synthetic workspace link queries; includes directory enumeration and metadata. Not full application startup, editor latency or a time threshold.',
  }
  await fs.writeFile(
    path.join(output, 'index-benchmark.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(bundle, { recursive: true, force: true })
}
