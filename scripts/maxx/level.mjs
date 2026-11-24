// Level tools for designers who cannot play the game yet: lint, the reachability map, checked
// expectations, and random play as a second opinion on the map. Everything is computed with the
// real simulation (lib/reach.mjs).
//
//   node scripts/maxx/level.mjs lint   <level | all> [--strict]
//   node scripts/maxx/level.mjs reach  <level> [--area id] [modes] [--hover off|top|held|all] [--cols 40-120]
//                                      [--width 100] [--no-map] [--json file] [--png file] [--scale 8]
//   node scripts/maxx/level.mjs expect <level> [--reach "goal,tokens"] [--not "@120-140,2 unless grime=washed"]
//                                      [--fair goal] [--file expectations.txt] [modes] [--hover ...] [--verbose]
//   node scripts/maxx/level.mjs fuzz   <level> [modes] [--ticks 2e6] [--seed n] [--hover off] [--json file]
//   node scripts/maxx/level.mjs list
//
//   <level>  a level id (sandbox, dev-critters, mw01 ...) or the path of a level's .ts file
//   modes    --grime kept|washed  --gates closed|open  --cars none|roofs  --hidden off|on
//            --mode all (everything open)
//   --hover  which hovers the map tries: off; top (held from the top of the jump, as level 2
//            teaches); held (also begun late, never tapped); all (also tapped; the default).
//            --no-hover and --held-hover are the old names of off and held.
//
// With no --reach/--not/--fair/--file, expect reads `export const EXPECT: string[]` from the
// level's own module (see levels/dev/reach.ts). One expectation a line:
//   reach|not|fair <targets> [with <modes>] [unless <modes>] [within <n>s]
//   targets: goal secret tokens token1..3 checkpoints checkpoint<n> coins blocks area:<id>
//            [area]@cols[,rows]   (a standing place: rows are the row his feet are in, as for '@')
//   modes:   grime=washed gates=open cars=roofs hidden=on all hover=off|top|held
//
// Levels are found as the game finds them (levels/index.ts): levels/mw01.ts .. mw08.ts and
// rivals.ts by their default export, the test rooms in levels/dev/, and the sandbox.
// Exit code: 0 clean, 1 lint errors, failed expectations or a fuzz find, 2 bad command line.
// How the map is made: the header of lib/reach.mjs.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { ALL_MODES, HOVER_NAMES, MODE, buildWorld, createReach, describeMacro, modeDelta, modeName, parseMode } from './lib/reach.mjs'
import { ASSETS_DIR, GAME_DIR, GAME_URL, REPO } from './paths.mjs'

/* ------------------------------------------------------------------ */
/* Loading the game and its levels                                     */
/* ------------------------------------------------------------------ */

export async function openGame() {
  const server = await createServer({
    root: REPO,
    configFile: false,
    logLevel: 'error',
    clearScreen: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    const contract = await server.ssrLoadModule(GAME_URL + '/game/contract.ts')
    const sim = await server.ssrLoadModule(GAME_URL + '/game/sim/index.ts')
    const levels = await server.ssrLoadModule(GAME_URL + '/game/levels/index.ts')
    // For the sign lint's line breaks; a level can be linted without them.
    let text = null
    try {
      const t = await server.ssrLoadModule(GAME_URL + '/game/engine/text.ts')
      const { GLYPHS } = await server.ssrLoadModule(GAME_URL + '/game/engine/input.ts')
      text = { wrapText: t.wrapText, bindGlyphs: t.bindGlyphs, GLYPHS }
    } catch {
      text = null
    }
    return { server, contract, sim, levels, text, close: () => server.close() }
  } catch (err) {
    await server.close()
    throw err
  }
}

const isLevel = (v) => v && typeof v === 'object' && typeof v.id === 'string' && Array.isArray(v.areas)
const toUrl = (file) => '/' + path.relative(REPO, file).split(path.sep).join('/')
/** The LevelDefs a level module offers, as levels/index.ts reads it: its default export; failing that (the sandbox), its named ones. */
const levelsOf = (mod) => (isLevel(mod.default) ? [mod.default] : Object.values(mod).filter(isLevel))
/** Whether the game itself opens this very LevelDef by its id (levels/index.ts levelById), or null when that cannot be asked. */
const servedBy = (game, level) => (typeof game.levels?.levelById === 'function' ? game.levels.levelById(level.id) === level : null)

/**
 * Every level the tools can see, found as the game finds them: the level files (levels/*.ts,
 * levels/dev/*.ts), then anything else levels/index.ts serves. Map id -> { level, mod, file,
 * served (the game opens it by its id) }; a file that does not load is '(<file>)' with `error`.
 * found.clashes lists ids that two files define: [{ id, file, first }].
 */
export async function findLevels(game) {
  const found = new Map()
  found.clashes = []
  const dirs = [path.join(GAME_DIR, 'game', 'levels'), path.join(GAME_DIR, 'game', 'levels', 'dev')]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.ts') || f === 'index.ts' || f === 'meta.ts') continue
      const file = path.join(dir, f)
      try {
        const mod = await game.server.ssrLoadModule(toUrl(file))
        for (const v of levelsOf(mod)) {
          if (found.has(v.id)) found.clashes.push({ id: v.id, file, first: found.get(v.id).file })
          else found.set(v.id, { level: v, mod, file, served: servedBy(game, v) })
        }
      } catch (err) {
        found.set(`(${f})`, { level: null, mod: null, file, error: err })
      }
    }
  }
  const { levels } = game
  for (const l of [levels.sandboxLevel, ...(levels.LEVELS ?? []), ...(levels.RIVALS ? [levels.RIVALS] : []), ...(levels.DEV_LEVELS ?? [])]) {
    if (isLevel(l) && !found.has(l.id)) found.set(l.id, { level: l, mod: null, file: null, served: true })
  }
  return found
}

/** One level by id, or by the path of its .ts file (anywhere: a draft can be checked before it is placed). */
export async function loadOne(game, arg) {
  if (arg.endsWith('.ts')) {
    const file = path.resolve(arg)
    const mod = await game.server.ssrLoadModule(toUrl(file))
    const level = levelsOf(mod)[0]
    if (!level) throw new Error(`${arg} exports no LevelDef`)
    return { level, mod, file, served: servedBy(game, level) }
  }
  const all = await findLevels(game)
  const hit = all.get(arg)
  if (!hit || !hit.level) throw new Error(`no level '${arg}'. Known: ${[...all.keys()].join(', ')}`)
  return hit
}

/* ------------------------------------------------------------------ */
/* Command line                                                        */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const pos = []
  const flags = {}
  const multi = new Set(['reach', 'not', 'fair'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      pos.push(a)
      continue
    }
    const name = a.slice(2)
    const next = argv[i + 1]
    const value = next !== undefined && !next.startsWith('--') ? (i++, next) : true
    if (multi.has(name)) (flags[name] ??= []).push(value)
    else flags[name] = value
  }
  return { pos, flags }
}

function modeFromFlags(flags) {
  let m = 0
  if (flags.mode) m = parseMode(flags.mode, m)
  for (const k of ['grime', 'gates', 'cars', 'hidden']) if (typeof flags[k] === 'string') m = parseMode(`${k}=${flags[k]}`, m)
  return m
}

/** --hover off|top|held|all (and the old --no-hover, --held-hover); null when none is given. Throws on a bad value. */
function hoverFromFlags(flags) {
  if (flags['no-hover']) return 'off'
  if (flags['held-hover']) return 'held'
  if (flags.hover === undefined) return null
  if (!(flags.hover in HOVER_NAMES)) throw new Error(`--hover takes ${Object.keys(HOVER_NAMES).join(', ')}`)
  return flags.hover
}

const USAGE = `usage:
  node scripts/maxx/level.mjs lint <level|all> [--strict]
  node scripts/maxx/level.mjs reach <level> [--area id] [modes] [--hover off|top|held|all] [--cols a-b] [--width n] [--no-map] [--json file] [--png file] [--scale n]
  node scripts/maxx/level.mjs expect <level> [--reach "..."] [--not "..."] [--fair "..."] [--file f] [modes] [--hover off|top|held|all] [--verbose]
  node scripts/maxx/level.mjs fuzz <level> [modes] [--ticks 2e6] [--seed n] [--hover off]
  node scripts/maxx/level.mjs list
modes: --grime kept|washed --gates closed|open --cars none|roofs --hidden off|on --mode all
hover: off (none), top (held from the top of the jump), held (also begun late), all (also tapped; the default)
expectations: reach|not|fair <targets> [with <modes>] [unless <modes>] [within <n>s]`

/* ------------------------------------------------------------------ */
/* Lint                                                                */
/* ------------------------------------------------------------------ */

const FONT = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?'\":;-+*/\\|()%&<>=#$@_^~`[]{} ")
const ACTION_TOKENS = ['jump', 'spray', 'confirm', 'cancel', 'pause', 'select', 'left', 'right', 'up', 'down', 'move']
const SYMBOL_TOKENS = ['heart', 'drop', 'star', 'times', 'coin', 'check', 'lock', 'pointer', 'arrow_left', 'arrow_right', 'arrow_up', 'arrow_down']
const SHIPPING = /^(mw0[1-8]|rivals)$/
/** The words' room on a sign's board: SIGN_WIDTH 240 in render/entities/objects.ts less the panel's 8 px each side. */
const SIGN_ROOM = 224

/**
 * Bad line breaks in a sign as each device would show it (the game's own wrapText, with that
 * device's button pictures): a word alone on the last line, a prompt ending a line, apart from
 * what it does, or a pair of prompts parted ('{up} AND' then '{spray}' on the next line). A '\n'
 * in the text sets a break by hand. [] without the text module.
 */
