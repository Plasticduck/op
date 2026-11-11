import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Dices, KeyRound, Loader2, Pencil, Plus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { secretShoppers, type ManagedShopper } from '@/lib/queries/secretShoppers'

// Add secret shoppers and give each one a PIN. PINs are stored hashed, so a
// PIN shows once, right after it's set; after that it can only be replaced.

type Draft = { id?: string; name: string; phone: string; email: string; pin: string; active: boolean }
const blank: Draft = { name: '', phone: '', email: '', pin: '', active: true }

const randomPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')

export function ManageShoppersModal({ onClose }: { onClose: () => void }) {
  const [shoppers, setShoppers] = useState<ManagedShopper[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shownPin, setShownPin] = useState<{ name: string; pin: string } | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await secretShoppers.listShoppers()
    setShoppers(data ?? [])
    setLoadError(err)
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft || saving) return
    setSaving(true)
    setError(null)
    const { error: err } = await secretShoppers.saveShopper({
      id: draft.id,
      name: draft.name,
      phone: draft.phone,
      email: draft.email,
      pin: draft.pin,
      active: draft.id ? draft.active : undefined,
    })
    setSaving(false)
    if (err) { setError(err); return }
    setShownPin(draft.pin ? { name: draft.name.trim(), pin: draft.pin } : null)
    setDraft(null)
    void load()
  }

  const edit = (s: ManagedShopper) => {
    setShownPin(null)
    setError(null)
    setDraft({ id: s.id, name: s.name, phone: s.phone ?? '', email: s.email ?? '', pin: '', active: s.active })
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Shoppers and PINs" description="Each secret shopper signs in with their own PIN. Reports show their name.">
      {shownPin && (
        <div className="mb-4 rounded-lg border border-ok/40 bg-ok-soft px-4 py-3 text-sm text-ink">
          <div className="font-semibold text-ok">Saved</div>
          <div className="mt-1">
            {shownPin.name}'s PIN is <span className="font-mono text-base font-semibold tracking-widest">{shownPin.pin}</span>.
            Give it to them now: it can't be shown again, only replaced.
          </div>
        </div>
      )}

      {draft ? (
        <form onSubmit={(e) => void save(e)} className="space-y-3 rounded-lg border border-border bg-content p-4">
          <div className="text-sm font-semibold text-ink">{draft.id ? 'Edit shopper' : 'New shopper'}</div>
          <div>
            <label htmlFor="ms-name" className="mb-1 block text-sm font-medium text-ink">Name</label>
            <Input id="ms-name" value={draft.name} maxLength={100} autoFocus
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ms-phone" className="mb-1 block text-sm font-medium text-ink">Phone <span className="font-normal text-ink-subtle">(optional)</span></label>
              <Input id="ms-phone" type="tel" value={draft.phone} maxLength={40}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </div>
            <div>
              <label htmlFor="ms-email" className="mb-1 block text-sm font-medium text-ink">Email <span className="font-normal text-ink-subtle">(optional)</span></label>
              <Input id="ms-email" type="email" value={draft.email} maxLength={200}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </div>
          </div>
          <div>
            <label htmlFor="ms-pin" className="mb-1 block text-sm font-medium text-ink">
              {draft.id ? 'New PIN' : 'PIN'} <span className="font-normal text-ink-subtle">{draft.id ? '(leave blank to keep the current one)' : '(4 to 8 digits)'}</span>
            </label>
            <div className="flex gap-2">
              <Input id="ms-pin" inputMode="numeric" autoComplete="off" value={draft.pin} maxLength={8}
                className="font-mono tracking-widest sm:max-w-[12rem]"
                onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
              <Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, pin: randomPin() })}>
                <Dices className="size-4" /> Make one up
              </Button>
            </div>
          </div>
          {draft.id && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                className="size-4 rounded border-border accent-accent" />
              Active (can sign in with their PIN)
            </label>
          )}
          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setDraft(null); setError(null) }}>Cancel</Button>
            <Button type="submit" disabled={saving || !draft.name.trim() || (!draft.id && draft.pin.length < 4) || (draft.pin.length > 0 && draft.pin.length < 4)}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Save
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={() => { setShownPin(null); setError(null); setDraft({ ...blank }) }}>
          <Plus className="size-4" /> Add shopper
        </Button>
      )}

      <div className="mt-5">
        {loadError && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{loadError}</p>}
        {shoppers === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Loading…</div>
        ) : shoppers.length === 0 && !loadError ? (
          <p className="py-6 text-center text-sm text-ink-muted">No shoppers yet. Add one to hand out their first PIN.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {shoppers.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{s.name}</span>
                    {!s.active && <Badge tone="neutral">Off</Badge>}
                  </div>
                  <div className="truncate text-xs text-ink-muted">
                    {[s.phone, s.email].filter(Boolean).join(' · ') || 'No contact info'}
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {s.reports} report{s.reports === 1 ? '' : 's'}
                    {' · '}
                    {s.last_sign_in_at ? `last signed in ${formatDistanceToNow(new Date(s.last_sign_in_at), { addSuffix: true })}` : 'never signed in'}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => edit(s)} aria-label={`Edit ${s.name}`}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
