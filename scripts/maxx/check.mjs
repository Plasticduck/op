// Runs every check in scripts/maxx/checks against the dev page, one after the other, and says
// which passed and how long each took. One command, with a dev server of its own:
//   node scripts/maxx/check.mjs --serve 5404 [--out <folder>] [--only play,map] [--skip map]
// or against a dev server already running (node scripts/maxx/serve.mjs --port 5311):
//   node scripts/maxx/check.mjs [--port 5311] ...
//
//   sandbox  plays the sandbox level beat by beat (manual time) and photographs each beat
//   pad      an Xbox controller, stood in for, through input, simulation, scene, rumble and prompts
//   seams    prompt ids vs the text module, animation names vs the atlas, anchors, nozzle, sound ids
//   audio    real time: the title song, effects from simulation events, pause, mute, a jingle
//   unlock   the first key press unlocks the sound under Chrome's normal autoplay rule
//   play     the play scene: card, HUD, pause, retry, clear and tally, versus card, save rules
//   title    title, options, how to play, game over, the ending (reloads the page itself)
//   map      the world map: every save state, flourishes, every road both ways, the pad
//   render   the world renderer through the viewer on dev-render: every area, seams, allocation
//   replay   the level tools' solver run on the sandbox, replayed in the page to the same world hash
//   campaign the whole game from a fresh save through the real scenes: NEW GAME, each level's
//            stored solver run played in the play scene in map order (MW03 by its secret exit,
//            Rival Row), the save, tally and map after each, MW08 to the ending
//
// --list prints the checks. Pictures, report.txt and the check's whole output (log.txt) land in
// <folder>/<check> (default: a folder in the system's temp directory, printed at the end), with
// summary.txt beside them. Exit code 1 if any check fails.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

// --serve: run this same command again under serve.mjs, which stops the server when it ends.
const serve = opt('--serve')
if (serve !== undefined) {
  if (!/^\d+$/.test(serve)) {
    console.error('usage: node scripts/maxx/check.mjs --serve <port> [...]')
    process.exit(2)
  }
  const rest = args.filter((a, i) => !(a === '--serve' || args[i - 1] === '--serve' || a === '--port' || args[i - 1] === '--port'))
  const run = spawnSync(process.execPath, [path.join(HERE, 'serve.mjs'), '--port', serve, '--', 'node', fileURLToPath(import.meta.url), '--port', serve, ...rest], { stdio: 'inherit' })
  process.exit(run.status ?? 1)
}

const port = opt('--port') ?? '5311'
const out = path.resolve(opt('--out') ?? path.join(os.tmpdir(), 'maxx-check'))
const only = opt('--only')?.split(',').filter(Boolean)
const skip = opt('--skip')?.split(',').filter(Boolean) ?? []

const SHOT = path.join(HERE, 'shot.mjs')
const viaShot = (name, q, size = ['1280', '830']) => [SHOT, '--port', port, '--w', size[0], '--h', size[1], '--q', q, '--script', path.join(HERE, 'checks', name + '.mjs'), '--out', path.join(out, name, 'end.png')]
const CHECKS = {
  sandbox: viaShot('sandbox', 'scene=sandbox&manual=1&fresh=1'),
  pad: viaShot('pad', 'scene=sandbox&manual=1&fresh=1'),
  seams: viaShot('seams', 'scene=sandbox&manual=1&fresh=1'),
  audio: viaShot('audio', 'scene=title&fresh=1'),
  unlock: [path.join(HERE, 'checks', 'unlock.mjs'), '--port', port, '--out', path.join(out, 'unlock')],
  play: viaShot('play', 'scene=play&level=sandbox&manual=1&fresh=1'),
  title: viaShot('title', 'scene=title&manual=1&fresh=1&user=titlecheck'),
  map: viaShot('map', 'scene=map&manual=1&fresh=1'),
  render: viaShot('render', 'scene=viewer&level=dev-render&manual=1&fresh=1'),
  replay: viaShot('replay', 'scene=viewer&level=sandbox&manual=1&fresh=1&params=' + encodeURIComponent('{"seed":49734321}'), ['1280', '900']),
  campaign: viaShot('campaign', 'scene=title&manual=1&fresh=1&user=campaign'),
}
// Checks run only when named with --only (none at present).
const OPT_IN = new Set([])

if (args.includes('--list')) {
  for (const name of Object.keys(CHECKS)) console.log(name + (OPT_IN.has(name) ? '  (only when named with --only)' : ''))
  process.exit(0)
}
const unknown = [...(only ?? []), ...skip].filter((n) => !(n in CHECKS))
if (unknown.length) {
  console.error(`no check called ${unknown.join(', ')}; there are ${Object.keys(CHECKS).join(', ')}`)
  process.exit(2)
}
const chosen = Object.keys(CHECKS).filter((n) => (only ? only.includes(n) : !OPT_IN.has(n)) && !skip.includes(n))

// Nine failures that all say "could not open" help nobody: ask once.
const page = `http://localhost:${port}/dev/maxx.html`
const answered = await fetch(page, { signal: AbortSignal.timeout(20000) }).then(
  (r) => r.ok,
  () => false,
)
if (!answered) {
  console.error(`nothing answers at ${page}. Start a dev server (node scripts/maxx/serve.mjs --port ${port}) or let this start one: --serve <port>`)
  process.exit(1)
}

const secs = (ms) => (ms / 1000).toFixed(1).padStart(6) + ' s'
const clock = (ms) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const BAD = /^ {2}FAIL |^\[page (warn|error)\]|^\[page threw\]|^\[scene threw\]|^\[script failed\]|^\[shot\] (could not|the page never|the game was restarted)|^\[unlock failed\]/

console.log(`${chosen.length} checks against ${page}`)
mkdirSync(out, { recursive: true })
const summary = []
let failed = 0
const t0 = performance.now()
for (const name of chosen) {
  if (process.stdout.isTTY) process.stdout.write(`....  ${name.padEnd(8)}\r`)
  mkdirSync(path.join(out, name), { recursive: true })
  const start = performance.now()
  let run
  let text = ''
  let log = ''
  let tries = 0
  // shot.mjs exits 2 when the page reloaded under it (the dev server re-optimising its
  // dependencies, say): that says nothing about the game, so it gets one more go.
  do {
    tries++
    run = spawnSync(process.execPath, CHECKS[name], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    text = (run.stdout ?? '') + (run.stderr ?? '')
    log += (tries > 1 ? '\n==== run again: the page reloaded under the first ====\n' : '') + text
  } while (run.status === 2 && tries < 2)
  const ms = performance.now() - start
  writeFileSync(path.join(out, name, 'log.txt'), log)
  const passed = (text.match(/^ {2}ok /gm) ?? []).length
  const bad = text.split('\n').filter((l) => BAD.test(l))
  const ok = run.status === 0
  if (!ok) failed++
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(8)} ${String(passed).padStart(3)} checks ok ${secs(ms)}${tries > 1 ? '  (run twice: the page reloaded under the first)' : ''}${ok ? '' : `, exit code ${run.status}`}`
  console.log(line)
  summary.push(line)
  for (const l of bad) {
    const s = '        ' + l.trim().slice(0, 300)
    console.log(s)
    summary.push(s)
  }
}
const total = `${chosen.length - failed} of ${chosen.length} passed in ${clock(performance.now() - t0)}`
console.log(total)
summary.push(total)
writeFileSync(path.join(out, 'summary.txt'), summary.join('\n') + '\n')
console.log(`pictures and reports: ${out}`)
process.exit(failed ? 1 : 0)
