# Maintenance Inventory: tunnel diagrams

A drawing of each site's tunnel whose shapes link to real machines, shown in 3D,
as a flat diagram from above, and as a list. Built 2026-11-11 (migration 0228);
the 3D view 2026-11-12 (no migration). Machines themselves are in
[EQUIPMENT.md](EQUIPMENT.md).

## Using it

- **Tunnel** tab (`/app/maintenance-inventory/tunnel?site=&item=&view=`), three
  views of the same drawing: **3D** (the default, see [3D view](#3d-view)),
  **Diagram** and **List**. Color any of them by status, use count, open work
  orders or sticker.
- **Diagram**: hover or tab to a shape and every shape linked to the same machine
  lights up. Click or Enter opens the panel: status, use count, maintenance, open
  work orders, and the everyday actions. Phones get the drawing turned upright,
  entrance at the top; **Turn** flips it anywhere. **List** shows the same thing
  as a table.
- A dashed shape isn't linked to a machine yet. Its panel lists the site's
  machines (likeliest first) or adds a new one.
- **Edit drawing** (desktop, site manager and up): drag, nudge with the arrow keys,
  add shapes or the site's machines that aren't on it yet, set a shape's machine,
  side, zone and size, set the tunnel's length and zone bands. Saving replaces the
  whole drawing; if someone else saved first, the save is turned away.
- **Settings > Tunnel diagrams** (directors): templates, "Set up sites" from a
  template (with a check first), edit or remove a template.

## 3D view

The same drawing as a car wash you can walk around: every shape is a model of its
machine, a car rides the conveyor, and a machine only works while the car is in
its reach. A machine that is down stands still under a light.

- **Click** a machine to pick it (a card with its headline numbers appears in the
  canvas). Click it again, double-click, or press Enter to open its page; the
  page's Back arrow returns to the tunnel where you left it. **Details** on the
  card opens the same side panel the diagram uses. Dragging turns the camera; a
  click at the end of a drag never opens anything. The mouse wheel scrolls the
  page until you click in the canvas; Ctrl or Cmd + wheel, or a pinch, always zooms.
- **Move machines** (site manager and up; the toggle in the canvas, or M; people
  who can't edit the drawing don't get it): drag a machine along the tunnel, or
  anywhere on the floor for machines beside it. It snaps to half a foot (Alt: a
  tenth). Left and Right nudge the focused or picked machine (Alt: a tenth, Shift:
  five feet), as do the steppers on its card. While moving machines, clicking the
  picked machine again doesn't open it (so a drag can't turn into a visit);
  double-click, Enter or **Open machine** on the card still do. The conveyor, rooms and labels stay
  put. Moves are not saved as you go: a bar says "3 machines moved" with **Undo**
  (also Ctrl+Z or Cmd+Z while moving machines), **Reset** and **Save**. In 3D the
  bar floats at the bottom of the canvas (bottom left, by the card or the legend, on
  canvases 640 to 1000 px wide; on a phone the machine card folds its numbers to one
  line while the bar shows); Diagram and List draw the moves too and
  show the bar above the drawing. Under 480 px wide the bar keeps to one line ("3
  moved" and the buttons), and a note under it (a save that didn't go through,
  moves dropped) is one short line that opens to the whole text on a tap. Adding,
  deleting, resizing and turning shapes is still **Edit drawing**, which opens on
  the moved drawing (saving there saves the moves).
- The **N down** button picks the next machine that is down, entrance to exit; in
  3D the camera flies to it.
- A machine's page has **View in tunnel**
  (`tunnel?site=<site>&asset=<machine>`, plus `tunnel=` on a second tunnel and
  `item=` for a component, which shows through its machine's shape): it picks that
  machine's shape, or says the machine isn't on the drawing yet.
- A site with no drawing shows the first template (or the standard express tunnel)
  as a showroom above the "start from a template" buttons.
- If the browser has no WebGL2, the graphics context is lost and doesn't come back,
  or the view fails, the page shows the Diagram with a line saying why, and **Try
  3D again** unless the browser can't do 3D at all. Nothing is lost: the site, the
  selection and unsaved moves belong to the page, not the canvas. After a deploy,
  a 3D chunk that no longer exists reloads the page once, but only while the 3D
  view is on screen (with unsaved moves the browser asks first, and staying shows
  the Diagram). In development a chunk that
  fails to load (Vite mid-edit) shows the Diagram instead of reloading, and **Try
  3D again** fetches it fresh.

### URL and what's remembered

| | |
|---|---|
| `view=3d\|diagram\|list` | Which view. No param: the last one picked (`localStorage mi.tunnel.view`), else 3D. A 3D failure shows the Diagram for that visit without changing either. |
| `item=<shape id>` | The selected shape, in all three views. |
| `asset=<machine id>` | Select the shape linked to that machine, then the param is removed. |
| `site=`, `tunnel=`, `edit=1` | As before. |
| `localStorage mi.tunnel.site`, `mi.tunnel.color` | The last site and color-by picked. |
| `sessionStorage mi.tunnel.draft:<user id>:<layout id>` | Unsaved moves and their undo steps, so a reload or a look at a machine's page keeps them (this tab only). Kept per person, and only for people who can edit the drawing: the next person to sign in on a shared tab, or anyone who can't save, never sees them. |
| `sessionStorage mi.tunnel.cam:<layout id>` | Where the camera was (`mi.tunnel.cam:preview` for the showroom). |
| `localStorage mi.tunnel.play` | Play or pause. |

### How moves are saved

There is no new table, column or function. `useTunnelMoves.ts` keeps the moves as
overrides (`{ shape id: { x_ft, y_ft, zone, from, sent? } }`, the zone being the band the
shape now stands in, as the editor sets it on a drop, and `from` where the shape
stood, x, y and side, when it was first moved) on top of whatever `mi_tunnel_get`
last returned, so all three views draw them and a reload (someone linked a
machine, a scan, Back from a machine's page) keeps them. A machine moved back to
its saved spot is no longer a move. **Save** sends the whole drawing (the last
loaded shapes with the moves applied, numbered by `sort_order`) through
`mi_tunnel_save` with the layout's `version`, exactly as the editor does, then
reloads. If someone else saved first, the function turns it away ("Someone else
changed..."); the page loads their version, puts the moves back on top by shape id
and asks to save again.

Every reload brings the latest `version`, so the save's version check can't catch a
move that clashes with someone else's change. That is what `from` is for: whenever
fresh data comes in, a move whose shape now stands somewhere other than its `from`
(someone else moved it, or changed its side) is dropped, and the bar names it
("Someone else moved Wheel Boss PS in the meantime, so your move of it was
dropped."), as is a move whose shape they deleted. Their change stands; moves on
shapes nobody else touched stay on top of the new version.

Machines can still be moved while a save is on its way, and the save moves shapes
too. So a move kept through a save also gets `sent`, where the save put its shape,
and once the drawing shows the shape there the move starts from that spot instead
(a machine nudged again during the save stays moved, and nobody is named). Until
the drawing shows it (the reload after a save can lag, fail, or be beaten by an
older answer) the move is kept as it is, even on the spot the drawing still has: a
machine put back where it was loaded during a save is still a move, since the save
is about to put it elsewhere. Undo (and Ctrl+Z) waits for the save, as the bar's
Undo button does.

While moves are waiting, closing or reloading the tab asks first, and so does
going elsewhere in the app, except for two ways out that keep the moves (they are
in sessionStorage): changing only this page's search params (view, selection,
color) and opening a machine's page from the tunnel (its Back arrow comes back
here). Changing site or tunnel asks, then drops them.

### Where the code is

All under `src/features/maintenance/inventory/tunnel/`:

- `TunnelPage.tsx`: the three views, the selection, the unsaved moves bar, the
  fallback to the Diagram, the showroom. `useTunnelMoves.ts`: the moves.
  `TunnelPanel.tsx`: the side panel.
- `view3d.ts`: the contract between the page and the 3D view (`Tunnel3DProps`):
  types and the WebGL2 probe only, so the page never pulls three.js in.
- `Tunnel3DHost.tsx`: checks for WebGL2, loads the view's chunk lazily, reports
  failures. `Tunnel3D.tsx`: the widget: the canvas plus the HTML over it
  (toolbar, name chip, machine card, legend). `tones.ts`: what each color means,
  shared with the diagram; `TunnelDiagram.tsx` turns a tone into its look, and
  its `ToneSquare` is the List view's swatch.
- `three/`: everything that needs three.js (plain three.js, no model or texture
  files, everything is built in code). `types.ts` is the contract inside it;
  `TunnelScene.ts` the scene; `stage.ts`, `floor.ts` the renderer, lights and
  slab; `kit.ts` and `kit/` the shared materials and parts; `models/` one builder
  per kind of shape; `life.ts`, `vehicle.ts`, `car.ts` the car and when machines
  run; `interaction.ts` hover, click and drag; `status.ts` highlights, pads and
  lights; `ui/` the widget's HTML pieces.

### Adding a model for a new kind of shape

A kind is a key of `SHAPES` in `tunnel/shapes.tsx` (the 2D drawing). For 3D,
write a builder `(input: ModelInput) => Model` in a file under `three/models/`
(copy the pattern of `models/wrap.ts`; the rules and the draw-call budget are in
the header of `three/kit.ts`) and add it to `BUILDERS` in
`three/models/index.ts`. A kind with no builder gets `models/fallback.ts`, a
plain labeled stand-in that keeps to the footprint, so a new 2D shape never
breaks the 3D view. Look at it alone with `dev/tunnel3d.html?kind=<kind>`.

### Dev pages (no sign-in)

Start `npx vite --port 5199 --strictPort`, then:

- `http://localhost:5199/dev/tunnel3d-page.html`: the real Tunnel page (3D,
  diagram, list, side panel, a machine's page) on a pretend server with sample
  data in memory (`three/dev/fakeBackend.ts`, which stands in for the mi_*
  database functions; no sign-in, no `.env.local`). Saving, conflicts, linking and
  "start from a template" all work. Options (`empty=1`, `templates=0`,
  `canEdit=0`, `rank=`, `user=`, `conflict=1`, `theme=dark`, `lag=`) and the
  `window.__page` probe for scripts are in the header of
  `three/dev/pageHarness.tsx`. Opening a machine moves it to the app's own
  addresses (`/app/maintenance-inventory/...`); a reload there loads the real app,
  so reload from the page's own address.
- `http://localhost:5199/dev/tunnel3d-widget.html`: the 3D widget alone
  (`three/dev/widgetHarness.tsx`).
- `http://localhost:5199/dev/tunnel3d.html`: the bare scene, or one model on a
  slab with `?kind=wrap` (`three/dev/harness.tsx`).
- `node scripts/tunnel3d-shot.mjs --out shot.png --q "<query>"` screenshots the
  scene page in headless Chrome. For another page pass `--url <its address>`, and
  `--noready` for the Tunnel page (it doesn't set `window.__t3d.ready`; wait on
  `window.__page.ready` in a script instead). `--script steps.mjs` clicks and drags
  through a flow. The dev pages are not part of the production build.

## How it's stored

- `mi_tunnel_layouts`: one per site and tunnel number (`tunnel_no`), or a template
  (no site). `length_ft`, `width_ft`, `zones` (`[{name, x_from, x_to}]`),
  `based_on`, `version`.
- `mi_tunnel_items`: the shapes. Feet: `x_ft` along the tunnel from the entrance
  (prep is negative), `y_ft` across it from the centerline with the driver's side
  negative; x/y is the center, `w_ft` runs along x, `h_ft` across. `kind` picks the
  drawing (`tunnel/shapes.tsx`). `match_type` is the machine type a template shape
  stands for; `asset_id` the linked machine (set null if it's deleted, cleared if it
  moves to another site).
- Writes go through `mi_tunnel_save`, `mi_tunnel_link_item`, `mi_tunnel_apply`,
  `mi_tunnel_delete`. Reads: `mi_tunnel_get(site, tunnel)`, `mi_tunnel_templates()`,
  `mi_tunnel_template(id)`.

## Copying to sites (`mi_tunnel_apply`)

From a template or another site's drawing. Each shape links to the site's machine
whose type matches, machines before components (so "Wrap Driver Side 1" finds the
component under "Wraps DS1/PS1 and DS2/PS2"). Two candidates of the same kind is
reported as a guess. Shapes with no type are placeholders, not failed matches.
Zones become the site's zones, and machines with no zone get the zone of the shape
they landed on, with their components. A check (`p_commit false`) runs everything
and rolls it back, so the report is exact. One site is a site manager's job; several
at once needs a director.

## The standard template

`tunnel/expressTemplate.ts`, created from Settings ("Create the standard template")
or a site's empty Tunnel screen. The order was approved 2026-11-11 as a starting point,
built from the 30 machines MaintainX lists at every Mighty Wash site (16 sites have
the identical set; 24 have Top Brush 1 and 2):

Prep (Bug Prep Unit, Prep Gun Unit) · Photo Eyes, Truck Bed Sensor, Roller Up ·
Presoak* · High Pressure Blaster · Wheel Boss DS/PS · Wraps DS1/PS1 · Top Brush 1 ·
Gloss Boss DS/PS · Short Brush · Van High · Wraps DS2/PS2 · Top Brush 2 ·
Protectant* · Tire Shine DS/PS* · R.O. Rinse · Spot Free Rinse · Dryers (Blower
Assembly) · Roller Down. Conveyor (Chain) the full length. Equipment room: Hydra
Flex, R.O. Unit, Water Softener, Customer Air, Air Comp 1 and 2, Air Compressor.
Vacuums: Turbine 1 and 2, accessories.

\* No MaintainX record yet: drawn dashed until linked.

Distances are estimates; each site's copy is meant to be dragged to match.

## Not yet

- Use counted by wash package (tire shine only on some packages): needs a daily
  package count table filled from SiteWatch and FlexWash. See EQUIPMENT.md.
- Sites with two tunnels: `tunnel_no` is in place; the counter is the site total.
