// Run from op/: DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock supabase/functions/checklist-daily-email/render_test.ts
// Set CHECKLIST_EMAIL_OUT=<file.html> (and --allow-write --allow-env) to also write the sample email.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { addDays, buildHtml, zoned, type Flagged, type Row } from './render.ts'

const DAY = '2026-11-18'
const at = (hhmm: string, day = DAY) => zoned(day, 0, 'America/Chicago').getTime() + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000
const iso = (hhmm: string, day = DAY) => new Date(at(hhmm, day)).toISOString()

function row(site: string, name: string, opens: string, closes: string, extra: Partial<Row> = {}, day = DAY): Row {
  const n = Number(site.slice(2))
  return {
    location_id: `loc-${site}`,
    location_name: site,
    region: n <= 10 ? 'Lubbock Region' : n <= 20 ? 'Permian Basin - Midland' : n <= 30 ? 'New Mexico Region' : 'Central Region',
    rm_name: n <= 10 ? 'Matthew Canales' : n <= 20 ? 'Davis Jones' : n <= 30 ? 'Rance Breed' : null,
    checklist_id: `cl-${name}`,
    checklist_name: name,
    opens_at: iso(opens, day),
    closes_at: closes === '24:00' ? iso('00:00', addDays(day, 1)) : iso(closes, day),
    instance_id: null,
    submitted_at: null,
    submitted_by_name: null,
    review_status: null,
    items_total: null,
    items_done: null,
    flagged_count: 0,
    photo_count: 0,
    comment_count: 0,
    ...extra,
  }
}
const done = (time: string, doneN: number, total: number, flagged = 0, day = DAY): Partial<Row> => ({
  instance_id: crypto.randomUUID(), submitted_at: iso(time, day), submitted_by_name: 'Jane Doe', review_status: 'rm_audit',
  items_total: total, items_done: doneN, flagged_count: flagged,
})

const OPEN = 'Bay Attendant Checklist - Opening'
const MID = 'Management Checklist - Mid-day'
const CLOSE = 'Bay Attendant Checklist - Closing'
const WEEKLY = 'Weekly Store Cleaning & Maintenance - Wednesday'

const sites = ['MW01', 'MW05', 'MW12', 'MW16', 'MW22', 'MW27', 'MW31']
const today: Row[] = sites.flatMap((s, i) => [
  row(s, OPEN, '07:00', '09:00', i === 1 ? {} : done(i === 2 ? '09:20' : '08:10', i === 3 ? 11 : 13, 13, i === 3 ? 2 : 0)),
  row(s, MID, '13:00', '15:00', i === 4 ? {} : done('14:05', 14, 14, i === 0 ? 1 : 0)),
  row(s, CLOSE, '19:00', '21:00'),
  row(s, WEEKLY, '00:00', '24:00', i < 3 ? done('11:30', 4, 4) : {}),
])
const y = addDays(DAY, -1)
const lastNight: Row[] = [
  row('MW05', CLOSE, '19:00', '21:00', done('20:40', 14, 14, 0, y), y),
  row('MW12', CLOSE, '19:00', '21:00', {}, y),
]
const flagged: Flagged[] = [
  { location_name: 'MW16', checklist_name: OPEN, when: 'today', items: [
    { label: 'Clean the vacuum hoses', done: false, notes: [{ text: 'Hose cracked, new one ordered', by: 'Jane Doe' }] },
    { label: 'Restock towels', done: false, notes: [{ text: 'Out of towels <b>now</b>', by: 'Jane Doe' }] },
  ] },
  { location_name: 'MW01', checklist_name: MID, when: 'today', items: [
    { label: 'Check chemical levels', done: true, notes: [{ text: 'Done, but tire shine is low', by: null }] },
  ] },
]

const cutoff = at('20:00')
const out = buildHtml({ day: DAY, cutoff, today, lastNight, flagged, appUrl: 'https://operator.washlyfe.com' })

Deno.test('counts: missed today, missed last night, still open, flagged', () => {
  // MW05 Opening and MW22 Mid-day closed without a submission; last night MW12 Closing.
  assertEquals(out.counts.missed_today, 2)
  assertEquals(out.counts.missed_last_night, 1)
  // Every Closing (7 sites) plus the 4 sites without the all-day Weekly.
  assertEquals(out.counts.still_open, 11)
  assertEquals(out.counts.submitted, 6 + 6 + 3)
  assertEquals(out.counts.flagged_items, 3)
  assertEquals(out.counts.due, 28)
  assertEquals(out.subject, 'Checklists Wed, Nov 18: 3 not submitted')
})

Deno.test('the alert leads, by site, with its RM', () => {
  const alertAt = out.html.indexOf('3 checklists were not submitted')
  assert(alertAt > 0 && alertAt < out.html.indexOf('Every site, today'))
  assertStringIncludes(out.html, 'MW05 <span style="color:#6b7280;">(Matthew Canales)</span>')
  assertStringIncludes(out.html, 'Last night (Tue, Nov 17, still open at the last email)')
})

Deno.test('the table: short column names, late marks, missed cells, regions', () => {
  for (const label of ['Bay Opening', 'Mgmt Mid-day', 'Bay Closing', 'Weekly']) assertStringIncludes(out.html, `>${label}</th>`)
  assertStringIncludes(out.html, '&#10007; Missed')
  assertStringIncludes(out.html, 'late</span>')
  assertStringIncludes(out.html, 'Central Region <span style="font-weight:400;color:#6b7280;">· no RM</span>')
  // Regions in order, New Mexico before Permian.
  assert(out.html.indexOf('>Lubbock Region') < out.html.indexOf('>New Mexico Region'))
})

Deno.test('still open lists the closing checklist with its close time', () => {
  assertStringIncludes(out.html, `${CLOSE}: <b>7</b> sites not in yet (open until 9:00 PM)`)
})

Deno.test('comments are escaped, quoted, then who wrote them', () => {
  assertStringIncludes(out.html, '&ldquo;Out of towels &lt;b&gt;now&lt;/b&gt;&rdquo; <span style="color:#6b7280;">Jane Doe</span>')
  assertStringIncludes(out.html, '&ldquo;Done, but tire shine is low&rdquo;</div>')
})

Deno.test('all-day checklists are the last column, and close at midnight', () => {
  assert(out.html.indexOf('>Weekly</th>') > out.html.indexOf('>Bay Closing</th>'))
  assertStringIncludes(out.html, WEEKLY.replace('&', '&amp;') + ': <b>4</b> sites not in yet (open until midnight)')
})

Deno.test('no em dashes in the copy', () => {
  assert(!out.html.includes('—'))
})

Deno.test('nothing missed: a green line and a calm subject', () => {
  const clean = buildHtml({ day: DAY, cutoff: at('10:00'), today: today.filter((r) => r.submitted_at), lastNight: [], flagged: [], appUrl: 'x' })
  assertEquals(clean.counts.missed_today, 0)
  assertStringIncludes(clean.html, 'Every checklist that has closed so far was submitted.')
  assertEquals(clean.subject, 'Checklists Wed, Nov 18: all submitted so far')
})

const outFile = Deno.env.get('CHECKLIST_EMAIL_OUT')
if (outFile) Deno.writeTextFileSync(outFile, out.html)
