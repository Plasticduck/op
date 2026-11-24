import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import type { SceneId, SceneParams } from '../contract'
import { MaxxGame } from '../../MaxxGame'
import { SCENES } from '../scenes'

// The game's dev page: http://localhost:5311/dev/maxx.html (npx vite --port 5311 --strictPort).
// No sign-in, debug mode on. Screenshot and drive it with
//   node scripts/maxx/shot.mjs --out shot.png --q "<query>"
//
// Query parameters:
//   scene=title|map|play|gameover|ending|sandbox   the scene to start in (default sandbox)
//   level=<id>        passed to the scene as params.level (the sandbox and play scenes read it)
//   params=<json>     more scene params, e.g. params={"checkpoint":true}
//   manual=1          time stands still until a script calls window.__maxx.step(n)
//   user=<id>         whose save to use (default "dev"; localStorage key smm.save.v1.<id>)
//   fresh=1           forget that user's save first
//   debug=0           as players get it: no debug overlays (window.__maxx is then absent too)
//   strict=1          inside React StrictMode, which mounts everything twice
//   frame=<w>x<h>     put the game in a box of that size instead of the whole window
//
// In debug mode window.__maxx drives the game (see engine/debug.ts for the full list):
//   ready                    true once sprites are loaded and the first frame is drawn
//   scene()  go(id, params)  the scene on screen; switch scene (a cut)
//   setManual(on)  step(n)   stop the clock; run n ticks and draw
//   hold('right jump')  release()  tap('confirm')   scripted buttons
//   world()                  the World of the scene on screen, if it has one
//   frame()  status()  errors  ctx  handle
// window.__maxxHost.unmount() and .mount() take the whole React tree down and put it back,
// as leaving the route and coming back does (for checks that nothing is left running).

const q = new URLSearchParams(location.search)
const asked = q.get('scene') ?? 'sandbox'
const scene = (Object.prototype.hasOwnProperty.call(SCENES, asked) ? asked : 'sandbox') as SceneId
const user = q.get('user') || 'dev'

let params: SceneParams = {}
try {
  params = { ...(JSON.parse(q.get('params') ?? '{}') as SceneParams) }
} catch {
  console.warn('[maxx] params is not JSON, ignored')
}
if (q.get('level')) params.level = q.get('level')

if (q.get('fresh') === '1') {
  try {
    localStorage.removeItem(`smm.save.v1.${user}`)
  } catch {
    // No storage: nothing to forget.
  }
}

const size = /^(\d+)x(\d+)$/.exec(q.get('frame') ?? '')
const root = document.getElementById('root')!
root.style.cssText = size ? `position:fixed;left:24px;top:24px;width:${size[1]}px;height:${size[2]}px;outline:1px dashed #e85aa0` : 'position:fixed;inset:0'
document.body.style.margin = '0'

const game = <MaxxGame userId={user} debug={q.get('debug') !== '0'} startScene={scene} startParams={params} manual={q.get('manual') === '1'} />
const reactRoot = createRoot(root)
const mount = () => reactRoot.render(q.get('strict') === '1' ? <StrictMode>{game}</StrictMode> : game)
mount()
;(window as unknown as { __maxxHost?: unknown }).__maxxHost = { mount, unmount: () => reactRoot.render(null) }
