// The game's dev server: the repo's own Vite config on a given port, with a dependency
// cache of its own, so several servers in this checkout never invalidate each other
// ("Outdated Optimize Dep").
//
//   node scripts/maxx/serve.mjs --port 5321                 serve until killed
//   node scripts/maxx/serve.mjs --port 5321 -- node scripts/maxx/shot.mjs --port 5321 --out x.png
//                                                           serve, run that command, stop, and
//                                                           exit with the command's exit code
import { spawn } from 'node:child_process'
import path from 'node:path'
import { createServer } from 'vite'
import { REPO } from './paths.mjs'

const argv = process.argv.slice(2)
const split = argv.indexOf('--')
const own = split < 0 ? argv : argv.slice(0, split)
const command = split < 0 ? [] : argv.slice(split + 1)
const port = Number(own[own.indexOf('--port') + 1] || 5311)
if (!own.includes('--port') || !Number.isInteger(port)) {
  console.error('usage: node scripts/maxx/serve.mjs --port <port> [-- command ...]')
  process.exit(2)
}

let server
try {
  server = await createServer({
    root: REPO,
    cacheDir: path.join(REPO, 'node_modules', '.vite-maxx', String(port)),
    server: { port, strictPort: true, host: 'localhost' },
    logLevel: command.length ? 'error' : 'info',
    clearScreen: false,
  })
  await server.listen()
} catch (err) {
  console.error(`[serve] could not start on port ${port}: ${err && err.message ? err.message : err}`)
  process.exit(3)
}

if (!command.length) {
  server.printUrls()
} else {
  const exe = command[0] === 'node' ? process.execPath : command[0]
  const child = spawn(exe, command.slice(1), { stdio: 'inherit', cwd: process.cwd() })
  const done = async (code) => {
    await server.close().catch(() => {})
    process.exit(code)
  }
  child.on('error', (err) => {
    console.error(`[serve] could not run ${command[0]}: ${err.message}`)
    done(4)
  })
  child.on('exit', (code) => done(code ?? 1))
}
