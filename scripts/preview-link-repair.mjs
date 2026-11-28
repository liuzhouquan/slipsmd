import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'vite'

const usage = `Read-only Markdown move-link preview (no move or file rewrite).
node scripts/preview-link-repair.mjs --root NOTES --source Old.md --target Archive/New.md
Optional: --plan-id SHA256 --select e000001,e000002
Selection regenerates the preview and requires the same complete plan ID.
JSON stdout; exit 0=complete, 1=invalid request, 2=incomplete scan.
Requires npm ci; root must not contain the system temporary build directory.`

async function run() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage)
    return
  }
  const options = new Map()
  const allowed = new Set(['--root', '--source', '--target', '--select', '--plan-id'])
  for (let i = 0; i < args.length; i++) {
    const separator = args[i].indexOf('=')
    const name = separator < 0 ? args[i] : args[i].slice(0, separator)
    const value = separator < 0 ? args[++i] : args[i].slice(separator + 1)
    if (
      !allowed.has(name) ||
      options.has(name) ||
      value === undefined ||
      (separator < 0 && value.startsWith('--'))
    )
      throw new Error('参数无效、重复或缺少取值。\n' + usage)
    options.set(name, value)
  }
  if (['--root', '--source', '--target'].some((name) => !options.get(name))) throw new Error(usage)
  if (options.has('--select') !== options.has('--plan-id'))
    throw new Error('--select 必须与 --plan-id 一起提供。')
  if (options.has('--plan-id') && !/^[a-f\d]{64}$/.test(options.get('--plan-id')))
    throw new Error('计划 ID 必须为完整 SHA256。')
  const root = await fs.realpath(options.get('--root'))
  const temporary = await fs.realpath(os.tmpdir())
  const inside = path.relative(root, temporary)
  if (
    !inside ||
    (!inside.startsWith('..' + path.sep) && inside !== '..' && !path.isAbsolute(inside))
  )
    throw new Error('工作区包含系统临时构建目录；请选择更具体的笔记目录，以保持只读。')
  const bundle = await fs.mkdtemp(path.join(temporary, 'slipsmd-link-preview-'))
  try {
    const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    await build({
      root: repository,
      configFile: false,
      logLevel: 'silent',
      cacheDir: path.join(bundle, 'cache'),
      ssr: { noExternal: true },
      build: {
        ssr: path.join(repository, 'src/main/link-repair-preview.ts'),
        outDir: bundle,
        emptyOutDir: false,
        rollupOptions: { output: { entryFileNames: 'preview.mjs' } },
      },
    })
    const { previewLinkRepair, selectPreview } = await import(
      pathToFileURL(path.join(bundle, 'preview.mjs')).href
    )
    let preview = await previewLinkRepair(root, options.get('--source'), options.get('--target'))
    if (options.has('--select'))
      preview = selectPreview(
        preview,
        options.get('--plan-id'),
        options.get('--select').split(',').filter(Boolean),
      )
    console.log(JSON.stringify(preview, null, 2))
    if (!preview.complete) process.exitCode = 2
  } finally {
    await fs.rm(bundle, { recursive: true, force: true })
  }
}
try {
  await run()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
