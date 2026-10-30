# IT Inventory: design notes

What the module is built from, so every screen reads as Operator. Rule: use
these and only these. If something is missing, build it from these primitives
and put it in `src/components/`, not in this folder. Spec: `docs/it-inventory/SPEC.md`.

## Tokens (`src/index.css`)

- **Color**: semantic only, never hex. Surfaces `bg-shell` (dark nav),
  `bg-content` (page), `bg-card` (panels). Text `text-ink`, `text-ink-muted`,
  `text-ink-subtle`, `text-ink-invert`. Lines `border-border`,
  `border-border-strong`. Status families `accent` / `ok` / `warn` / `danger`,
  each with `-soft` for tinted backgrounds. Meaning (same as checklist AI
  results and work orders): ok = good / in service, warn = needs attention /
  expiring, danger = broken / offline / expired, accent = informational / your
  action, neutral (`bg-border/60`) = not applicable.
- **Dark mode**: `.dark` on `<html>` re-points the same tokens
  (`src/lib/theme.ts`). Anything built from tokens is dark-mode correct. The
  only fixed colors allowed are print and label output (black on white).
- **Type**: DM Sans (`font-sans`), JetBrains Mono (`font-mono`) for tags,
  serials, IP and MAC. Base 17px. Page title `text-xl font-semibold
  tracking-tight`; detail title `text-[17px] font-semibold`; section labels
  `text-[11px] font-semibold uppercase tracking-wider text-ink-subtle`; body
  `text-sm`; meta `text-xs` / `text-[11px] text-ink-subtle`. Numbers
  `tabular-nums`.
- **Radius**: `rounded-md` for cards, inputs, buttons and table frames
  (`rounded-xl` appears on some newer pages; this module uses `rounded-md` like
  Assets and Work Orders). Pills `rounded-full`.
- **Shadow**: essentially none; menus and modals `shadow-md` / `shadow-xl`.
- **Spacing**: Tailwind default scale. Page padding `px-4 py-6 sm:px-6
  lg:px-8`; list+detail shells use the CLAUDE.md wrapper.
- **Breakpoints**: Tailwind defaults; `lg` is the desktop split. Phone first.
- **Touch**: icon buttons `size-9` (36px), primary buttons `h-10`. Inputs
  render at 16px on touch screens (no iOS zoom; handled globally).
- **Motion**: `transition` with the default 200ms curve. Respect
  `prefers-reduced-motion` for anything looping.

## Components

| Need | Use |
|---|---|
| Page title + actions | `components/layout/PageHeader` |
| Buttons | `ui/Button` (primary, secondary, ghost, danger, link; sm, md, lg, icon) |
| Inputs | `ui/Input`, `ui/Select` (native), `forms/Field` (label, hint, error, required star) |
| Badges | `ui/Badge` tones neutral / accent / ok / warn / danger |
| Cards / KPIs | `data/StatCard`, `data/StatCardRow` |
| Tables | plain `<table>` in a bordered card, header row `bg-content text-[11px] uppercase tracking-wide text-ink-subtle`, rows `divide-y hover:bg-content` (as Work Orders, IT Field Checklist). `data/DataTable` exists for TanStack tables |
| Modal | `ui/Modal` (sm / md / lg; bottom sheet on phones) |
| Confirm / destructive | `feedback/ConfirmDialog` (`destructive` for red) |
| Empty | `ui/EmptyState` (icon, title, description, action) |
| Loading | `Loader2` spinner centered (`animate-spin text-ink-muted`); route-level `TopLoadingBar`. There is no shared skeleton component yet |
| Toast | none shared; pages use inline `bg-ok-soft text-ok` / `bg-danger-soft text-danger` banners. Follow that |
| Tabs | no shared component; detail pages use the underline pattern from `ops/assets/AssetDetail` (`border-b-2 border-accent text-accent`). Lists use the segmented control (`rounded-lg border bg-card p-0.5`, active `bg-accent-soft text-accent`) |
| QR | `data/QrCodeImage` |
| PDF preview | `data/PdfPagePreview` (added for stickers): renders the real generated PDF with pdf.js, so previews match print |
| Barcodes, labels | `lib/barcode/code128.ts`, `lib/labels/layout.ts` + `labelPdf.ts` (shared, not module-only) |
| Signature | `forms/SignaturePad` (added for check-out): finger / stylus, ink follows the theme, exports black on white |
| Camera scanner | `components/scan/BarcodeScanner` (added for scanning): viewfinder from tokens, torch, beep / buzz (`lib/scan/feedback`), continuous mode for audits and bulk |
| Photos | `data/AttachmentViewer` |
| Icons | `lucide-react` only, through this module's `icons.ts` map |

## Layout

- Nav: IT section in `components/layout/Sidebar.tsx` (`NAV_GROUPS`); page
  access via `pageAllowed()`; pre-launch email gate on the route and the item.
- Site scoping: `useLocations().activeLocation` is the site the user is
  working in (the switcher). Lists default to it and offer "All sites".
- Detail page header copies `ops/assets/AssetDetail`: back arrow on phones,
  small tag line + badges above a 17px title, Edit + overflow menu on the right,
  underline tabs below, scrolling body.
- Bottom nav on phones (`BottomNav`) hides on full-screen detail routes.

## Voice

Plain, direct, written for a site manager. Short sentences. Say what happened
and what to do next. No jargon where a plain word works ("checked out to",
not "deployed"; "sticker", not "asset label"). No em dashes in anything a
user reads. Confirmations name the thing ("Archive WD-000123 Lobby tablet?").
Errors say what to change ("This item is Broken, so it can't be checked out.
Change its status first.").

## Printing

Labels and PDFs are black on white for scan reliability, built with jsPDF.
Customer logo comes from `accounts.brand_logo_url` (`lib/pdfLogo.ts`) and is
dropped first when space is tight. QR keeps a full quiet zone.