function signBreaks(text, words) {
  if (!text) return []
  // What is wrong -> the devices it is wrong on, so one break on every device is one finding.
  const found = new Map()
  const note = (what, device) => found.set(what, [...(found.get(what) ?? []), device])
  try {
    for (const device of Object.keys(text.GLYPHS)) {
      text.bindGlyphs({ device, glyph: (a) => text.GLYPHS[device][a] ?? '' })
      const lines = text.wrapText(words, SIGN_ROOM, 1)
      const shown = lines.map((l) => `[${l}]`).join(' ')
      if (lines.length > 1 && !/ /.test(lines[lines.length - 1].trim())) note(`a word alone on the last line: ${shown}`, device)
      for (let i = 0; i < lines.length - 1; i++) {
        if (/\}\s*$/.test(lines[i])) note(`a button ends line ${i + 1}, apart from what it does: ${shown}`, device)
        else if (/\b(AND|OR)\s*$/.test(lines[i]) && /^\s*\{/.test(lines[i + 1])) note(`a pair of buttons parted after line ${i + 1}: ${shown}`, device)
      }
    }
  } finally {
    text.bindGlyphs(null)
  }
  return [...found].map(([what, devices]) => `${devices.join(', ')}, ${what}`)
}

/**
 * The decor props the tiles atlas offers: { names (every frame and prop name, with and without
 * 'decor_'), words (the props of meta.decor with words: true, which never mirror) }, or null
 * when there is no atlas.
 */
function decorInfo() {
  const file = path.join(ASSETS_DIR, 'tiles.atlas.ts')
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const names = new Set(text.match(/\bdecor_[A-Za-z0-9_]+/g) ?? [])
  const words = new Set()
  const at = text.indexOf('decor: {')
  if (at >= 0) {
    let depth = 0
    let i = at + 'decor: '.length
    const start = i
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}' && --depth === 0) break
    }
    const body = text.slice(start + 1, i)
    let d = 0
    let prop = null
    for (const m of body.matchAll(/[{}]|['"]?([A-Za-z0-9_]+)['"]?\s*:\s*(true\b)?/g)) {
      if (m[0] === '{') d++
      else if (m[0] === '}') d--
      else if (d === 0) {
        prop = m[1]
        names.add(prop)
        names.add('decor_' + prop)
      } else if (d === 1 && m[1] === 'words' && m[2] && prop) words.add(prop)
    }
  }
  return { names, words }
}

