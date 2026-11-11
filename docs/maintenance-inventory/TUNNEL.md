# Maintenance Inventory: tunnel diagrams

A top-down drawing of each site's tunnel whose shapes link to real machines.
Built 2026-11-11 (migration 0228). Machines themselves are in
[EQUIPMENT.md](EQUIPMENT.md).

## Using it

- **Tunnel** tab (`/app/maintenance-inventory/tunnel?site=&item=`). Hover or tab
  to a shape: every shape linked to the same machine lights up. Click or Enter
  opens the panel: status, use count, maintenance, open work orders, and the
  everyday actions. Color the drawing by status, use count, open work orders or
  sticker. **List** shows the same thing as a table. Phones get the drawing turned
  upright, entrance at the top; **Turn** flips it anywhere.
- A dashed shape isn't linked to a machine yet. Its panel lists the site's
  machines (likeliest first) or adds a new one.
- **Edit drawing** (desktop, site manager and up): drag, nudge with the arrow keys,
  add shapes or the site's machines that aren't on it yet, set a shape's machine,
  side, zone and size, set the tunnel's length and zone bands. Saving replaces the
  whole drawing; if someone else saved first, the save is turned away.
- **Settings > Tunnel diagrams** (directors): templates, "Set up sites" from a
  template (with a check first), edit or remove a template.

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
