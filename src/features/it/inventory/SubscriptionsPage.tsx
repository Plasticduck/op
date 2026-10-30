import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarCheck, Download, Loader2, Plus, Receipt, Search, Trash2, Upload, X } from 'lucide-react'
import { StatCardRow } from '@/components/data/StatCardRow'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { downloadCsv } from '@/lib/csv'
import { currency } from '@/lib/format'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import { itInventory, type ItPerson, type ItSubscriptionRow, type SearchHit } from '@/lib/queries/itInventory'
import { daysUntil, fmtDay, friendlyError } from './format'
import { SectionNav } from './SectionNav'
import { actBy, cancelBy, CYCLE_SHORT, CYCLES, monthlyCost, nextRenewal, RENEWAL_WINDOW_DAYS, renewalBadge } from './subscriptions'
import { useItRefs, type ItRefs } from './useItRefs'

// Subscriptions: the recurring IT bills (internet circuits, cellular backup,
// POS and LPR software, camera cloud, signage). What each costs a month, when
// it renews, and the last day to cancel when it renews by itself. One can
// cover every site, and can list the devices it covers. Reminders go out
// before the cancel-by date (it-reminders).

type LinkedAsset = { id: string; asset_tag: string; name: string }

export function SubscriptionsPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const { refs, error: refsError, reload: reloadRefs } = useItRefs()
  const [params, setParams] = useSearchParams()
  const site = params.get('site') ?? (locations.length > 1 ? 'all' : activeLocation?.id ?? 'all')
  const due = params.get('due') === '1'
  const q = params.get('q') ?? ''
  const openId = params.get('id')
  const [rows, setRows] = useState<ItSubscriptionRow[] | null>(null)
  const [linked, setLinked] = useState<Map<string, LinkedAsset>>(new Map())
  const [people, setPeople] = useState<ItPerson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const admin = profile?.role === 'owner'
  const staff = admin || profile?.role === 'manager' || profile?.role === 'technician'
  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])

  const load = useCallback(async () => {
    const { data, error: err } = await itInventory.subscriptions()
    if (err) setError(err.message)
    setRows(data)
    // Tags and names of the devices they cover, for the form and the export.
    const ids = [...new Set(data.flatMap((s) => s.links.map((l) => l.asset_id)))]
    const found = new Map<string, LinkedAsset>()
    for (let i = 0; i < ids.length; i += 150) {
      const { data: assets } = await itInventory.assetsByIds(ids.slice(i, i + 150))
      for (const a of assets ?? []) found.set(a.id, a)
    }
    setLinked(found)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void itInventory.people().then(({ data }) => setPeople((data as ItPerson[] | null) ?? []))
  }, [])

  const setParam = (patch: Record<string, string | null>) => setParams((p) => {
    const next = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    return next
  }, { replace: true })

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (rows ?? [])
      .filter((s) => site === 'all' || (site === 'every' ? s.location_id === null : s.location_id === site))
      .filter((s) => {
        if (!due) return true
        const d = actBy(s)
        return !!d && daysUntil(d) >= 0 && daysUntil(d) <= RENEWAL_WINDOW_DAYS
      })
      .filter((s) => {
        if (!words.length) return true
        const hay = [s.name, s.account_number, s.notes, s.supplier_id ? refs?.supplier.get(s.supplier_id)?.name : ''].join(' ').toLowerCase()
        return words.every((w) => hay.includes(w))
      })
      .sort((a, b) => {
        const da = actBy(a) ?? '9999-12-31'
        const db = actBy(b) ?? '9999-12-31'
        // Upcoming first, then the rest by date; past dates sink to the end.
        const pa = daysUntil(da) < 0 ? 1 : 0
        const pb = daysUntil(db) < 0 ? 1 : 0
        return pa - pb || da.localeCompare(db) || a.name.localeCompare(b.name)
      })
  }, [rows, site, due, q, refs])

  const monthly = shown.reduce((sum, s) => sum + (monthlyCost(s) ?? 0), 0)
  const dueCount = shown.filter((s) => {
    const d = actBy(s)
    return !!d && daysUntil(d) >= 0 && daysUntil(d) <= RENEWAL_WINDOW_DAYS
  }).length
  const editing = openId ? rows?.find((s) => s.id === openId) ?? null : null
  const where = (s: ItSubscriptionRow) => (s.location_id ? siteName.get(s.location_id) ?? 'Another site' : 'Every site')

  const exportCsv = () => {
    const header = ['Name', 'Site', 'Provider', 'Account number', 'Seats', 'Cost', 'Billing', 'Per month', 'Start date',
      'Renewal date', 'Renews by itself', 'Cancel notice days', 'Cancel by', 'Owner', 'Devices', 'Notes']
    downloadCsv(`it-subscriptions-${new Date().toISOString().slice(0, 10)}`, [header, ...shown.map((s) => [
      s.name, where(s), s.supplier_id ? refs?.supplier.get(s.supplier_id)?.name ?? '' : '', s.account_number ?? '', s.seats ?? '',
      s.cost ?? '', CYCLES.find((c) => c.key === s.billing_cycle)?.label ?? s.billing_cycle, monthlyCost(s)?.toFixed(2) ?? '',
      s.start_date ?? '', s.renewal_date ?? '', s.auto_renew ? 'Yes' : 'No', s.cancel_notice_days ?? '', cancelBy(s) ?? '',
      people.find((p) => p.id === s.owner_user_id)?.name ?? '', s.links.map((l) => linked.get(l.asset_id)?.asset_tag ?? '').filter(Boolean).join(' '),
      s.notes ?? '',
    ])])
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="IT Inventory"
        subtitle="Recurring IT bills: internet, software and services. What they cost and when to act."
        actions={staff ? (
          <>
            <Button variant="secondary" onClick={() => navigate('/app/it-inventory/import?what=subscriptions')} className="hidden sm:inline-flex">
              <Upload className="size-4" /> Import
            </Button>
            <Button onClick={() => setAdding(true)} disabled={!refs}><Plus className="size-4" /> Add subscription</Button>
          </>
        ) : undefined}
      />
      <SectionNav className="mt-4" />

      {flash && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
        </div>
      )}
      {(error || refsError) && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Couldn't load subscriptions: {friendlyError(error ?? refsError ?? '')}</p>}

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setParam({ q: e.target.value })} className="pl-9" placeholder="Search name, provider, account number" aria-label="Search subscriptions" />
        </div>
        <Select value={site} onChange={(e) => setParam({ site: e.target.value })} aria-label="Site">
          <option value="all">All sites</option>
          <option value="every">Every-site subscriptions</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <div className="flex gap-2">
          <Button variant={due ? 'primary' : 'secondary'} onClick={() => setParam({ due: due ? null : '1' })} className="flex-1 sm:flex-none">
            <CalendarCheck className="size-4" /> Due in {RENEWAL_WINDOW_DAYS} days
          </Button>
          {shown.length > 0 && (
            <Button variant="secondary" onClick={exportCsv} aria-label="Export to CSV" title="Export to CSV"><Download className="size-4" /></Button>
          )}
        </div>
      </div>

      {rows === null || !refs ? (
        !error && <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <EmptyState className="mt-6" icon={Receipt} title="No subscriptions yet"
          description="Add the monthly and yearly IT bills, like each site's internet, the POS software and the camera cloud, to see what they cost and get a reminder before the last day to cancel."
          action={staff ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add subscription</Button>
              <Button variant="secondary" onClick={() => navigate('/app/it-inventory/import?what=subscriptions')}><Upload className="size-4" /> Import a spreadsheet</Button>
            </div>
          ) : undefined} />
      ) : (
        <>
          <StatCardRow
            className="mt-4 grid-cols-3"
            items={[
              { label: 'Per month', value: currency(monthly) },
              { label: 'Per year', value: currency(monthly * 12) },
              { label: `Due in ${RENEWAL_WINDOW_DAYS} days`, value: dueCount },
            ]}
          />
          {shown.length === 0 ? (
            <p className="mt-4 rounded-md border border-border bg-card p-4 text-sm text-ink-muted">Nothing matches. Try All sites, or clear the search.</p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="hidden bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle md:table-header-group">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Subscription</th>
                    <th className="px-3 py-2 font-semibold">Site</th>
                    <th className="px-3 py-2 text-right font-semibold">Cost</th>
                    <th className="px-3 py-2 font-semibold">Renews</th>
                    <th className="px-3 py-2 font-semibold">Next step</th>
                    <th className="px-3 py-2 text-right font-semibold">Devices</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((s) => {
                    const badge = renewalBadge(s)
                    const cb = cancelBy(s)
                    const provider = s.supplier_id ? refs.supplier.get(s.supplier_id)?.name : null
                    const m = monthlyCost(s)
                    return (
                      <tr key={s.id} onClick={() => setParam({ id: s.id })} className="cursor-pointer hover:bg-content">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-ink">{s.name}</div>
                          <div className="text-xs text-ink-muted">
                            {[provider, s.account_number && `Acct ${s.account_number}`].filter(Boolean).join(' · ') || ' '}
                          </div>
                          {/* Phones: the other columns fold in here. */}
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted md:hidden">
                            <span>{where(s)}</span>
                            {s.cost != null && <span className="tabular-nums text-ink">{currency(s.cost)}{CYCLE_SHORT[s.billing_cycle] ?? ''}</span>}
                            {s.renewal_date && <span>Renews {fmtDay(s.renewal_date)}</span>}
                            {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                          </div>
                        </td>
                        <td className="hidden px-3 py-2.5 text-ink md:table-cell">{where(s)}</td>
                        <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">
                          {s.cost != null ? <span className="text-ink">{currency(s.cost)}{CYCLE_SHORT[s.billing_cycle] ?? ''}</span> : <span className="text-ink-subtle">–</span>}
                          {m != null && s.billing_cycle !== 'monthly' && <div className="text-xs text-ink-muted">{currency(m)}/mo</div>}
                        </td>
                        <td className="hidden px-3 py-2.5 md:table-cell">
                          {s.renewal_date ? <span className="text-ink">{fmtDay(s.renewal_date)}</span> : <span className="text-ink-subtle">–</span>}
                          {cb && <div className="text-xs text-ink-muted">Cancel by {fmtDay(cb)}</div>}
                        </td>
                        <td className="hidden px-3 py-2.5 md:table-cell">{badge && <Badge tone={badge.tone}>{badge.label}</Badge>}</td>
                        <td className="hidden px-3 py-2.5 text-right tabular-nums text-ink-muted md:table-cell">{s.links.length || '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {refs && (adding || editing) && (
        <SubscriptionForm
          key={editing?.id ?? 'new'}
          refs={refs}
          sub={editing}
          defaultSite={site !== 'all' && site !== 'every' ? site : activeLocation?.id ?? ''}
          people={people}
          linked={linked}
          canEdit={staff && (!!editing?.location_id || admin || !editing)}
          admin={admin}
          onRefsChanged={() => void reloadRefs()}
          onClose={() => { setAdding(false); setParam({ id: null }) }}
          onSaved={(m) => { setAdding(false); setParam({ id: null }); setFlash(m); void load() }}
        />
      )}
    </div>
  )
}

type Form = {
  name: string
  location_id: string // '' = every site
  category_id: string
  supplier: string
  account_number: string
  seats: string
  cost: string
  billing_cycle: string
  start_date: string
  renewal_date: string
  auto_renew: boolean
  cancel_notice_days: string
  owner_user_id: string
  notes: string
}

function SubscriptionForm({ refs, sub, defaultSite, people, linked, canEdit, admin, onRefsChanged, onClose, onSaved }: {
  refs: ItRefs
  sub: ItSubscriptionRow | null
  defaultSite: string
  people: ItPerson[]
  linked: Map<string, LinkedAsset>
  canEdit: boolean
  admin: boolean
  onRefsChanged: () => void
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const [form, setForm] = useState<Form>(() => ({
    name: sub?.name ?? '',
    location_id: sub ? sub.location_id ?? '' : defaultSite,
    category_id: sub?.category_id ?? '',
    supplier: sub?.supplier_id ? refs.supplier.get(sub.supplier_id)?.name ?? '' : '',
    account_number: sub?.account_number ?? '',
    seats: sub?.seats != null ? String(sub.seats) : '',
    cost: sub?.cost != null ? String(sub.cost) : '',
    billing_cycle: sub?.billing_cycle ?? 'monthly',
    start_date: sub?.start_date ?? '',
    renewal_date: sub?.renewal_date ?? '',
    auto_renew: sub?.auto_renew ?? true,
    cancel_notice_days: sub?.cancel_notice_days != null ? String(sub.cancel_notice_days) : '',
    owner_user_id: sub?.owner_user_id ?? '',
    notes: sub?.notes ?? '',
  }))
  const current = useMemo(() => sub?.links.map((l) => l.asset_id) ?? [], [sub])
  const [devices, setDevices] = useState<LinkedAsset[]>(() => current.map((id) => linked.get(id)).filter((a): a is LinkedAsset => !!a))
  const [find, setFind] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'remove' | 'renewed'>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const categories = refs.categories.filter((c) => c.kind === 'subscription')
  const cancelDate = cancelBy({ renewal_date: form.renewal_date || null, auto_renew: form.auto_renew, cancel_notice_days: Number(form.cancel_notice_days) || null })
  const next = sub ? nextRenewal(sub) : null

  // Device search, for "covers these devices".
  useEffect(() => {
    const term = find.trim()
    if (term.length < 2) { setHits([]); return }
    let alive = true
    const t = window.setTimeout(() => {
      void itInventory.search(term, 6).then(({ data }) => { if (alive) setHits((data as SearchHit[] | null) ?? []) })
    }, 200)
    return () => { alive = false; window.clearTimeout(t) }
  }, [find])

  const save = async () => {
    if (!profile) return
    if (!form.name.trim()) { setError('Give it a name, like "Spectrum internet".'); return }
    const cost = form.cost.trim() ? Number(form.cost.replace(/[$,]/g, '')) : null
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) { setError('Cost should be a dollar amount.'); return }
    const seats = form.seats.trim() ? Number(form.seats) : null
    if (seats !== null && (!Number.isInteger(seats) || seats < 1)) { setError('Seats should be a whole number.'); return }
    const notice = form.cancel_notice_days.trim() ? Number(form.cancel_notice_days) : null
    if (notice !== null && (!Number.isInteger(notice) || notice < 0)) { setError('Notice should be a number of days.'); return }
    setBusy(true)
    setError(null)
    try {
      let supplierId: string | null = null
      const spText = form.supplier.trim()
      if (spText) {
        const existing = refs.suppliers.find((s) => s.name.toLowerCase() === spText.toLowerCase())
        if (existing) supplierId = existing.id
        else {
          const { data, error: err } = await itInventory.addSupplier(profile.account_id, spText)
          if (err) throw new Error(err.message)
          supplierId = data.id
          onRefsChanged()
        }
      }
      const { data, error: err } = await itInventory.saveSubscription({
        ...(sub ? { id: sub.id } : {}),
        account_id: profile.account_id,
        location_id: form.location_id || null,
        name: form.name.trim(),
        category_id: form.category_id || null,
        supplier_id: supplierId,
        account_number: form.account_number.trim() || null,
        seats,
        cost,
        billing_cycle: form.billing_cycle,
        start_date: form.start_date || null,
        renewal_date: form.renewal_date || null,
        auto_renew: form.auto_renew,
        cancel_notice_days: form.auto_renew ? notice : null,
        owner_user_id: form.owner_user_id || null,
        notes: form.notes.trim() || null,
      })
      if (err) throw new Error(err.message)
      const linkErr = await itInventory.setSubscriptionAssets(profile.account_id, data.id, devices.map((d) => d.id), current)
      if (linkErr) throw new Error(linkErr)
      onSaved(sub ? `Saved ${form.name.trim()}.` : `Added ${form.name.trim()}.`)
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)))
      setBusy(false)
    }
  }

  const markRenewed = async () => {
    if (!sub || !next) return
    setBusy(true)
    const { error: err } = await itInventory.saveSubscription({ id: sub.id, account_id: sub.account_id, name: sub.name, renewal_date: next })
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); setConfirm(null); return }
    onSaved(`${sub.name} now renews ${fmtDay(next)}.`)
  }

  const remove = async () => {
    if (!sub) return
    setBusy(true)
    const { error: err } = await itInventory.removeSubscription(sub.id)
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); setConfirm(null); return }
    onSaved(`Removed ${sub.name}.`)
  }

  const ro = !canEdit
  return (
    <Modal open onClose={onClose} size="lg" title={sub ? sub.name : 'Add a subscription'}
      description={sub ? undefined : 'A recurring IT bill: internet, software or a service.'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          {(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} disabled={ro} placeholder="Spectrum internet" />}
        </Field>
        <Field label="Site" hint={admin ? undefined : 'Only an admin can add one for every site.'}>
          {(id) => (
            <Select id={id} value={form.location_id} onChange={(e) => set('location_id', e.target.value)} disabled={ro}>
              {(admin || form.location_id === '') && <option value="">Every site</option>}
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={form.category_id} onChange={(e) => set('category_id', e.target.value)} disabled={ro}>
              <option value="">Choose one</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Provider">
          {(id) => (
            <>
              <Input id={id} list="it-sub-providers" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} autoComplete="off" disabled={ro} placeholder="Spectrum" />
              <datalist id="it-sub-providers">{refs.suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </>
          )}
        </Field>
        <Field label="Account number">
          {(id) => <Input id={id} value={form.account_number} onChange={(e) => set('account_number', e.target.value)} disabled={ro} className="font-mono" />}
        </Field>
        <Field label="Cost">
          {(id) => <Input id={id} value={form.cost} onChange={(e) => set('cost', e.target.value)} inputMode="decimal" placeholder="$0.00" disabled={ro} />}
        </Field>
        <Field label="Billed">
          {(id) => (
            <Select id={id} value={form.billing_cycle} onChange={(e) => set('billing_cycle', e.target.value)} disabled={ro}>
              {CYCLES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Started">
          {(id) => <Input id={id} type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} disabled={ro} />}
        </Field>
        <Field label={form.auto_renew ? 'Renews on' : 'Ends on'}>
          {(id) => <Input id={id} type="date" value={form.renewal_date} onChange={(e) => set('renewal_date', e.target.value)} disabled={ro} />}
        </Field>
        <label className="flex items-center gap-2.5 text-sm text-ink sm:col-span-2">
          <input type="checkbox" checked={form.auto_renew} onChange={(e) => set('auto_renew', e.target.checked)} disabled={ro}
            className="size-4 rounded border-border text-accent focus:ring-accent" />
          Renews by itself unless we cancel
        </label>
        {form.auto_renew && (
          <Field label="Notice to cancel (days)" hint={cancelDate ? `Last day to cancel: ${fmtDay(cancelDate)}. Reminders count down to it.` : 'From the contract, like 30 or 60.'}>
            {(id) => <Input id={id} type="number" min={0} value={form.cancel_notice_days} onChange={(e) => set('cancel_notice_days', e.target.value)} disabled={ro} />}
          </Field>
        )}
        <Field label="Seats or lines" hint="Optional.">
          {(id) => <Input id={id} type="number" min={1} value={form.seats} onChange={(e) => set('seats', e.target.value)} disabled={ro} />}
        </Field>
        <Field label="Owner" hint="Gets its reminders too.">
          {(id) => (
            <Select id={id} value={form.owner_user_id} onChange={(e) => set('owner_user_id', e.target.value)} disabled={ro}>
              <option value="">No one in particular</option>
              {people.filter((p) => p.role !== 'employee').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          {(id) => (
            <textarea id={id} value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} disabled={ro}
              placeholder="Contract terms, who to call, the plan name"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
          )}
        </Field>

        <div className="sm:col-span-2">
          <div className="mb-1.5 text-sm font-medium text-ink">Devices it covers</div>
          {devices.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {devices.map((d) => (
                <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-content px-2.5 py-1 text-xs text-ink">
                  <span className="font-mono text-ink-muted">{d.asset_tag}</span> {d.name}
                  {!ro && (
                    <button type="button" onClick={() => setDevices((ds) => ds.filter((x) => x.id !== d.id))} aria-label={`Remove ${d.asset_tag}`}
                      className="text-ink-subtle hover:text-ink"><X className="size-3" /></button>
                  )}
                </span>
              ))}
            </div>
          )}
          {!ro && (
            <div className="relative">
              <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a device by tag, name or serial" aria-label="Find a device" />
              {hits.length > 0 && (
                <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-md">
                  {hits.filter((h) => !devices.some((d) => d.id === h.id)).map((h) => (
                    <li key={h.id}>
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-content"
                        onClick={() => { setDevices((ds) => [...ds, { id: h.id, asset_tag: h.asset_tag, name: h.name }]); setFind(''); setHits([]) }}>
                        <span className="font-mono text-xs text-ink-muted">{h.asset_tag}</span>
                        <span className="min-w-0 flex-1 truncate text-ink">{h.name}</span>
                        <span className="text-xs text-ink-subtle">{h.site}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {ro && devices.length === 0 && <p className="text-sm text-ink-subtle">None listed.</p>}
        </div>
      </div>

      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
        {sub && admin && (
          <Button variant="ghost" className={cn('text-danger sm:mr-auto')} onClick={() => setConfirm('remove')} disabled={busy}>
            <Trash2 className="size-4" /> Remove
          </Button>
        )}
        {sub && canEdit && next && (
          <Button variant="secondary" onClick={() => setConfirm('renewed')} disabled={busy} className={cn(!admin && 'sm:mr-auto')}>
            <CalendarCheck className="size-4" /> Mark renewed
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} disabled={busy}>{ro ? 'Close' : 'Cancel'}</Button>
        {!ro && (
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} {sub ? 'Save' : 'Add subscription'}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'renewed'}
        title={`Mark ${sub?.name ?? ''} renewed?`}
        description={next ? `The renewal date moves one billing cycle, to ${fmtDay(next)}, and reminders start over for the new date.` : ''}
        confirmLabel="Mark renewed"
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void markRenewed()}
      />
      <ConfirmDialog
        open={confirm === 'remove'}
        title={`Remove ${sub?.name ?? ''}?`}
        description="For a subscription you've canceled or added by mistake. It leaves the list and stops reminders. Its history stays in the activity log."
        confirmLabel="Remove"
        destructive
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void remove()}
      />
    </Modal>
  )
}