/** Lint one level. game: { sim, contract, meta (LEVEL_META, optional) }. Returns { level, out: [{ sev, where, text }], shipping }. */
export function lintLevel(game, entry, opts = {}) {
  const { sim, contract } = game
  const { TILE } = contract
  const level = entry.level
  const shipping = opts.strict || SHIPPING.test(level.id)
  const out = []
  const say = (sev, where, text) => out.push({ sev, where, text })
  const at = (area, col, row) => `${area} ${col},${row}`
  // A shipping level's own rules are only advice in a test room.
  const ship = shipping ? 'error' : 'warn'

  const report = sim.validateLevel(level)
  // What the checks below say again, with the place, is left out here.
  const restated = /tokens in the level, expected 3|'@' start|ragged rows|no goal or secretExit|has no registered behaviour|props\.to '.*' points at|the tile above it is solid/
  for (const e of report.errors) if (!restated.test(e)) say('error', 'validator', e)
  for (const w of report.warnings) if (!restated.test(w)) say('warn', 'validator', w)
  if (!level.areas?.length) return { level, out, shipping }

  // Rows, starts, legend.
  let starts = []
  for (const [ai, def] of level.areas.entries()) {
    const width = Math.max(...def.rows.map((r) => r.length))
    def.rows.forEach((row, y) => {
      if (row.length !== width) say('error', at(def.id, row.length, y), `row ${y} is ${row.length} wide, the widest row is ${width}: every row of an area must be the same length`)
    })
    const used = new Set(def.rows.join(''))
    for (const ch of Object.keys(def.legend ?? {})) {
      if (!used.has(ch)) say('warn', def.id, `legend '${ch}' (${def.legend[ch]?.kind}) is never used in the rows`)
    }
    def.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== '@' || (def.legend && Object.hasOwn(def.legend, '@'))) continue
        starts.push({ area: def.id, ai, x, y })
      }
    })
  }
  if (starts.length !== 1) {
    say('error', starts.length ? at(starts[1]?.area ?? starts[0].area, starts[1]?.x ?? starts[0].x, starts[1]?.y ?? starts[0].y) : level.areas[0].id, `${starts.length} '@' starts in the level: there must be exactly one, in the first area`)
  } else if (starts[0].ai !== 0) {
    say('error', at(starts[0].area, starts[0].x, starts[0].y), `the '@' start is in area '${starts[0].area}', but a level starts in its first area ('${level.areas[0].id}'); this one is ignored`)
  }
  const start = starts.find((s) => s.ai === 0) ?? null

  let world
  try {
    world = buildWorld(sim, level)
  } catch (err) {
    say('error', 'build', `the level does not load: ${err.message}`)
    return { level, out, shipping }
  }

  const spawns = []
  for (const def of level.areas) {
    const st = world.areas[def.id]
    if (!st) continue
    st.spawns.forEach((sp, slot) => spawns.push({ area: def.id, sp, slot, st, ent: st.entities?.find((e) => e.slot === slot) ?? null }))
  }
  const kindAt = (kind) => spawns.filter((s) => s.sp.spec.kind === kind)
  const flagsAt = (st, c, r) => (c < 0 || r < 0 || c >= st.grid.w || r >= st.grid.h ? 0 : sim.TILE_FLAGS[st.grid.t[r * st.grid.w + c]])
  const tileCh = (st, c, r) => (c < 0 || r < 0 || c >= st.grid.w || r >= st.grid.h ? ' ' : String.fromCharCode(st.grid.t[r * st.grid.w + c]))
  const SOLID = sim.T_SOLID
  const STAND = sim.T_SOLID | sim.T_ONEWAY

  // Exits, tokens, checkpoints, the clock. Mudzilla completes MW08 itself, so it is an exit (as validateLevel counts it).
  const exits = spawns.filter((s) => s.sp.spec.kind === 'goal' || s.sp.spec.kind === 'secretExit' || s.sp.spec.kind === 'mudzilla')
  if (!exits.length) say('error', level.id, 'no goal, no secretExit and no mudzilla: the level cannot be finished')
  const tokens = kindAt('token')
  if (tokens.length !== 3) say(ship, level.id, `${tokens.length} tokens in the level; a level hides exactly three`)
  const idx = new Map()
  for (const t of tokens) {
    const i = t.sp.spec.props?.index
    if (i === undefined) continue
    if (typeof i !== 'number' || i < 0 || i > 2) say('error', at(t.area, t.sp.tx, t.sp.ty), `token props.index ${JSON.stringify(i)}: it must be 0, 1 or 2`)
    else if (idx.has(i)) say('error', at(t.area, t.sp.tx, t.sp.ty), `token props.index ${i} is used twice (also at ${idx.get(i)})`)
    else idx.set(i, at(t.area, t.sp.tx, t.sp.ty))
  }
  const length = level.areas.filter((a) => a.theme !== 'bonus').reduce((n, a) => n + Math.max(...a.rows.map((r) => r.length)), 0)
  const cps = kindAt('checkpoint')
  if (length > 120 && !cps.length) say(ship, level.id, `${length} tiles long and no checkpoint: put one just past the middle`)
  const flatOut = (length * TILE) / sim.TUNING.runSpeed
  const perTile = level.time / length
  if (level.time < flatOut * 1.5) say('error', level.id, `the clock (${level.time} s) is under 1.5 times a flat-out run of ${length} tiles (${flatOut.toFixed(0)} s)`)
  else if (perTile < 1) say(ship, level.id, `the clock gives ${perTile.toFixed(2)} s a tile (${level.time} s for ${length} tiles): under 1 s a tile is tight for a careful player`)
  else if (shipping && perTile > 3) say('warn', level.id, `the clock gives ${perTile.toFixed(2)} s a tile (${level.time} s for ${length} tiles): over 3 s a tile it never matters`)
  const meta = game.meta?.find((m) => m.id === level.id)
  if (meta && meta.time !== level.time) say('warn', level.id, `time ${level.time} s, but levels/meta.ts says ${meta.time} s (the map shows that one)`)
  if (shipping && /[a-z]/.test(level.name ?? '')) say('warn', level.id, `name '${level.name}' has lower case: the font only has capitals`)
  // The game opens a level only from where levels/index.ts looks: say so before the map shows COMING SOON.
  if (entry.served === false) {
    // A draft checked from elsewhere is not in the game yet, and that is only advice.
    const rel = entry.file ? path.relative(path.join(GAME_DIR, 'game', 'levels'), entry.file) : '..'
    const inLevels = !rel.startsWith('..') && !path.isAbsolute(rel)
    const where = SHIPPING.test(level.id)
      ? `levels/index.ts loads a main level from levels/${level.id}.ts (mw01.ts .. mw08.ts, rivals.ts), as that file's default export, for an id levels/meta.ts lists`
      : `levels/index.ts loads a test room as the default export of a file in levels/dev/`
    say(inLevels ? 'error' : 'warn', level.id, `the game does not open this level by its id: ${where}${entry.file ? ` (this one is in ${path.relative(REPO, entry.file)})` : ''}`)
  }

  // Kinds.
  const missing = new Map()
  for (const s of spawns) {
    const k = s.sp.spec.kind
    if (k !== 'start' && !sim.hasBehavior(k) && !missing.has(k)) missing.set(k, at(s.area, s.sp.tx, s.sp.ty))
  }
  for (const [k, where] of missing) say('warn', where, `kind '${k}' is not registered (yet): it is skipped when the level runs`)

  // Warps: every target resolves, every area can be entered, none is a dead end.
  const areaIds = level.areas.map((a) => a.id)
  const links = new Map(areaIds.map((id) => [id, new Set()]))
  const targeted = new Set()
  for (const s of spawns) {
    const { kind, props } = s.sp.spec
    if (kind !== 'pipe' && kind !== 'door') continue
    const to = props?.to
    if (typeof to !== 'string' || !to) continue
    const { area, marker } = sim.parseTarget(to, s.area)
    targeted.add(`${area}:${marker}`)
    const dest = world.areas[area]
    if (!dest) say('error', at(s.area, s.sp.tx, s.sp.ty), `${kind} leads to '${to}': there is no area '${area}'`)
    else if (!sim.findMarker(dest, marker)) say('error', at(s.area, s.sp.tx, s.sp.ty), `${kind} leads to '${to}': area '${area}' has nothing named '${marker}' (a marker, pipe or door with props.name)`)
    else links.get(s.area)?.add(area)
    if (kind === 'pipe') {
      const span = sim.pipeSpan({ grid: s.st.grid }, s.sp.tx, s.sp.ty + 1)
      if (span && span.w !== 2 * TILE) say('warn', at(s.area, s.sp.tx, s.sp.ty), `the pipe under it is ${span.w / TILE} tiles wide; pipes are drawn two tiles wide`)
    }
  }
  for (const s of spawns) {
    const name = s.sp.spec.props?.name
    if (s.sp.spec.kind === 'marker' && typeof name === 'string' && !targeted.has(`${s.area}:${name}`)) say('warn', at(s.area, s.sp.tx, s.sp.ty), `marker '${name}' is never the end of a pipe or door`)
  }
  const seenAreas = new Set([areaIds[0]])
  const queue = [areaIds[0]]
  while (queue.length) for (const to of links.get(queue.shift()) ?? []) if (!seenAreas.has(to)) (seenAreas.add(to), queue.push(to))
  // A test room may keep a bench area that only the viewer opens: there it is advice.
  for (const id of areaIds) {
    if (!seenAreas.has(id)) say(ship, id, `area '${id}' cannot be entered: no pipe or door from the first area's side of the level leads there`)
    else if (id !== areaIds[0] && !(links.get(id)?.size) && !exits.some((e) => e.area === id)) say(ship, id, `area '${id}' is a dead end: no pipe or door leads out of it and it has no exit`)
  }
  // Where Maxx appears (the start, a checkpoint, a marker, a named pipe or door): all of him must be
  // in the open, with ground under him.
  const MW = contract.MAXX_W
  const MH = contract.MAXX_H
  for (const s of spawns) {
    const { kind, props } = s.sp.spec
    const arrival = kind === 'start' || kind === 'checkpoint' || kind === 'marker' || ((kind === 'pipe' || kind === 'door') && typeof props?.name === 'string')
    if (!arrival) continue
    const where = at(s.area, s.sp.tx, s.sp.ty)
    const what = kind === 'start' ? "the '@' start" : kind === 'checkpoint' ? 'the checkpoint' : `${kind} '${props?.name ?? ''}'`
    const x0 = sim.tileFeetX(s.sp.tx) - MW / 2
    const y1 = sim.tileFeetY(s.sp.ty)
    const c0 = Math.floor((x0 + 0.01) / TILE)
    const c1 = Math.floor((x0 + MW - 0.01) / TILE)
    let inside = null
    for (let r = Math.floor((y1 - MH + 0.01) / TILE); r <= s.sp.ty && !inside; r++) for (let c = c0; c <= c1 && !inside; c++) if (flagsAt(s.st, c, r) & SOLID) inside = [c, r]
    if (inside) {
      say('error', where, `${what}: Maxx (2 tiles tall) would appear inside the solid '${tileCh(s.st, ...inside)}' at ${inside[0]},${inside[1]} and be stuck; give him two open cells`)
      continue
    }
    let drop = null
    let hazard = false
    for (let r = s.sp.ty + 1; r < s.st.grid.h && drop === null && !hazard; r++) {
      for (let c = c0; c <= c1; c++) {
        const f = flagsAt(s.st, c, r)
        if (f & STAND) drop = r - s.sp.ty - 1
        else if (f & sim.T_HAZARD && c === s.sp.tx) hazard = true
      }
    }
    const lifts = s.st.entities?.some((e) => e.solid !== 'none' && e.x < x0 + MW && e.x + e.w > x0 && e.y >= y1)
    if (drop === null && !lifts) say('error', where, `${what}: nothing under it${hazard ? ' but sludge or spikes' : ''}; Maxx falls ${hazard ? 'into it' : 'out of the area'} as he appears`)
    else if (drop !== null && drop >= 3 && !lifts) say('warn', where, `${what}: the ground is ${drop} tiles below it; Maxx drops onto it as he appears`)
  }

  // Decor and signs.
  const decor = decorInfo()
  for (const s of kindAt('decor')) {
    const sprite = s.sp.spec.props?.sprite
    const where = at(s.area, s.sp.tx, s.sp.ty)
    if (typeof sprite !== 'string' || !sprite) say('warn', where, 'decor without props.sprite draws nothing')
    else if (decor) {
      const name = sprite.replace(/^tiles\//, '')
      if (!decor.names.has(name) && !decor.names.has(name + '0')) {
        const hint = decor.names.has('decor_' + name) ? ` (did you mean 'decor_${name}'?)` : ''
        say('warn', where, `decor sprite '${sprite}' is not in the tiles atlas${hint}`)
      }
      // A prop with words is never drawn mirrored (it would read backwards), so its flip does nothing.
      const prop = name.replace(/^decor_/, '')
      if (s.sp.spec.props?.flip && decor.words.has(prop)) {
        const other = decor.words.has(prop + '_left') ? ` (for one facing the other way use 'decor_${prop}_left')` : ''
        say('warn', where, `decor '${prop}' has words, which are never mirrored: its flip does nothing${other}`)
      }
    }
  }
  for (const s of kindAt('sign')) {
    const where = at(s.area, s.sp.tx, s.sp.ty)
    const text = s.sp.spec.props?.text
    if (typeof text !== 'string' || !text.trim()) {
      say('warn', where, 'sign without props.text')
      continue
    }
    if (/[–—―]/.test(text)) say('error', where, `sign text has a long dash: write a period, colon or comma ("${text}")`)
    // A '\n' is a line break set by hand, not a character to draw.
    const plain = text.replace(/\{[^}]*\}/g, '').replace(/\n/g, ' ')
    if (/[a-z]/.test(plain)) say('warn', where, `sign text has lower case; the font only has capitals ("${text}")`)
    const bad = [...new Set([...plain.toUpperCase()].filter((c) => !FONT.has(c) && !/[–—―]/.test(c)))]
    if (bad.length) say('error', where, `sign text has characters the font cannot draw: ${bad.map((c) => `'${c}'`).join(' ')} ("${text}")`)
    for (const m of text.matchAll(/\{([^}]*)\}/g)) {
      const tok = m[1].toLowerCase()
      if (ACTION_TOKENS.includes(tok) || SYMBOL_TOKENS.includes(tok)) continue
      if (/^(pad|key|touch)_/.test(tok)) say('warn', where, `{${m[1]}} shows that button whatever the device; {jump}, {spray}, {up} ... follow the controller in use`)
      else say('error', where, `{${m[1]}} is not a prompt: it is drawn as written, braces and all (known: ${ACTION_TOKENS.map((t) => `{${t}}`).join(' ')})`)
    }
    if (text.length > 70) say('warn', where, `sign text is ${text.length} characters: keep it short`)
    for (const b of signBreaks(game.text, text)) say('warn', where, `sign breaks badly on ${b}: set the break with '\\n'`)
  }

  // Boxes inside walls, cars, prize blocks, pits.
  for (const s of spawns) {
    const e = s.ent
    if (!e || !(e.w > 0) || !(e.h > 0) || e.kind === 'pipe') continue
    const c0 = Math.floor((e.x + 0.01) / TILE)
    const c1 = Math.floor((e.x + e.w - 0.01) / TILE)
    const r0 = Math.floor((e.y + 0.01) / TILE)
    const r1 = Math.floor((e.y + e.h - 0.01) / TILE)
    let hit = null
    for (let r = r0; r <= r1 && !hit; r++) for (let c = c0; c <= c1 && !hit; c++) if (flagsAt(s.st, c, r) & SOLID) hit = [c, r]
    if (!hit) continue
    const beh = sim.getBehavior(e.kind)
    const picked = beh?.onTouch && !e.harmful && e.solid === 'none'
    // Stuck for real: something that moves through tiles, or something Maxx must touch. A fixed thing overlapping a wall only looks wrong.
    const stuck = e.collides || picked
    const inside = hit[0] === s.sp.tx && hit[1] === s.sp.ty ? 'is inside' : 'sticks into'
    const size = typeof s.sp.spec.props?.h === 'number' || typeof s.sp.spec.props?.w === 'number' ? '' : ' (check its props.w / props.h)'
    say(stuck ? 'error' : 'warn', at(s.area, s.sp.tx, s.sp.ty), `${e.kind}${e.variant ? ' ' + e.variant : ''} (${e.w}x${e.h}) ${inside} the solid '${tileCh(s.st, hit[0], hit[1])}' at ${hit[0]},${hit[1]}${stuck ? '' : size}`)
  }
  const startTx = start ? start.x : null
  for (const s of spawns) {
    const k = s.sp.spec.kind
    if (k !== 'car' && k !== 'spawner') continue
    const where = at(s.area, s.sp.tx, s.sp.ty)
    if (start && s.area === start.area && Math.abs(s.sp.tx - startTx) <= 10) say(ship, where, `a ${k === 'car' ? 'car' : 'car spawner'} ${Math.abs(s.sp.tx - startTx)} tiles from the start: give Maxx more than 10 tiles before the first car`)
    if (k !== 'car' || !s.ent) continue
    const e = s.ent
    const row = Math.round((e.y + e.h) / TILE)
    let under = false
    for (let c = Math.floor(e.x / TILE); c <= Math.floor((e.x + e.w - 0.01) / TILE); c++) if (flagsAt(s.st, c, row) & STAND) under = true
    if (!under) say('error', where, `the ${e.variant} has nothing under its wheels (row ${row}): it falls`)
  }
  for (const def of level.areas) {
    const st = world.areas[def.id]
    if (!st) continue
    const g = st.grid
    for (let r = 0; r < g.h; r++) {
      for (let c = 0; c < g.w; c++) {
        const ch = tileCh(st, c, r)
        if ('!WLh?CH'.includes(ch) && ch !== ' ' && flagsAt(st, c, r - 1) & SOLID) {
          const prize = '!WLh'.includes(ch)
          say(prize ? 'error' : 'warn', at(def.id, c, r), prize ? `'${ch}' has the solid '${tileCh(st, c, r - 1)}' right on top: its prize would come out inside it` : `'${ch}' has the solid '${tileCh(st, c, r - 1)}' right on top: its coin pops into the block`)
        }
      }
    }
    // One-tile pits: open column between two floors of the same height, nothing to land on below.
    for (let r = 1; r < g.h; r++) {
      for (let c = 1; c < g.w - 1; c++) {
        const f = flagsAt(st, c, r)
        if (f & STAND || !(flagsAt(st, c - 1, r) & STAND) || !(flagsAt(st, c + 1, r) & STAND)) continue
        if (flagsAt(st, c - 1, r - 1) & SOLID || flagsAt(st, c + 1, r - 1) & SOLID || flagsAt(st, c, r - 1) & SOLID) continue
        let deadly = true
        for (let y = r; y < g.h; y++) {
          const fy = flagsAt(st, c, y)
          if (fy & sim.T_HAZARD) break
          if (fy & STAND) {
            deadly = false
            break
          }
        }
        if (deadly) say('warn', at(def.id, c, r), 'a pit one tile wide: a running Maxx crosses it without jumping (NOTES.md), so it traps nobody; only a slow walk drops in. Two tiles wide needs a jump')
      }
    }
  }
  return { level, out, shipping }
}

