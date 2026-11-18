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
- **From photos** (site manager and up, phones too): photos of the real tunnel,
  up to 600, make the drawing, or correct it. See [From photos](#from-photos-tunnel-from-photos).

## 3D view

The same drawing as a car wash you can walk around: every shape is a model of its
machine, a car rides the conveyor, and a machine only works while the car is in
its reach. A machine that is down stands still under a light.

- **Click** a machine to pick it (a card with its headline numbers appears in the
  canvas). Click it again, double-click, or press Enter to open its page; the
  page's Back arrow returns to the tunnel where you left it. **Details** on the
  card opens the same side panel the diagram uses. Dragging turns the camera; a
  click at the end of a drag never opens anything. Holding the **middle button**
  (or the right one, or Shift, Ctrl or Cmd with the left) and dragging slides the
  view over the floor instead, also on a machine and while moving machines; it
  stays over the wash. The mouse wheel scrolls the
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
  `TunnelPanel.tsx`: the side panel. `photos/`: From photos.
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
  "start from a template" all work, and so does From photos: the pretend
  `tunnel-from-photos` answers after 1.5 s with a made-up proposal
  (`photos=fail|no_key|refused` for its errors), and its entry in `backend.calls`
  records each photo's length, JPEG size and visual tokens. Options (`empty=1`, `templates=0`,
  `canEdit=0`, `rank=`, `user=`, `conflict=1`, `theme=dark`, `lag=`, `photos=`) and the
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
- A conveyor's type is `props.conveyor_type` on its shape: `'chain'` or `'belt'`.
  Missing or anything else is a chain, so every drawing and template made before the
  choice stays a chain; `props` is saved and copied to sites with the rest of the shape,
  so there is no migration. Read it with `conveyorType()` in
  `tunnel/conveyorType.ts`, which also has the belt's cross section and the footprint
  each type gets. The editor's **Conveyor type** (site drawings and templates) changes
  it and fits the shape in one undoable step: a belt is centered on the car's line and
  8.5 ft wide; a chain goes back where it stood before it was a belt (kept on the belt
  as `props.chain_at`, so this survives a save), or to 1.6 ft under the driver's side
  wheels when there is no earlier place to go back to. A spare beside the tunnel only
  changes width. In the tunnel a belt's shape stays on the car's line (Across is
  locked; drags and arrow keys only move it along), because the 3D belts always run
  under the car's wheels and its status pad and 2D drawing must sit on them
  (`tidyBelts`). The 2D drawing draws a belt under every machine whatever its saved
  order, so it never covers the brushes or takes their clicks. With a belt, the editor points out any roller up or roller down left on the drawing
  (a belt has neither) and offers to remove them; it never does on its own. A site
  machine added from "Not on the drawing" whose type or name says belt starts as one
  (a type that only says Belt counts as a conveyor too). In 3D the kind
  stays `conveyor` (the car and the ride still find it) and
  `three/models/conveyorBelt.ts` draws a dual 30 inch modular belt (Tommy's, Sonny's
  WB30, AVW): two flush belts under the car's wheels whatever the shape's width, a
  grating between them, combed diamond plates at the ends that the lugs dive through,
  and a low drive cover at the exit. The belt carries the car, so its wheels stand
  still while it is on the belt (`CarState.carried`) and turn only up the prep lane
  and off the far end. Preview it with `belt=1` on `dev/tunnel3d.html`.
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

## From photos (`tunnel-from-photos`)

