import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let temp: string
let root: string
const script = path.resolve('scripts/preview-link-repair.mjs')
beforeEach(async () => {
  temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'slipsmd-repair-cli-')))
  root = path.join(temp, 'notes')
  await fs.mkdir(root)
  await fs.mkdir(path.join(root, 'Archive'))
  await fs.writeFile(path.join(root, 'Old.md'), '\uFEFF# Old\r\n\r\n![pic](assets/a.png)\r\n')
  await fs.writeFile(path.join(root, 'Index.md'), '[old](Old.md#target)\n')
})
afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true })
})
function run(extra: string[] = [], help = false) {
  const args = help
    ? extra
    : ['--root', root, '--source', 'Old.md', '--target', 'Archive/New.md', ...extra]
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    // Deliberately launch outside the repository; paths resolve from the entry script.
    const child = spawn(process.execPath, [script, ...args], { cwd: temp, stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    const deadline = setTimeout(() => child.kill(), 20000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(deadline)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(deadline)
      resolve({ code, stdout, stderr })
    })
  })
}

describe('read-only move-link preview CLI', () => {
  it('previews and selects from outside the repo, rejecting stale plans without writes', async () => {
    const before = await fs.readFile(path.join(root, 'Old.md'))
    const initial = await run()
    expect(initial.code, initial.stderr).toBe(0)
    const preview = JSON.parse(initial.stdout)
    expect(preview.readOnly).toBe(true)
    expect(preview.complete).toBe(true)
    expect(preview.summary.proposedEdits).toBe(2)
    const selected = await run([
      '--plan-id',
      preview.planId,
      '--select',
      preview.files[0].edits[0].id,
    ])
    expect(selected.code, selected.stderr).toBe(0)
    expect(JSON.parse(selected.stdout).summary.selectedEdits).toBe(1)
    await fs.appendFile(path.join(root, 'Index.md'), '\nNew text\n')
    const stale = await run(['--plan-id', preview.planId, '--select', preview.files[0].edits[0].id])
    expect(stale.code).toBe(1)
    expect(stale.stderr).toContain('过期')
    expect(await fs.readFile(path.join(root, 'Old.md'))).toEqual(before)
    expect(await fs.readdir(path.join(root, 'Archive'))).toEqual([])
  }, 90000)

  it('returns incomplete JSON with a distinct exit code for unreadable Markdown', async () => {
    await fs.writeFile(path.join(root, 'Bad.md'), Buffer.from([0xff, 0xfe]))
    const result = await run()
    expect(result.code, result.stderr).toBe(2)
    const preview = JSON.parse(result.stdout)
    expect(preview.complete).toBe(false)
    expect(preview.diagnostics.some((d: { code: string }) => d.code === 'file-unreadable')).toBe(
      true,
    )
    expect(await fs.readdir(path.join(root, 'Archive'))).toEqual([])
  }, 30000)

  it('provides help and rejects unknown flags or unbound selections before scanning', async () => {
    const help = await run(['--help'], true)
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('Read-only')
    expect((await run(['--apply', 'yes'])).code).toBe(1)
    expect((await run(['--select', 'e000001'])).stderr).toContain('--plan-id')
    expect((await run(['--target', 'Another.md'])).code).toBe(1)
    await fs.rename(path.join(root, 'Old.md'), path.join(root, '--Old.md'))
    const dashed = await run(['--root', root, '--source=--Old.md', '--target=Archive/New.md'], true)
    expect(dashed.code, dashed.stderr).toBe(0)
    expect(JSON.parse(dashed.stdout).source).toBe('--Old.md')
  }, 30000)
})