function printLint(res) {
  const { level, out, shipping } = res
  const errors = out.filter((m) => m.sev === 'error').length
  const warns = out.length - errors
  console.log(`LINT ${level.id} "${level.name}" (${level.areas?.length ?? 0} areas${shipping ? '' : ', test room: the rules of a shipping level are warnings'})`)
  for (const m of out) console.log(`  ${m.sev === 'error' ? 'ERROR' : 'warn '}  ${m.where.padEnd(16)} ${m.text}`)
  console.log(`  ${level.id}: ${errors} error${errors === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}\n`)
  return errors
}

/* ------------------------------------------------------------------ */
/* Reach                                                               */
/* ------------------------------------------------------------------ */

const sec = (ticks) => `${(ticks / 60).toFixed(1)} s`

function coord(r, key) {
  const n = r.nodes.get(key)
  if (!n) return key
  if (n.kind === 'mover') return `${n.area} on the ${n.mover?.kind ?? 'platform'} at col ${n.col}`
  return n.row !== null ? `${n.area} ${n.col},${n.row}` : `${n.area} col ${n.col} on a roof at y ${n.feetY}`
}

function edgeWords(r, e) {
  const how = describeMacro(e.macro).replace('jump at the lip', e.res?.why === 'wall' ? 'jump at the wall' : 'jump at the lip')
  const lift = e.offset === 'left' || e.offset === 'mid' || e.offset === 'right' ? ` (from the ${e.offset === 'mid' ? 'middle' : e.offset + ' end'} of the platform)` : ''
  const shift = e.macro.fine && typeof e.offset === 'number' && e.offset ? `, starting ${Math.abs(e.offset)} px further back` : ''
  return how + lift + shift
}


/** Minimal extra modes (in the fixed order grime, gates, cars, hidden) under which `test(graph)` holds, or null. */
export function neededModes(r, base, test) {
  if (test(r.graph(base))) return base
  const free = [MODE.GRIME, MODE.GATES, MODE.CARS, MODE.HIDDEN].filter((b) => !(base & b))
  const subsets = []
  for (let s = 1; s < 1 << free.length; s++) {
    let m = 0
    free.forEach((b, i) => {
      if (s & (1 << i)) m |= b
    })
    subsets.push(m)
  }
  subsets.sort((a, b) => popcount(a) - popcount(b) || a - b)
  for (const m of subsets) if (test(r.graph(base | m))) return base | m
  return null
}
const popcount = (m) => [1, 2, 4, 8].filter((b) => m & b).length

function reachedTarget(r, g, t) {
  if (t.type === 'goal' || t.type === 'secret') return g.exits.some((e) => e.exit === t.type)
  if (t.type === 'pipe' || t.type === 'door') return warpWorks(r, g, t) !== null
  return g.touched.has(t.id)
}
/** Where a pipe or door took him in this graph: the destination node key, or null if never used. */
function warpWorks(r, g, t) {
  for (const list of g.edges.values()) {
    for (const e of list) {
      if (e.macro.id !== t.type || !e.from.startsWith(t.area + '|')) continue
      const n = r.nodes.get(e.from)
      const info = r.areaInfo.get(t.area)
      const box = (t.type === 'pipe' ? info.pipes : info.doors).find((p) => p.slot === t.slot)
      const cx = n.x + 11
      if (box && cx >= box.x - 2 && cx <= box.x + box.w + 2) return e.to
    }
  }
  return null
}

/** The route to `what` as moves (plain runs along one floor merged), with each jump's take-off window. */
function routeText(r, g, what, lines, opts = {}) {
  const route = r.routeTo(g, what)
  if (!route) return null
  const floor = (key) => {
    const n = r.nodes.get(key)
    return n && n.kind === 'tile' ? `${n.area}|${n.feetY}` : null
  }
  const moves = []
  for (const e of route.steps) {
    e.window = r.windowOf(g, e)
    const from = r.nodes.get(e.from)
    const to = e.to ? r.nodes.get(e.to) : null
    // Staying on the same moving platform from one moment of its cycle to the next is a ride, whatever the feet did.
    const ride = from?.kind === 'mover' && to?.kind === 'mover' && from.slot === to.slot ? from.mover?.kind ?? 'platform' : null
    const plain = !ride && !e.window && e.to && floor(e.from) !== null && (e.macro.ground === 'run' || e.macro.ground === 'step') && !e.res.airborne && floor(e.from) === floor(e.to)
    const prev = moves[moves.length - 1]
    if ((plain && prev?.plain && prev.d === e.macro.d && floor(prev.last.to) === floor(e.from)) || (ride && prev?.ride === ride && prev.last.to === e.from)) {
      prev.steps.push(e)
      prev.last = e
    } else moves.push({ plain, ride, d: e.macro.d, steps: [e], last: e })
  }
  let hardest = null
  const tight = []
  const hovers = []
  moves.forEach((m, i) => {
    const e = m.steps[0]
    const w = e.window
    if (!w) return
    if (w.works !== null && (!hardest || w.works < hardest.w.works)) hardest = { i, e, w }
    if ((w.works !== null && w.works < 4) || w.fine) tight.push({ i, e, w })
    if (w.needsHover) hovers.push({ i, e, w })
  })
  if (lines) {
    lines.push(`  ROUTE to ${opts.label ?? what}: ${moves.length} moves, ${route.ticks} ticks = ${sec(route.ticks)} (each move from rest to rest, so a flowing run is quicker)`)
    moves.forEach((m, i) => {
      const e = m.last
      const first = m.steps[0]
      const to = e.exit ? (e.exit === 'goal' ? 'the goal' : 'the secret exit') : e.to ? coord(r, e.to) : 'touches it on the way'
      const ticks = m.steps.reduce((n, s) => n + s.ticks, 0)
      const wait = m.steps.reduce((n, s) => n + s.cost - s.ticks, 0)
      const fw = first.window
      const w = fw ? `  ${fw.works === null ? '(off a moving platform)' : `window ${fw.works}/${fw.tried}${fw.works < 4 || fw.fine ? ' TOO TIGHT' : ''}`}${fw.fine ? ' (PIXEL-EXACT: one run-up to the pixel and one hover start)' : ''}${hoverFlag(fw)}` : ''
      const how = m.ride ? `ride the ${m.ride}` : m.plain ? `run ${m.d > 0 ? 'right' : 'left'} along the floor` : edgeWords(r, first)
      const first2 = [...new Set(m.steps.flatMap((s) => r.needsBricks(s)))].map((id) => `the brick at ${id.replace('@', ' ')}`)
      const setter = (flag) => r.targets.filter((x) => x.sets?.flag === flag).map((x) => `the ${x.kind} at ${x.area} ${x.tx},${x.ty}`)[0]
      const flags = [...new Set(m.steps.flatMap((s) => r.needsFlags(s).map((f) => `flag '${f.flag}' for ${f.what}${setter(f.flag) ? ` (${setter(f.flag)} sets it)` : ''}`)))]
      const before = [...first2.map((b) => `${b} broken`), ...flags.map((f) => `${f} set`)]
      lines.push(`    ${String(i + 1).padStart(3)}  ${coord(r, first.from).padEnd(18)} ${how} -> ${to}  ${ticks} ticks${wait ? ` (+${wait} waiting for the platform to come round)` : ''}${w}${before.length ? `  [first: ${before.join('; ')}]` : ''}`)
    })
    if (hardest) lines.push(`    hardest jump: move ${hardest.i + 1}, ${edgeWords(r, hardest.e)} from ${coord(r, hardest.e.from)}: works on ${hardest.w.works} of ${hardest.w.tried} ${hardest.w.unit}`)
    lines.push(`    too tight (under 4, or pixel-exact): ${tight.length ? tight.map((t) => `move ${t.i + 1} (${t.w.fine ? 'pixel-exact' : `${t.w.works}/${t.w.tried}`})`).join(', ') : 'none'}`)
    lines.push(`    needs the hover: ${hovers.length ? hovers.map((t) => `move ${t.i + 1}, ${coord(r, t.e.from)}${hoverHow(t.e, t.w)}`).join('; ') : 'none'}`)
  }
  return { route, hardest, tight, hovers }
}
/** ' NEEDS HOVER', ' NEEDS LATE HOVER' (only a hold begun after the top), ' NEEDS PULSED HOVER' (only tapping it, which the sim says never beats a hold), or ''. */
const hoverFlag = (w) => (w.needsPulse ? ' NEEDS PULSED HOVER' : w.needsLate ? ' NEEDS LATE HOVER' : w.needsHover ? ' NEEDS HOVER' : '')
function hoverHow(e, w) {
  if (w.needsPulse) return ' (only tapped: tapping {spray} with {down} held; tapping should never beat holding, so tell the tools owner)'
  if (w.needsLate) return ` (begun late: {down} + {spray} held from ${typeof e.macro.hover === 'number' ? e.macro.hover : 'some'} ticks after the top of the jump)`
  return ''
}