**Using it.** On the Tunnel page, someone who can edit the site's drawing picks
**Build from photos** (no drawing yet, beside the template buttons) or **From
photos** (in the toolbar once there is one). They add photos (from the entrance
looking in, from the exit looking back, along each side, the equipment room if it's
on the drawing), may say where each was taken from, and may give the tunnel's or the
conveyor's length. More photos and a known length give a truer scale. One reading
takes up to 600 photos, the most Claude takes in one request; picking more keeps the
first 600 and says how many were left out. With many photos some or all are sent
smaller, and once one is, the dialog says so. Adding a photo makes it ready to send
as well, so adding many takes a while: "Adding photos: 37 of 150" counts them, and
hundreds of camera photos on a phone take minutes (see Data flow for times), with the
screen kept on. **Analyze** then sends them; only photos whose share changed since
(more added, or many removed) are made again first ("Getting photos ready: 37 of
150"). The reading takes a minute or two, longer with many photos. Cancel while it
gets them ready or reads them stops it and goes back to the photos, nothing sent.
Once photos are added, Escape, a tap outside the dialog and its X ask first ("Close
and lose the 150 photos you added?", or on a result "Close without saving?"); Cancel
on the photos closes at once. What comes back is drawn in the dialog to accept:

- No drawing yet: the whole drawing, every machine where it stands, most linked to
  the site's machine of its type. **Save drawing** saves it.
- A drawing already: only corrections. A shape the photos place somewhere else
  (more than half a foot off) moves and takes the zone band it lands in; one they
  show bigger or smaller is resized; a shape with no machine can be linked (a link
  someone made is never changed); a machine missing from the drawing is added; a
  shape the photos show is gone is listed with the reason, ticked, and removed only
  if left ticked. Every shape the answer doesn't change stays exactly as it was,
  and so do the zones; the tunnel's length or width changes only when more than a
  foot off. A conveyor the photos show as the other type changes the way the
  editor's Conveyor type does. **Save changes** saves it; **Review in the editor**
  (wide screens) opens the editor on it as unsaved changes, where Save keeps it and
  Cancel drops it.

Shapes it wasn't sure of are named, and the model's notes (the scale it used, what
it couldn't see) are listed. Unsaved moves are part of what is saved (the dialog
says how many), and are cleared after it, as after the editor.

The function only reads the saved drawing, and its answer repeats most of it. So
the dialog keeps the saved drawing as it was when **Analyze** was pressed, and a
reading that repeats that (within half a foot, for each of x, y, the sizes, the
conveyor type and the tunnel's length and width) changes nothing: whatever has
happened to the shape since stands. That covers this person's unsaved moves, and
someone else's save brought in by **Reload** after a clash (their moves and
deletions are kept; a shape the photos placed that they deleted stays deleted and
is named). With nothing changed since, the plan is the same as without it.

The drawing can also appear or go while the dialog is open. A new drawing can't be
saved over one someone else made first: the page loads theirs and the dialog offers
**Analyze again** with the same photos, as corrections. When the answer itself is
already for the drawing as it now is (the drawing was made or deleted while the
photos were read), the page loads it and the answer is used as it is. `no_key` and
`forbidden` errors offer Close, not Try again.

**Data flow.** A pick opens each photo once, two at a time (`photos/preparePhoto.ts`
`readPhoto`): a file that isn't a photo is turned away on its tile with a note. iPhone
photos (HEIC/HEIF) work in every browser: Safari opens them itself, and where the
browser can't (Chrome, Edge and Firefox on Windows and Android) they are read on the
device by libheif (see HEIC below). From that one opening the rest get a 400 px copy
for the tile (an object URL, revoked when the photo is removed or the dialog closes)
and the JPEG that is sent (EXIF turn applied, on white), made for the photo's share
with every photo picked so far. The full-size photo isn't kept, so hundreds of photos
fit in a phone's memory, and it isn't opened a second time to send it: that second
opening was most of the wait (below). The tiles are drawn again only when their own
photo changes. A JPEG is no more than 1568 px on the long side, and within the
photo's even share of two budgets. One is the request's length: 30,000,000
characters, less the rest of the request counted at its longest (catalog, the
starting drawing even when it isn't sent, both lengths, every photo's JSON with the
longest view, in UTF-8), split evenly, at most 1,600,000 per photo. Counted that way,
setting views, typing lengths or the drawing appearing changes no photo's share. The
other is 300,000 visual tokens in all, a photo costing ceil(w / 28) × ceil(h / 28)
(1568 by 1176 is 2,352). A photo over its share of tokens is made smaller; one whose
JPEG is still too long is saved at a lower quality (down to 0.6), then smaller. By
tokens, 127 photos of 1568 by 1176 go at full size. By length, a detailed phone photo
(about 400,000 characters at 1568 px) starts to give way from about 76. The dialog
says photos are sent smaller once one of them had to give something up while their
share is under the 1,600,000 one photo may have (from 19 photos), so one very
detailed photo among a few doesn't bring it up. At 600 each is about 709 by 532 and
under 50,000 characters, about 296,000 tokens and at most 30 MB in all.

The JPEGs are kept in the dialog from the pick, with the share each was made for,
until it closes (at most about 30 MB, the same as was held after Analyze for Try
again when they were made there). One that no longer fits (photos were added after it was
made) is made again from its file (`encodePhoto`): in the background, one at a time,
once the photos are in, or at **Analyze** for any not done yet. So is one that had
to give something up when its share has since grown by more than a tenth (photos
removed), for a better copy; a smaller change keeps it. Try again, Analyze again and
a reading turned into corrections (the drawing appeared) send the same JPEGs. When a
photo can't be made again (its file was moved or deleted after the pick, or a cloud
drive no longer has it on the device), the copy it has is sent if it still fits (a
better one was only wanted). If it doesn't fit, the photo keeps its faded picture
with "couldn't be opened again" on its tile and is left out; at **Analyze** the
dialog names it.

Times, measured in headless Chrome on the dev page with 12 MP (4032 by 3024) camera
JPEGs: adding takes about 0.13 s a photo on a desktop, and about 0.8 s with Chrome's
CPU slowed 4x as a stand-in for a phone (no real phone has been timed), so 600 camera
photos on a phone take about 8 minutes to add. **Analyze** then took about 2 s for 50
and for 100 photos, with nothing to make again. When the JPEGs were made at Analyze
instead, every photo was opened a second time there: 15 s for 100 on the desktop and
65 s for 50 slowed 4x, which for 600 on a phone would have been about 13 more
minutes.

**HEIC.** `photos/heic.ts` is only asked once the browser has failed to open a file
itself (`createImageBitmap`, then an `<img>`), and only for a file that is HEIC or
HEIF by its name (`.heic`, `.heif`, `.hif`, any case), its type, or its first bytes
(an `ftyp` box with brand heic, heix, heim, heis, hevc, hevx, mif1, msf1 or heif, or
one of the HEVC brands among its compatible ones): files copied off a phone through
Windows or a cloud drive often have no type, and Chrome on Windows gives `.heic` none.
A JPEG named `.heic` still opens the usual way. The file is read by
[heic-to](https://github.com/hoppergee/heic-to) (pinned at 1.6.7, libheif 1.23.7 with
libde265, compiled to plain JavaScript, LGPL-3.0; its `csp` build, which needs no
eval) in a module worker, `photos/heicWorker.ts`; heic-to runs libheif in a worker of
its own started from there. The worker is the only importer, so its 3.2 MB (about
790 kB gzipped, one file, no `.wasm`) is fetched only when a HEIC needs it, never
preloaded by the app. libheif applies the file's turn and mirror (`irot`, `imir`)
and crop, so an iPhone portrait (stored on its side as a 4032 by 3024 grid of 512 px
tiles with `irot`) comes out upright and nothing here turns it again; the primary
image is decoded, not the thumbnail, depth or gain map; 10-bit photos come out as
8-bit. The worker sends back an ImageBitmap, which goes through the same drawing as
any photo, for the tile and the JPEG, and `encodePhoto` reads the HEIC again from its
file the same way. libheif doesn't fail on damaged picture data: every tile it can't
read comes out flat green (YCbCr zero, 0,136,0 for iPhone colours) with no error, and
that green would be sent as part of the tunnel. So a file that stops before its last
box (a copy that didn't finish) is turned away before decoding, and a decoded photo
with a flat pure-green patch over 0.5% of it (one iPhone grid tile is 2%) is turned
away after, which catches copies that are full length but damaged (a cloud file never
fully downloaded, a broken import off the phone). Across 36 real phone and test HEICs
no good photo had any such patch; an iPhone photo with half its data zeroed had 42%.
Messages: a HEIC libheif can't read either says "This HEIC photo couldn't be opened.
It may be damaged, or only partly copied."; when the worker can't be fetched
(offline), "This browser couldn't load what it needs to open HEIC photos. Check the
connection, then remove this photo and add it again." (the next HEIC tries again, with
a new worker). When the worker's file is answered but isn't a script (online, and a
HEAD of it gives an error or HTML: after a deploy Vercel answers the old hashed file
with the app's page), Operator was updated since the page loaded, and it says
"Operator was updated since this page was opened. Reload the page, then add the HEIC
photos again." The page isn't reloaded for them, since that loses the photos. No
answer in 2 minutes says it took too long. Two workers run where `deviceMemory` is 8
(8 GB or more, or not reported) and there are 4 or more cores, else one: each holds
about 300 MB once it has opened a 12 MP photo (about 650 MB after a 48 MP one). Once
no worker has had anything to do for 20 s they are all ended (it is for the pool, not
each worker: on a slow main thread one of two workers could sit unused for 20 s in the
middle of a pick and be started again from cold), and a photo goes to the worker with
the fewest waiting, a tie to the one used least recently. All of them end when the
dialog closes; a photo still on its way to the reader at that moment (the dialog's
AbortSignal is passed through `readPhoto` / `encodePhoto`) starts no new worker. The
picker's `accept` names `.heic,.heif` beside `image/*` so desktop pickers list them.
Nothing is uploaded to convert them.

A Content Security Policy, if one is ever added, must allow `worker-src 'self' blob:`:
heic-to starts libheif from a `blob:` URL (no `wasm-unsafe-eval` is needed, there is no
wasm). Without `blob:` the first HEIC says it couldn't load what it needs, and so does
each after it, at once (a worker whose libheif didn't start is ended rather than
reused). heic-to, libheif and libde265 are LGPL-3.0: the worker file carries a kept
`/*!` notice naming them and the license, but the app has no third-party notices page
yet with the license texts.

Times in headless Chrome on a desktop (which, like Chrome on Windows, can't open HEIC
itself), with iPhone 12 MP HEICs: about 0.9 s a photo per worker, so adding 60 took
28 to 29 s (about 0.48 s each with two workers, 0.84 s with one); the first takes
about 0.5 s more while the reader starts. A click on the dialog answered within 40 ms
the whole time (long tasks at most about 90 ms), against 0.11 s a photo for 12 MP
camera JPEGs. A 48 MP HEIC took 5 s. Making photos again for a new share is as slow
as adding them: after 120 HEICs had been added, the 10 more that took the count past
127 meant Analyze took 95 to 100 s to make the 120 again. With the page's CPU slowed
4x (a 390 px phone view, 50 photos), one worker added them at 1.2 to 1.3 s each and two
at 1.9 to 2.1 s; at 1x and 2x two were faster (0.55 and 0.65 s against 0.90 and 0.96
s). That slowdown may reach only the page's thread, not the workers, so it is not a
real phone.
No phone has been timed.

The page sends them, with the shape kinds (`SHAPES`) and, with no drawing
yet, the standard template as a starting point, to the `tunnel-from-photos` edge
function (`miTunnel.fromPhotos`). The function checks the person can edit the site's
drawing, reads the drawing and the site's machines itself, asks Claude, and answers
with a proposal in the drawing's own feet: each
item names the existing shape it is (`ref`) or none, and its machine (checked to be
the site's). **Photos are never stored**: they go to the function and on to Claude
and are dropped. Nothing is written until the person saves, which goes through
`mi_tunnel_save` like the editor (the drawing's version is checked, so a save
someone else beat says so and offers Reload, see above). The contract types are in
`lib/queries/miTunnel.ts` and the function's `plan.ts`, kept the same; the merge
from proposal to saved drawing is `photos/mergeProposal.ts` (no React), the dialog
`photos/PhotosDialog.tsx`. Limits (`PHOTO_LIMITS`, and `LIMITS` in `plan.ts`): 1 to
600 photos (Claude's limit for one request on a model with a 1M context; a 200k
model takes 100), each at most 1,600,000 base64 characters, the whole request at most
30,000,000 characters from the page and 32 MiB at the function (the looser of the
two, so the page is never turned away for its own budget), known lengths 20 to 400
ft. The 300,000 visual tokens are the page's alone (the function doesn't open the
photos); they bound how long Claude takes and what it costs, about $1.20 of input
at the cap on `claude-opus-5-5` ($4 per million input tokens).

**The function** (`supabase/functions/tunnel-from-photos/`: `index.ts` is the HTTP
side, `plan.ts` the prompt, schema, request checks and the tidy-up of the answer,
all of which also run under Node). It runs as the caller (JWT verification on,
`mi_tunnel_get` must say `can_edit`), and its only secret is `ANTHROPIC_API_KEY`
(503 `no_key` without it). It reads the rest of a request before turning it away
(no key, sign in again, over 32 MiB, the wrong method): Supabase holds back an
answer sent while the request is still coming in until its 150 s idle limit, so
before this a page sending megabytes of photos waited two and a half minutes for
"Sign in again" (seen on production with 1, 4 and 8 MB). Model `claude-opus-5-5`,
effort `medium`, structured JSON output, streamed, `max_tokens` 32000, with the
server-side fallback beta and
one retry without it if the API turns that down. With no drawing yet it starts
Claude from the account's first template that has shapes, else the standard
template the page sent. Once the checks pass it answers 200 at once and sends a
space every 10 s, then the JSON, because Supabase drops a request that is silent
for 150 s. Claude gets about 370 s from the start of the request, which needs a
paid plan's 400 s limit; past it the answer is `too_long`. A request the platform
cuts off shows "The answer was cut off" on the page. Claude names shapes and
machines by short handles (`S1`, `M1`) that the function maps back to real ids,
so a proposal only ever holds ids from the site. The tidy-up links each machine to
at most one shape (never to a room or label), keeps a corrected conveyor's type
unless the photos clearly show the other, gives a shape read with less than high
confidence its drawn numbers back when within a foot, applies a known tunnel or
conveyor length outright, and clamps every number. Each request logs one line
(mode, photo count, time, result, token counts, how long thinking took), never
the photos. Deploy: `npx supabase functions deploy tunnel-from-photos
--project-ref ppwjqifyyihesuoubixk --use-api`.

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
