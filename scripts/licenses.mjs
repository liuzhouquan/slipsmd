import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this script through npm run build.')
const paths = execFileSync(process.execPath, [npm, 'ls', '--parseable', '--all', '--omit=dev'], {
  encoding: 'utf8',
})
  .trim()
  .split(/\r?\n/)
  .slice(1)
const seen = new Set()
let output =
  '# Third-party notices\n\nGenerated from the locked production dependency tree. Electron distributions also include Chromium / Node notices in LICENSE and LICENSES.chromium.html.\n\nInkisle references the product ideas of Files.md and Typora; no code from those applications or MarkText/Muya is included.\n'
for (const dir of paths) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const id = pkg.name + '@' + pkg.version
  if (seen.has(id)) continue
  seen.add(id)
  output += '\n## ' + id + '\n\nLicense: ' + (pkg.license ?? 'see package') + '\n\n'
  const license = fs.readdirSync(dir).find((name) => /^licen[sc]e(?:\.md|\.txt)?$/i.test(name))
  if (license)
    output +=
      '```text\n' +
      fs
        .readFileSync(path.join(dir, license), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .trim() +
      '\n```\n'
  else output += 'See the upstream package for its complete licensing terms.\n'
}
fs.writeFileSync('THIRD_PARTY_NOTICES.md', output)
console.log('Generated notices for ' + seen.size + ' production packages.')