function printArea(r, g, gAll, areaId, opts, routeNodes) {
  const info = r.areaInfo.get(areaId)
  const def = r.level.areas.find((a) => a.id === areaId)
  const marks = new Map()
  const spotList = [...r.spots(areaId, g.mode), ...r.spots(areaId, gAll.mode)]
  for (const s of spotList) {
    const key = `${areaId}|${s.col}|${s.feetY}`
    const k = `${s.col},${s.row}`
    const m = g.reached.has(key) ? '.' : gAll.reached.has(key) ? ':' : 'x'
    const prev = marks.get(k)
    if (!prev || (prev === 'x' && m !== 'x') || (prev === ':' && m === '.')) marks.set(k, m)
  }
  for (const key of routeNodes) {
    const n = r.nodes.get(key)
    if (n && n.area === areaId && n.row !== null) marks.set(`${n.col},${n.row}`, '+')
  }
  let [c0, c1] = [0, info.w - 1]
  if (typeof opts.cols === 'string') {
    const m = opts.cols.match(/^(\d+)(?:-(\d+))?$/)
    if (m) [c0, c1] = [Number(m[1]), Math.min(info.w - 1, Number(m[2] ?? m[1]))]
  }
  const width = Number(opts.width) > 0 ? Number(opts.width) : 100
  const reachedHere = [...g.reached].filter((k) => k.startsWith(areaId + '|')).length
  console.log(`AREA ${areaId}  ${info.w} x ${info.h}, ${reachedHere} standing places reached`)
  for (let b = c0; b <= c1; b += width) {
    const e = Math.min(c1, b + width - 1)
    let tens = ''
    let ones = ''
    for (let c = b; c <= e; c++) {
      tens += c % 10 === 0 ? String(Math.floor(c / 10) % 10) : ' '
      ones += String(c % 10)
    }
    console.log(`      ${tens}\n      ${ones}`)
    for (let y = 0; y < info.h; y++) {
      let line = ''
      const row = def.rows[y] ?? ''
      for (let c = b; c <= e; c++) {
        const ch = row[c] ?? ' '
        line += ch === ' ' ? marks.get(`${c},${y}`) ?? ' ' : ch
      }
      console.log(`  ${String(y).padStart(3)} ${line}`)
    }
    console.log('')
  }
}

async function cmdReach(game, entry, flags) {
  const { sim, contract } = game
  const level = entry.level
  const mode = modeFromFlags(flags)
  const hover = hoverFromFlags(flags) ?? 'all'
  const t0 = performance.now()
  const r = createReach(sim, contract, level, { hover })
  const g = r.graph(mode)
  const gAll = r.graph(mode | ALL_MODES)
  const lines = []
  const ms = performance.now() - t0
  console.log(`REACH ${level.id} "${level.name}"   mode: ${modeName(mode)}; ${HOVER_NAMES[hover]}`)
  console.log(`  ${g.reached.size} standing places reached (${gAll.reached.size} with everything open); ${r.stats.runs} macro runs, ${(r.stats.ticks / 1e6).toFixed(2)}M ticks, ${(ms / 1000).toFixed(1)} s`)
  console.log(`  map: . reachable   : reachable only with more modes (gates, grime, car roofs, hidden)   x a top he could stand on but never reaches   + cheapest route to the goal\n`)
  if (!g.start) console.log('  Maxx never comes to rest at the start: no standing place to start from.\n')

  const goalRoute = routeText(r, g, 'goal', lines, { label: 'the goal' })
  const routeNodes = new Set(goalRoute ? goalRoute.route.steps.flatMap((e) => [e.from, e.to]).filter(Boolean) : [])
  if (!flags['no-map']) for (const id of r.areaIds) if (!flags.area || flags.area === id) printArea(r, g, gAll, id, flags, routeNodes)

  console.log('SUMMARY')
  const exitLine = (type, label) => {
    const has = r.targets.some((t) => t.type === type)
    if (!has) return console.log(`  ${label.padEnd(12)} none in the level`)
    const route = r.routeTo(g, type)
    if (route) return console.log(`  ${label.padEnd(12)} REACHED   cheapest ${route.ticks} ticks = ${sec(route.ticks)} (clock ${level.time} s)`)
    const need = neededModes(r, mode, (gg) => gg.exits.some((e) => e.exit === type))
    console.log(`  ${label.padEnd(12)} ${need === null ? 'UNREACHABLE, even with everything open' : `needs ${modeDelta(need, mode)}`}`)
  }
  exitLine('goal', 'goal')
  exitLine('secret', 'secret exit')
  const tokens = r.targets.filter((t) => t.kind === 'token').sort((a, b) => a.token - b.token)
  for (const t of tokens) {
    const where = `${t.area} ${t.tx},${t.ty}`
    const route = r.routeTo(g, t.id)
    if (route) {
      console.log(`  token ${t.token + 1}      ${where.padEnd(14)} reached, ${route.ticks} ticks = ${sec(route.ticks)}`)
      continue
    }
    const need = neededModes(r, mode, (gg) => gg.touched.has(t.id))
    const dying = g.fatal.has(t.id) ? '; touched only on a jump that ends in a grime' : ''
    console.log(`  token ${t.token + 1}      ${where.padEnd(14)} ${need === null ? 'UNREACHABLE, even with everything open' : `needs ${modeDelta(need, mode)}`}${dying}`)
  }
  const groups = new Map()
  for (const t of r.targets) {
    if (t.type !== 'touch' || t.kind === 'token') continue
    const k = t.kind
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(t)
  }
  for (const [k, list] of groups) {
    const missed = list.filter((t) => !g.touched.has(t.id))
    const label = k === 'coin' ? 'coins' : k === 'checkpoint' ? 'checkpoints' : k
    const where = (t) => `${t.area} ${t.tx},${t.ty}${gAll.touched.has(t.id) ? ' (needs a mode)' : g.fatal.has(t.id) ? ' (only by dying)' : ''}`
    console.log(`  ${label.padEnd(12)} ${list.length - missed.length} of ${list.length} reached${missed.length ? `; missed: ${missed.slice(0, 12).map(where).join('; ')}${missed.length > 12 ? ` and ${missed.length - 12} more` : ''}` : ''}`)
  }
  const blocks = [...r.areaInfo.values()].flatMap((i) => i.blocks)
  if (blocks.length) {
    const missed = blocks.filter((b) => !g.bumped.has(b.id))
    console.log(`  blocks       ${blocks.length - missed.length} of ${blocks.length} bumped${missed.length ? `; never bumped: ${missed.slice(0, 12).map((b) => `'${b.ch}' ${b.area} ${b.tx},${b.ty}${gAll.bumped.has(b.id) ? ' (needs a mode)' : ''}`).join('; ')}${missed.length > 12 ? ` and ${missed.length - 12} more` : ''}` : ''}`)
  }
  // Gates and locked doors: what opens each, and whether Maxx can get to it. The map treats them
  // as shut or open (--gates); a button he can reach opens its gate in play.
  const setters = new Map()
  for (const def of level.areas) {
    for (const spec of Object.values(def.legend ?? {})) {
      const f = spec?.props?.flag
      if (typeof f === 'string' && spec.kind !== 'gate' && spec.kind !== 'door') setters.set(f, [...(setters.get(f) ?? []), spec.kind])
    }
  }
  for (const info of r.areaInfo.values()) {
    for (const b of info.gateBoxes) {
      if (b.kind === 'door' && b.slot !== undefined && info.gateBoxes.indexOf(b) !== info.gateBoxes.findIndex((x) => x.slot === b.slot)) continue
      const spec = level.areas.find((a) => a.id === b.area)
      const props = spec ? r.base(0).per.get(b.area).areas[b.area].spawns[b.slot]?.spec.props ?? {} : {}
      const flag = props.flag
      const buttons = r.targets.filter((x) => x.type === 'touch' && r.base(0).per.get(x.area).areas[x.area].spawns[x.slot]?.spec.props?.flag === flag)
      const how = buttons.length
        ? buttons.map((x) => `${x.kind} ${x.area} ${x.tx},${x.ty} (${g.touched.has(x.id) ? 'Maxx can reach it' : 'out of reach'})`).join('; ')
        : (setters.get(flag) ?? []).length
          ? `set by ${[...new Set(setters.get(flag))].join(', ')}`
          : 'set in play (a boss or rival when beaten, or a retry that keeps it)'
      console.log(`  ${b.kind.padEnd(12)} ${`${b.area} ${b.tx},${b.ty}`.padEnd(14)} opens on flag '${flag}' >= ${props.min ?? 1}: ${how}`)
    }
  }
  for (const type of ['pipe', 'door']) {
    for (const t of r.targets.filter((x) => x.type === type)) {
      const info = r.areaInfo.get(t.area)
      const box = (type === 'pipe' ? info.pipes : info.doors).find((p) => p.slot === t.slot)
      const to = warpWorks(r, g, t)
      const toAll = to ?? warpWorks(r, gAll, t)
      const state = to ? `works, comes out at ${coord(r, to)}` : toAll ? 'needs a mode to use' : box?.to ? 'never used (not reached, or locked)' : 'leads nowhere (an arrival point only)'
      console.log(`  ${type.padEnd(12)} ${`${t.area} ${t.tx},${t.ty}`.padEnd(14)} -> ${box?.to ?? '-'}: ${state}`)
    }
  }
  console.log('')
  for (const l of lines) console.log(l)
  if (g.exits.some((e) => e.exit === 'secret')) {
    const extra = []
    routeText(r, g, 'secret', extra, { label: 'the secret exit' })
    console.log('')
    for (const l of extra) console.log(l)
  }

  if (flags.json) writeJson(r, g, gAll, flags.json === true ? `${level.id}.reach.json` : flags.json, goalRoute)
  if (flags.png) await writePng(r, g, gAll, flags.png === true ? `${level.id}.reach.png` : flags.png, Number(flags.scale) || 8, routeNodes, goalRoute)
  return 0
}

