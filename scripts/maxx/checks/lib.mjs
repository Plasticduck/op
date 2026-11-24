// Shared helpers for the checks in this folder (each is a --script for scripts/maxx/shot.mjs).
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { GAME_URL } from '../paths.mjs'

/** Sets up page-side helpers (window.__t) and recorders (window.__rec). */
export async function install(maxx, { manual = true } = {}) {
  await maxx((m, manual, GAME) => {
    m.setManual(manual)
    const rec = (window.__rec = { audio: [], rumble: [], warn: [], frames: {} })
    const tickOnce = () => {
      m.step(1)
      const f = m.sceneObject() && m.sceneObject().frame
      if (f) rec.frames[f] = (rec.frames[f] || 0) + 1
    }
    const a = m.ctx.audio
    for (const k of ['sfx', 'music', 'jingle', 'spray', 'setPaused', 'unlock']) {
      const f = a[k].bind(a)
      a[k] = (...args) => {
        if (k !== 'unlock') rec.audio.push(k + ':' + String(args[0]))
        return f(...args)
      }
    }
    const i = m.ctx.input
    const r = i.rumble.bind(i)
    i.rumble = (...args) => {
      rec.rumble.push(args.join(','))
      return r(...args)
    }
    const T = 32
    window.__t = {
      /**
       * A module of the game as the page itself has it, e.g. mod('engine/text.ts'). After a source
       * edit the dev server serves modules under ?t= URLs, and a bare import would be a second copy.
       */
      mod(rel) {
        const url = GAME + '/game/' + rel
        const live = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .find((n) => n.includes(url))
        return import(live ?? url)
      },
      /** Put Maxx with the middle of his feet at tile column `col` (fractions allowed), feet at world y. */
      place(col, feetY = 320, face = 1) {
        const w = m.world()
        const p = w.player
        p.x = col * T - 11
        p.y = feetY - 52
        p.vx = 0
        p.vy = 0
        p.facing = face
        p.px = p.x
        p.py = p.y
        // A teleport: bring the camera along at once, so what is around him is awake on the next tick.
        w.camLook = face * 56
        w.camera.x = Math.max(0, Math.min(w.grid.w * T - 640, p.x + 11 + w.camLook - 320))
      },
      /** Step n ticks holding these actions. */
      run(actions, n, axis) {
        if (actions) m.hold(actions, axis)
        else m.release()
        for (let k = 0; k < n; k++) tickOnce()
      },
      /** Step until fn(world) is true, at most `max` ticks. Returns ticks taken, or -1. */
      until(actions, fn, max = 600, axis) {
        if (actions) m.hold(actions, axis)
        else m.release()
        for (let i = 0; i < max; i++) {
          tickOnce()
          if (fn(m.world())) return i + 1
        }
        return -1
      },
      info() {
        const w = m.world()
        if (!w) return null
        const p = w.player
        const s = m.sceneObject()
        return {
          tick: w.tick,
          area: w.area.id,
          status: w.status,
          x: +p.x.toFixed(2),
          y: +p.y.toFixed(2),
          vx: +p.vx.toFixed(1),
          vy: +p.vy.toFixed(1),
          state: p.state,
          ground: p.onGround,
          facing: p.facing,
          pips: p.pips,
          wax: p.wax,
          turbo: p.turbo,
          invuln: p.invuln,
          riding: p.ridingId,
          spraying: p.spraying,
          aim: p.aim,
          hovering: p.hovering,
          hover: p.hover,
          cam: [Math.round(w.camera.x), Math.round(w.camera.y)],
          drops: w.droplets.length,
          lives: w.session.lives,
          score: w.session.score,
          coins: w.session.coins,
          cars: w.stats.carsWashed + '/' + w.stats.carsTotal,
          frame: s && s.frame !== undefined ? s.frame : undefined,
          warp: w.warp ? w.warp.mode + ':' + w.warp.phase + ':' + w.warp.t : null,
        }
      },
      tile(tx, ty) {
        const g = m.world().grid
        return String.fromCharCode(g.t[ty * g.w + tx])
      },
      ents(kind) {
        return m
          .world()
          .entities.filter((e) => !kind || e.kind === kind)
          .map((e) => ({ id: e.id, kind: e.kind, variant: e.variant, x: Math.round(e.x), y: Math.round(e.y), w: e.w, h: e.h, hp: e.hp, state: e.state, active: e.active, solid: e.solid, harmful: e.harmful }))
      },
      /** A zoomed crop of the game picture around a screen point (game pixels), as a PNG data URL. */
      zoom(cx, cy, w, h, scale) {
        const c = document.querySelector('canvas')
        const k = c.width / 640
        const out = document.createElement('canvas')
        out.width = w * scale
        out.height = h * scale
        const g = out.getContext('2d')
        g.imageSmoothingEnabled = false
        g.fillStyle = '#000'
        g.fillRect(0, 0, out.width, out.height)
        g.drawImage(c, Math.round(cx - w / 2) * k, Math.round(cy - h / 2) * k, w * k, h * k, 0, 0, out.width, out.height)
        return out.toDataURL('image/png')
      },
      /** The whole 640x360 picture at 1x, as a PNG data URL. */
      native() {
        const c = document.querySelector('canvas')
        const out = document.createElement('canvas')
        out.width = 640
        out.height = 360
        const g = out.getContext('2d')
        g.imageSmoothingEnabled = false
        g.drawImage(c, 0, 0, 640, 360)
        return out.toDataURL('image/png')
      },
      /** Colour of one game pixel on screen, '#rrggbb'. */
      pixel(x, y) {
        const c = document.querySelector('canvas')
        const k = c.width / 640
        // Read from a copy made for reading, so the game's own canvas is left as it was made.
        const one = (window.__one ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true }))
        one.canvas.width = 1
        one.canvas.height = 1
        one.drawImage(c, Math.round(x) * k, Math.round(y) * k, 1, 1, 0, 0, 1, 1)
        const d = one.getImageData(0, 0, 1, 1).data
        return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
      },
    }
  }, manual, GAME_URL)
}

export function saver(dir) {
  return (name, dataUrl) => {
    const file = path.join(dir, name)
    writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log('[saved] ' + file)
    return file
  }
}
