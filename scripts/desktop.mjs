import { spawnSync } from 'node:child_process'

for (const script of [
  'scripts/smoke.mjs',
  'scripts/pins-smoke.mjs',
  'scripts/positions-smoke.mjs',
  'scripts/relocation-smoke.mjs',
  'scripts/creation-smoke.mjs',
]) {
  const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