function writeJson(r, g, gAll, file, goalRoute) {
  const node = (key) => {
    const n = r.nodes.get(key)
    return n.kind === 'tile' ? { key, area: n.area, kind: 'tile', col: n.col, row: n.row, feetY: n.feetY, x: n.x } : { key, area: n.area, kind: 'mover', slot: n.slot, bucket: n.k, col: n.col }
  }
  const edge = (e) => ({ from: e.from, to: e.to, exit: e.exit ?? null, macro: e.macro.id, words: describeMacro(e.macro), ticks: e.ticks, cost: e.cost, phase: e.tau, offset: e.offset ?? null, hover: !!e.hover, late: !!e.late, pulse: !!e.pulse, window: e.window ?? undefined })
  const data = {
    level: r.level.id,
    mode: g.mode,
    modeName: modeName(g.mode),
    start: g.start,
    areas: r.areaIds.map((id) => ({ id, w: r.areaInfo.get(id).w, h: r.areaInfo.get(id).h, movers: r.movers(id).list })),
    nodes: [...g.reached].map(node),
    nodesWithEverythingOpen: [...gAll.reached].filter((k) => !g.reached.has(k)).map(node),
    edges: [...g.edges.values()].flat().map(edge),
    exits: g.exits.map(edge),
    targets: r.targets.map((t) => ({ id: t.id, type: t.type, kind: t.kind, token: t.token, area: t.area, col: t.tx, row: t.ty, reached: reachedTarget(r, g, t), reachedWithEverythingOpen: reachedTarget(r, gAll, t) })),
    blocks: [...r.areaInfo.values()].flatMap((i) => i.blocks).map((b) => ({ id: b.id, ch: b.ch, bumped: g.bumped.has(b.id) })),
    routeToGoal: goalRoute ? goalRoute.route.steps.map(edge) : null,
  }
  writeFileSync(file, JSON.stringify(data, null, 1))
  console.log(`\nwrote ${path.resolve(file)}`)
}

async function writePng(r, g, gAll, file, scale, routeNodes, goalRoute) {
  const { PNG } = await import('pngjs')
  const areas = r.areaIds.map((id) => ({ id, info: r.areaInfo.get(id), def: r.level.areas.find((a) => a.id === id) }))
  const gap = 2 * scale
  const W = Math.max(...areas.map((a) => a.info.w)) * scale
  const H = areas.reduce((n, a) => n + a.info.h * scale + gap, 0)
  const png = new PNG({ width: W, height: H })
  const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = (y * W + x) * 4
    png.data[i] = c[0]
    png.data[i + 1] = c[1]
    png.data[i + 2] = c[2]
    png.data[i + 3] = 255
  }
  const rect = (x, y, w, h, c) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c)
  }
  rect(0, 0, W, H, rgb('#1b2253'))
  const TILE_COL = { '#': '#6b4522', '%': '#4b4f5c', X: '#767b8a', U: '#8a5f33', B: '#b96e23', C: '#b96e23', '?': '#109ff9', '!': '#e85aa0', W: '#f5c518', L: '#49b23c', H: '#d6dae3', h: '#d6dae3', '=': '#a9afbd', '<': '#2e3038', '>': '#2e3038', I: '#a8d8f0', O: '#16161d', M: '#4a2f17', g: '#1f7a34', '~': '#5b3fa0', '^': '#d10713', P: '#0e7c86', '|': '#dff3ff' }
  let oy = 0
  for (const a of areas) {
    rect(0, oy, W, a.info.h * scale, rgb('#1b2253'))
    rect(0, oy, a.info.w * scale, a.info.h * scale, rgb('#b9ecff'))
    a.def.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = TILE_COL[row[x]]
        if (!c) continue
        if (row[x] === '=') rect(x * scale, oy + y * scale, scale, Math.max(1, scale >> 2), rgb(c))
        else if (row[x] === 'H' || row[x] === 'h') {
          rect(x * scale, oy + y * scale, scale, 1, rgb(c))
          rect(x * scale, oy + (y + 1) * scale - 1, scale, 1, rgb(c))
        } else rect(x * scale, oy + y * scale, scale, scale, rgb(c))
      }
    })
    for (const t of a.info.targets) {
      const c = t.type === 'goal' ? '#49b23c' : t.type === 'secret' ? '#e85aa0' : t.kind === 'token' ? '#f5c518' : t.kind === 'coin' ? '#a9afbd' : t.kind === 'checkpoint' ? '#109ff9' : '#fdba74'
      const s = t.type === 'goal' || t.type === 'secret' ? scale : Math.max(2, scale >> 1)
      rect(t.tx * scale + ((scale - s) >> 1), oy + t.ty * scale + ((scale - s) >> 1), s, s, rgb(c))
    }
    // Lifts: the outline of everywhere the platform goes, white where Maxx rides it.
    const px = (v) => Math.round((v / 32) * scale)
    for (const m of r.movers(a.id).list) {
      const ridden = [...g.reached].some((k) => k.startsWith(`${a.id}|m${m.slot}|`))
      const c = rgb(ridden ? '#ffffff' : '#767b8a')
      const [x0, x1, y0, y1] = [px(m.x0), px(m.x1), oy + px(m.y0), oy + px(m.y1)]
      rect(x0, y0, x1 - x0, 1, c)
      rect(x0, y1 - 1, x1 - x0, 1, c)
      rect(x0, y0, 1, y1 - y0, c)
      rect(x1 - 1, y0, 1, y1 - y0, c)
    }
    const bar = Math.max(2, scale >> 2)
    for (const sp of [...r.spots(a.id, g.mode), ...r.spots(a.id, gAll.mode)]) {
      const key = `${a.id}|${sp.col}|${sp.feetY}`
      const c = g.reached.has(key) ? '#49b23c' : gAll.reached.has(key) ? '#f97316' : '#d10713'
      rect(sp.col * scale + 1, oy + (sp.row + 1) * scale - bar, scale - 2, bar, rgb(c))
    }
    for (const key of routeNodes) {
      const n = r.nodes.get(key)
      if (n?.area === a.id && n.row !== null) rect(n.col * scale + (scale >> 2), oy + n.row * scale + (scale >> 2), Math.max(2, scale >> 1), Math.max(2, scale >> 1), rgb('#ffffff'))
    }
    oy += a.info.h * scale + gap
  }
  void goalRoute
  writeFileSync(file, PNG.sync.write(png))
  console.log(`wrote ${path.resolve(file)}`)
}

/* ------------------------------------------------------------------ */
/* Expectations                                                        */
/* ------------------------------------------------------------------ */

/**
 * One expectation:   <reach|not|fair> <targets> [with <modes>] [unless <modes>] [within <n>s]
 * targets, comma separated: goal, secret, tokens, token1..token3, checkpoints, coins, blocks,
 * area:<id>, or standing places [area]@cols[,rows] (cols and rows: 12 or 12-20; rows are the
 * row his feet are in, where '@' would be written).
 */
