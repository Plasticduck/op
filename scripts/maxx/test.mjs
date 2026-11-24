// Every simulation test: sim.mjs, then each file in scripts/maxx/tests/.
//   node scripts/maxx/test.mjs [--skip-core] [--only <file name part>]
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const dir = path.join(HERE, 'tests')
const files = (existsSync(dir) ? readdirSync(dir) : [])
  .filter((f) => f.endsWith('.mjs'))
  .sort()
  .map((f) => path.join(dir, f))
if (!args.includes('--skip-core')) files.unshift(path.join(HERE, 'sim.mjs'))

let failed = 0
for (const file of files) {
  const label = path.basename(file)
  if (only && !label.includes(only)) continue
  const run = spawnSync(process.execPath, [file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const lines = ((run.stdout ?? '') + (run.stderr ?? '')).split('\n')
  const tally = lines.filter((l) => /\d+ passed, \d+ failed/.test(l)).pop() ?? '(no tally)'
  if (run.status !== 0) failed++
  console.log(`${run.status === 0 ? 'PASS' : 'FAIL'}  ${label.padEnd(24)} ${tally.trim()}`)
  if (run.status !== 0) for (const l of lines.filter((l) => l.startsWith('FAIL') || l.startsWith('      ')).slice(0, 40)) console.log('      ' + l)
}
process.exit(failed ? 1 : 0)
