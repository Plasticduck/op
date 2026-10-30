import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleCheck, Loader2, Plus, Send, TriangleAlert, X } from 'lucide-react'
import { BarcodeScanner } from '@/components/scan/BarcodeScanner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { itInventory } from '@/lib/queries/itInventory'
import { parseScan, TAG_RE } from './scan'

// Full-screen sticker scanner. A sticker on a device opens it; a blank
// pre-printed sticker opens Add with the tag filled in; a tag we don't know
// offers to add it or report it; another company's sticker is turned away.
// Typing the tag works the same way, for stickers too damaged to scan.

type Outcome =
  | { kind: 'unknown'; tag: string }
  | { kind: 'other' }
  | { kind: 'not_ours' }
  | { kind: 'no_access'; tag: string; site: string | null }
  | { kind: 'reported' }
  | { kind: 'added'; tag: string; already: boolean }
  | { kind: 'blank'; tag: string }

// Collect mode: each scanned item is added to a selection (bulk check-out,
// status, move) instead of opening it. `onAdd` returns false if it was
// already selected.
export type ScanCollect = { onAdd: (assetId: string, tag: string) => boolean; count: number }

export function ScanSheet({ onClose, collect }: { onClose: () => void; collect?: ScanCollect }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { activeLocation } = useLocations()
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [reportText, setReportText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const staff = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'technician'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const resolve = useCallback(async (raw: string) => {
    setError(null)
    setReportText(null)
    const p = parseScan(raw)
    if (!p) { setOutcome({ kind: 'not_ours' }); return }
    setBusy(true)
    const res = await itInventory.resolveTag(p.short, p.tag)
    setBusy(false)
    if (res?.result === 'asset' && collect) {
      setOutcome({ kind: 'added', tag: res.tag, already: !collect.onAdd(res.asset_id, res.tag) })
      return
    }
    if (res?.result === 'unused' && collect) { setOutcome({ kind: 'blank', tag: res.tag ?? p.tag }); return }
    if (res?.result === 'asset') { onClose(); navigate(`/app/it-inventory/${res.asset_id}`); return }
    if (res?.result === 'unused') { onClose(); navigate(`/app/it-inventory?add=1&tag=${encodeURIComponent(res.tag ?? p.tag)}`); return }
    if (res?.result === 'other_account') setOutcome({ kind: 'other' })
    else if (res?.result === 'no_access') setOutcome({ kind: 'no_access', tag: res.tag, site: res.site })
    else setOutcome({ kind: 'unknown', tag: p.tag })
  }, [navigate, onClose, collect])

  const reportUnknown = async (tag: string) => {
    if (!activeLocation || !reportText?.trim()) return
    setBusy(true)
    const { message } = await itInventory.reportUnknownSticker({ tag, description: reportText.trim(), location_id: activeLocation.id })
    setBusy(false)
    if (message) setError(message)
    else { setReportText(null); setOutcome({ kind: 'reported' }) }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-shell" role="dialog" aria-modal="true" aria-label="Scan a sticker">
      <div className="flex items-center justify-between px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] text-ink-invert">
        <h2 className="text-base font-semibold">{collect ? 'Scan to select' : 'Scan a sticker'}</h2>
        {collect ? (
          <Button size="sm" onClick={onClose}>Done ({collect.count})</Button>
        ) : (
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full hover:bg-shell-elevated">
            <X className="size-5" />
          </button>
        )}
      </div>

      <BarcodeScanner className="min-h-0 flex-1" continuous onDetect={resolve} />

      <div className="rounded-t-xl bg-card px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
        {busy && <p className="mb-3 flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Looking it up...</p>}
        {outcome && !busy && (
          <div className="mb-4">
            {outcome.kind === 'unknown' && (
              <div className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
                <p className="flex items-start gap-2 font-medium"><TriangleAlert className="mt-0.5 size-4 shrink-0" /> {outcome.tag} isn't in your inventory.</p>
                {reportText === null ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {staff && TAG_RE.test(outcome.tag) && (
                      <Button size="sm" onClick={() => { onClose(); navigate(`/app/it-inventory?add=1&tag=${encodeURIComponent(outcome.tag)}`) }}>
                        <Plus className="size-4" /> Add it with this tag
                      </Button>
                    )}
                    {activeLocation && <Button size="sm" variant="secondary" onClick={() => setReportText('')}>Report it</Button>}
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <textarea value={reportText} onChange={(e) => setReportText(e.target.value)} rows={2} autoFocus
                      placeholder={`What is it, and where is it at ${activeLocation?.name ?? 'the site'}?`}
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
                    <Button size="sm" onClick={() => void reportUnknown(outcome.tag)} disabled={!reportText.trim()}>
                      <Send className="size-4" /> Send to the team
                    </Button>
                  </div>
                )}
              </div>
            )}
            {outcome.kind === 'other' && (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">This sticker belongs to another company. It isn't in your inventory.</p>
            )}
            {outcome.kind === 'not_ours' && (
              <p className="rounded-md bg-content px-3 py-2 text-sm text-ink-muted">That code isn't an Operator sticker. Try the sticker with the tag printed on it.</p>
            )}
            {outcome.kind === 'no_access' && (
              <p className="rounded-md bg-content px-3 py-2 text-sm text-ink-muted">
                That's {outcome.tag}{outcome.site ? ` at ${outcome.site}` : ''}. You don't have access to that site.
              </p>
            )}
            {outcome.kind === 'added' && (
              <p className="flex items-center gap-2 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
                <CircleCheck className="size-4" />
                {outcome.already ? `${outcome.tag} is already selected.` : `Added ${outcome.tag}. ${collect?.count ?? 0} selected. Scan the next one.`}
              </p>
            )}
            {outcome.kind === 'blank' && (
              <p className="rounded-md bg-content px-3 py-2 text-sm text-ink-muted">{outcome.tag} is a blank sticker. Add it to the inventory first.</p>
            )}
            {outcome.kind === 'reported' && (
              <p className="flex items-center gap-2 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok"><CircleCheck className="size-4" /> Sent. It's in Work Requests.</p>
            )}
            {error && <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) void resolve(manual) }} className="flex gap-2">
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Sticker damaged? Type the tag"
            aria-label="Type a tag" className="font-mono uppercase" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
          <Button type="submit" disabled={!manual.trim() || busy}>Go</Button>
        </form>
      </div>
    </div>
  )
}