export function parseExpectation(line, baseMode = 0) {
  const text = line.replace(/#.*$/, '').trim()
  if (!text) return null
  const m = text.match(/^(reach|not|fair)\s+(.+?)(?:\s+with\s+(.+?))?(?:\s+unless\s+(.+?))?(?:\s+within\s+([\d.]+)\s*(s|ticks)?)?$/i)
  if (!m) throw new Error(`cannot read '${line}': write  reach|not|fair <targets> [with <modes>] [unless <modes>] [within <n>s]`)
  const verb = m[1].toLowerCase()
  // 'hover=...' is not a mode of the world but of the player: which hovers the map tries. off: none;
  // top: held from the top of the jump (what level 2 teaches); held: also begun late; on or all: also tapped.
  let hover = null
  const withText = (m[3] ?? '').replace(/\bhover\s*[=: ]\s*(off|on|top|held|all)\b/gi, (_, v) => {
    hover = v.toLowerCase() === 'on' ? 'all' : v.toLowerCase()
    return ''
  })
  const mode = withText.replace(/[,+\s]/g, '') ? parseMode(withText, baseMode) : baseMode
  const unless = m[4] ? parseMode(m[4], mode) : null
  if (unless !== null && verb !== 'not') throw new Error(`'${line}': 'unless' goes with 'not'`)
  const within = m[5] ? Number(m[5]) * (m[6] === 'ticks' ? 1 : 60) : null
  // Commas part the targets, but '@12-20,4' keeps its own: a bare number after a spot is its row.
  const targets = []
  for (const piece of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
    const prev = targets[targets.length - 1]
    if (/^\d+(-\d+)?$/.test(piece) && prev && /@\d+(-\d+)?$/.test(prev)) targets[targets.length - 1] = `${prev},${piece}`
    else targets.push(piece)
  }
  for (const t of targets) if (!/^(goal|secret|tokens|token[123]|checkpoints|checkpoint\d+|coins|blocks|area:\S+|[\w-]*@\d+(-\d+)?(,\d+(-\d+)?)?)$/i.test(t)) throw new Error(`'${line}': unknown target '${t}'`)
  // noHover and noPulse: the old names, kept for callers that read them.
  return { line: text, verb, mode, unless, within, targets, hover, noHover: hover === 'off', noPulse: hover === 'held' }
}

/** Resolve one target name to what can be tested: { label, each: [ { label, reached(g) -> evidence|null } ], all: bool }. */
function resolveTarget(r, name) {
  const lower = name.toLowerCase()
  const route = (g, what) => r.routeTo(g, what)
  const byKind = (kind) => r.targets.filter((t) => t.kind === kind)
  const touch = (t, label) => ({ label, test: (g) => route(g, t.id) ?? (g.touched.has(t.id) ? { ticks: NaN, steps: [] } : null) })
  if (lower === 'goal' || lower === 'secret') return { all: true, items: [{ label: lower === 'goal' ? 'the goal' : 'the secret exit', test: (g) => route(g, lower) }] }
  if (lower === 'tokens') return { all: true, items: byKind('token').sort((a, b) => a.token - b.token).map((t) => touch(t, `token ${t.token + 1}`)) }
  if (/^token[123]$/.test(lower)) {
    const t = byKind('token').find((x) => x.token === Number(lower[5]) - 1)
    if (!t) throw new Error(`the level has no ${name}`)
    return { all: true, items: [touch(t, `token ${t.token + 1}`)] }
  }
  if (lower === 'checkpoints') return { all: true, items: byKind('checkpoint').map((t, i) => touch(t, `checkpoint ${i + 1} (${t.area} ${t.tx},${t.ty})`)) }
  if (/^checkpoint\d+$/.test(lower)) {
    const list = byKind('checkpoint')
    const t = list[Number(lower.slice(10)) - 1]
    if (!t) throw new Error(`the level has no ${name} (it has ${list.length})`)
    return { all: true, items: [touch(t, `${name} (${t.area} ${t.tx},${t.ty})`)] }
  }
  if (lower === 'coins') return { all: true, items: byKind('coin').map((t) => touch(t, `coin ${t.area} ${t.tx},${t.ty}`)) }
  if (lower === 'blocks') {
    const blocks = [...r.areaInfo.values()].flatMap((i) => i.blocks)
    return { all: true, items: blocks.map((b) => ({ label: `'${b.ch}' ${b.area} ${b.tx},${b.ty}`, test: (g) => route(g, b.id) })) }
  }
  if (lower.startsWith('area:')) {
    const id = name.slice(5)
    if (!r.areaInfo.has(id)) throw new Error(`no area '${id}'`)
    return { all: true, items: [{ label: `area '${id}'`, test: (g) => firstIn(r, g, (n) => n.area === id) }] }
  }
  const m = name.match(/^([\w-]*)@(\d+)(?:-(\d+))?(?:,(\d+)(?:-(\d+))?)?$/)
  const area = m[1] || r.areaIds[0]
  if (!r.areaInfo.has(area)) throw new Error(`no area '${area}' in '${name}'`)
  const c0 = Number(m[2])
  const c1 = m[3] ? Number(m[3]) : c0
  const r0 = m[4] !== undefined ? Number(m[4]) : null
  const r1 = m[5] !== undefined ? Number(m[5]) : r0
  const label = `${area} ${m[3] ? `columns ${c0}-${c1}` : `column ${c0}`}${r0 === null ? '' : m[5] ? `, rows ${r0}-${r1}` : `, row ${r0}`}`
  return { all: false, items: [{ label, test: (g) => firstIn(r, g, (n) => n.area === area && n.kind === 'tile' && n.col >= c0 && n.col <= c1 && (r0 === null || (n.row !== null && n.row >= r0 && n.row <= r1))) }] }
}
function firstIn(r, g, pred) {
  let best = null
  const { dist } = r.costs(g)
  for (const key of g.reached) {
    const n = r.nodes.get(key)
    if (!n || !pred(n)) continue
    const c = dist.get(key) ?? Infinity
    if (!best || c < best.c) best = { c, key }
  }
  return best ? { ...r.routeTo(g, best.key), node: best.key } : null
}

/**
 * Check one parsed expectation. `solver(hover)` returns the reach solver to use (createReach
 * with opts.hover: 'all' unless the line says hover=off|top|held). Returns [{ ok, text }], one
 * per thing it names.
 */
export function checkExpectation(solver, ex) {
  const r = solver(ex.hover ?? 'all')
  const results = []
  const g = r.graph(ex.mode)
  for (const name of ex.targets) {
    const { items } = resolveTarget(r, name)
    if (!items.length) {
      results.push({ ok: ex.verb === 'not', text: `${name}: the level has none` })
      continue
    }
    for (const it of items) {
      const got = it.test(g)
      const how = (ev) => {
        if (!ev || !ev.steps?.length) return ''
        const last = ev.steps[ev.steps.length - 1]
        return ` by ${edgeWords(r, last)} from ${coord(r, last.from)}${ev.node ? ` (at ${coord(r, ev.node)})` : ''}`
      }
      if (ex.verb === 'not') {
        if (got) {
          results.push({ ok: false, text: `${it.label} IS reachable with ${modeName(ex.mode)}${how(got)}` })
          continue
        }
        if (ex.unless !== null) {
          const g2 = r.graph(ex.unless)
          const got2 = it.test(g2)
          results.push(got2 ? { ok: true, text: `${it.label}: not with ${modeName(ex.mode)}; reachable with ${modeDelta(ex.unless, ex.mode)}${how(got2)}` } : { ok: false, text: `${it.label} is not reachable even with ${modeDelta(ex.unless, ex.mode)}` })
        } else results.push({ ok: true, text: `${it.label}: not reachable` })
        continue
      }
      if (!got) {
        const need = neededModes(r, ex.mode, (gg) => !!it.test(gg))
        results.push({ ok: false, text: `${it.label} is NOT reachable with ${modeName(ex.mode)}${need === null ? ', not even with everything open' : `; it needs ${modeDelta(need, ex.mode)}`}` })
        continue
      }
      let ok = true
      const notes = []
      if (Number.isFinite(got.ticks)) notes.push(`${got.ticks} ticks = ${sec(got.ticks)}`)
      if (ex.within !== null && !(got.ticks <= ex.within)) {
        ok = false
        notes.push(`over the ${sec(ex.within)} allowed`)
      }
      if (ex.verb === 'fair') {
        for (const [i, e] of (got.steps ?? []).entries()) {
          const w = r.windowOf(g, e)
          if (!w) continue
          if (w.works !== null && w.works < 4) {
            ok = false
            notes.push(`move ${i + 1} (${edgeWords(r, e)} from ${coord(r, e.from)}) works on only ${w.works} of ${w.tried} ${w.unit}`)
          } else if (w.fine) {
            ok = false
            notes.push(`move ${i + 1} (${edgeWords(r, e)} from ${coord(r, e.from)}) is pixel-exact: one run-up to the pixel and one hover start`)
          }
          if (w.needsHover) {
            ok = false
            notes.push(`move ${i + 1} (${coord(r, e.from)}) needs the ${w.needsPulse ? 'pulsed hover (tapping it)' : w.needsLate ? 'hover begun late' : 'hover'}`)
          }
        }
      }
      results.push({ ok, text: `${it.label}: ${notes.join('; ') || 'reachable'}` })
    }
  }
  return results
}

function cmdExpect(game, entry, flags) {
  const { sim, contract } = game
  const mode = modeFromFlags(flags)
  const lines = []
  const sources = []
  for (const verb of ['reach', 'not', 'fair']) for (const v of flags[verb] ?? []) for (const part of String(v).split(';')) lines.push(`${verb} ${part.trim()}`)
  if (lines.length) sources.push('the command line')
  if (flags.file) {
    for (const l of readFileSync(flags.file, 'utf8').split(/\r?\n/)) lines.push(l)
    sources.push(flags.file)
  }
  if (!lines.length && Array.isArray(entry.mod?.EXPECT)) {
    for (const l of entry.mod.EXPECT) lines.push(String(l))
    sources.push(`EXPECT in ${path.relative(REPO, entry.file)}`)
  }
  if (!lines.length) {
    console.error(`no expectations: give --reach/--not/--fair, --file, or export const EXPECT: string[] from the level's module`)
    return 2
  }
  const list = []
  for (const l of lines) {
    try {
      const ex = parseExpectation(l, mode)
      if (ex) list.push(ex)
    } catch (err) {
      console.error(err.message)
      return 2
    }
  }
  const solvers = new Map()
  const solver = (hover) => {
    if (!solvers.has(hover)) solvers.set(hover, createReach(sim, contract, entry.level, { hover }))
    return solvers.get(hover)
  }
  const forced = hoverFromFlags(flags)
  // For every line that does not name its own hover.
  if (forced) for (const ex of list) ex.hover ??= forced
  console.log(`EXPECT ${entry.level.id}: ${list.length} expectation${list.length === 1 ? '' : 's'} from ${sources.join(' and ')}`)
  let failed = 0
  let passed = 0
  for (const ex of list) {
    const res = checkExpectation(solver, ex)
    const ok = res.every((x) => x.ok)
    if (ok) passed++
    else failed++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${ex.line}${forced && !/hover/i.test(ex.line) ? `  (${HOVER_NAMES[forced]})` : ''}`)
    const shown = flags.verbose || res.length <= 4 ? res : res.filter((x) => !x.ok)
    for (const x of shown) console.log(`          ${res.length > 1 ? (x.ok ? 'ok  ' : 'NO  ') : ''}${x.text}`)
    if (shown.length < res.length) console.log(`          (${res.length - shown.length} more ok; --verbose lists them)`)
  }
  console.log(`  ${entry.level.id}: ${passed} passed, ${failed} failed`)
  return failed ? 1 : 0
}

/* ------------------------------------------------------------------ */
/* Fuzz: random play as a second opinion on the map                    */
/* ------------------------------------------------------------------ */

/**
 * Compare the map with random play on the same probe world. Returns { lines, unexplained }:
 * places, things touched and exits random play reached that the map says it cannot. Places only
 * the map has are normal (random input rarely lands a precise jump) and only counted.
 */
export function fuzzLevel(game, level, opts = {}) {
  const { sim, contract } = game
  const { TILE } = contract
  const mode = opts.mode ?? 0
  const t0 = performance.now()
  // Random play presses the hover any old way, so the map it is checked against tries every hover.
  const r = createReach(sim, contract, level, { hover: opts.noHover ? 'off' : 'all' })
  const g = r.graph(mode)
  const tMap = performance.now() - t0
  const t1 = performance.now()
  const ex = r.explore(mode, { ticks: opts.ticks ?? 2e6, seed: opts.seed, noHover: !!opts.noHover })
  const tFuzz = performance.now() - t1
  const lines = []
  lines.push(`FUZZ ${level.id} "${level.name}"   mode: ${modeName(mode)}${opts.noHover ? ', without the hover' : ''}`)
  lines.push(`  random play: ${(ex.ticks / 1e6).toFixed(2)}M ticks from ${ex.cells} saved states${ex.full ? ' (the most it keeps: later finds were not played on from)' : ''} in ${(tFuzz / 1000).toFixed(1)} s; the map: ${g.reached.size} places in ${(tMap / 1000).toFixed(1)} s`)
  const tiles = new Set([...g.reached].filter((k) => !k.includes('|m')))
  const riders = new Set([...g.reached].filter((k) => k.includes('|m')).map((k) => k.replace(/\|\d+$/, '')))
  const withHidden = mode & MODE.HIDDEN ? g : r.graph(mode | MODE.HIDDEN)
  const unexplained = []
  const hiddenOnly = []
  let lips = 0
  for (const [key, v] of ex.places) {
    if (tiles.has(key)) continue
    const [area, c, y] = key.split('|')
    const col = Number(c)
    const feetY = Number(y)
    const grid = r.base(mode).per.get(area).grid
    // At the lip of a ledge his middle can be over the air beside it: the map has that floor as the next column.
    const row = feetY / TILE
    if (Number.isInteger(row) && !(sim.TILE_FLAGS[grid.t[row * grid.w + col]] & (sim.T_SOLID | sim.T_ONEWAY)) && (tiles.has(`${area}|${col - 1}|${feetY}`) || tiles.has(`${area}|${col + 1}|${feetY}`))) {
      lips++
      continue
    }
    if (withHidden.reached.has(key)) hiddenOnly.push(Number.isInteger(row) ? `${area} ${col},${row - 1}` : `${area} col ${col}`)
    else {
      // Spots between spikes and sludge where only a pixel-exact landing stands: real, but usually leading nowhere.
      const hz = (c, rr) => c >= 0 && rr >= 0 && c < grid.w && rr < grid.h && sim.TILE_FLAGS[grid.t[rr * grid.w + c]] & sim.T_HAZARD
      const hazard = Number.isInteger(row) && [col - 1, col, col + 1].some((c) => hz(c, row - 1) || hz(c, row))
      unexplained.push({ what: `${Number.isInteger(row) ? `${area} ${col},${row - 1}` : `${area} col ${col} feet at y ${feetY}`}${hazard ? ' (beside spikes or sludge: a pixel-exact landing)' : ''}`, masks: v.masks })
    }
  }
  for (const [key, v] of ex.riders) if (!riders.has(key)) unexplained.push({ what: `riding the platform ${key.replace('|m', ' slot ')}`, masks: v.masks })
  for (const [id, v] of ex.touched) {
    if (g.touched.has(id)) continue
    const t = r.targets[id]
    if (withHidden.touched.has(id)) hiddenOnly.push(`${t.kind} ${t.area} ${t.tx},${t.ty}`)
    else unexplained.push({ what: `${t.kind} at ${t.area} ${t.tx},${t.ty}`, masks: v.masks })
  }
  for (const [exit, v] of ex.exits) if (!g.exits.some((e) => e.exit === exit)) unexplained.push({ what: exit === 'goal' ? 'the goal' : 'the secret exit', masks: v.masks })
  const mapOnly = [...tiles].filter((k) => !ex.places.has(k)).length
  if (!unexplained.length) lines.push('  OK: random play reached nothing the map says is out of reach')
  else {
    lines.push(`  RANDOM PLAY REACHED ${unexplained.length} THING${unexplained.length === 1 ? '' : 'S'} THE MAP SAYS IT CANNOT (tell the tools owner; the input is in --json):`)
    for (const u of unexplained.slice(0, 30)) lines.push(`    ${u.what}  (after ${u.masks.length} ticks of input)`)
    if (unexplained.length > 30) lines.push(`    and ${unexplained.length - 30} more`)
  }
  if (hiddenOnly.length) lines.push(`  ${hiddenOnly.length} more only after bumping hidden blocks, which the map counts as hidden=on: ${hiddenOnly.slice(0, 8).join('; ')}${hiddenOnly.length > 8 ? ' ...' : ''}`)
  lines.push(`  the map has ${mapOnly} place${mapOnly === 1 ? '' : 's'} random play never stood on (normal: random input rarely lands a precise jump)${lips ? `; ${lips} lip positions matched` : ''}`)
  return { lines, unexplained, ex, r, g }
}

function cmdFuzz(game, entry, flags) {
  const hover = hoverFromFlags(flags)
  if (hover !== null && hover !== 'off' && hover !== 'all') {
    console.error('fuzz takes --hover off or all: random play presses the hover any old way, or never')
    return 2
  }
  const res = fuzzLevel(game, entry.level, { mode: modeFromFlags(flags), ticks: Number(flags.ticks) || 2e6, seed: Number(flags.seed) || undefined, noHover: hover === 'off' })
  for (const l of res.lines) console.log(l)
  if (flags.json) {
    const file = flags.json === true ? `${entry.level.id}.fuzz.json` : flags.json
    writeFileSync(file, JSON.stringify({ level: entry.level.id, unexplained: res.unexplained.map((u) => ({ what: u.what, input: Array.from(u.masks).join(',') })) }, null, 1))
    console.log(`wrote ${path.resolve(file)}`)
  }
  return res.unexplained.length ? 1 : 0
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2))
  const [cmd, which] = pos
  if (!cmd || flags.help || !['lint', 'reach', 'expect', 'fuzz', 'list'].includes(cmd) || (cmd !== 'list' && !which)) {
    console.error(USAGE)
    return 2
  }
  try {
    modeFromFlags(flags)
    hoverFromFlags(flags)
  } catch (err) {
    console.error(err.message)
    return 2
  }
  const game = await openGame()
  try {
    game.meta = (await game.server.ssrLoadModule(GAME_URL + '/game/levels/meta.ts')).LEVEL_META
  } catch {
    game.meta = []
  }
  try {
    if (cmd === 'list') {
      const found = await findLevels(game)
      for (const [id, e] of found) {
        const what = e.level ? `"${e.level.name}", ${e.level.areas.length} area(s)${e.served === false ? '  NOT OPENED BY THE GAME (lint says why)' : ''}${Array.isArray(e.mod?.EXPECT) ? `, ${e.mod.EXPECT.length} EXPECT lines` : ''}` : `does not load: ${e.error?.message}`
        console.log(`${id.padEnd(20)} ${what}  ${e.file ? path.relative(REPO, e.file) : '(levels/index.ts)'}`)
      }
      for (const c of found.clashes) console.log(`TWO FILES define '${c.id}': ${path.relative(REPO, c.first)} (used) and ${path.relative(REPO, c.file)}`)
      return found.clashes.length ? 1 : 0
    }
    if (cmd === 'lint') {
      const found = which === 'all' ? await findLevels(game) : null
      const entries = found ? [...found.values()] : [await loadOne(game, which)]
      let errors = 0
      for (const e of entries) {
        if (!e.level) {
          console.log(`LINT ${path.relative(REPO, e.file)}\n  ERROR  the file does not load: ${e.error?.message}\n`)
          errors++
          continue
        }
        errors += printLint(lintLevel(game, e, { strict: !!flags.strict }))
      }
      for (const c of found?.clashes ?? []) {
        console.log(`LINT ${path.relative(REPO, c.file)}\n  ERROR  it defines level '${c.id}', which ${path.relative(REPO, c.first)} defines too: give each level one file\n`)
        errors++
      }
      if (entries.length > 1) console.log(`${entries.length} levels, ${errors} error${errors === 1 ? '' : 's'}`)
      return errors ? 1 : 0
    }
    const entry = await loadOne(game, which)
    if (cmd === 'reach') return await cmdReach(game, entry, flags)
    if (cmd === 'fuzz') return cmdFuzz(game, entry, flags)
    return cmdExpect(game, entry, flags)
  } finally {
    await game.close()
  }
}

// Run as a command, not when a test imports lintLevel or the expectations from here.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main().catch((err) => {
    console.error(err && err.stack ? err.stack : err)
    return 2
  })
}
