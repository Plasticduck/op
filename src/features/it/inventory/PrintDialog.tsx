import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { Loader2, Printer } from 'lucide-react'
import { PdfPagePreview } from '@/components/data/PdfPagePreview'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { buildLabelsPdf } from '@/lib/labels/labelPdf'
import { labelsPerPage } from '@/lib/labels/layout'
import { useLocations } from '@/lib/locations'
import { itInventory, type ItAssetRow, type ItTag } from '@/lib/queries/itInventory'
import { assetLabel, blankLabel, defaultTemplateFor, accountDefaultTemplate, toPrintTemplate, walkOrder } from './stickers'
import type { ItRefs } from './useItRefs'

// Print stickers for some assets, or blank tags from the pool. The preview is
// the real PDF's first page. The PDF downloads; printing it at 100% is what
// makes it line up (calibration lives in Printer setup).

export function PrintDialog({
  refs,
  assets,
  tags,
  siteId,
  onClose,
  onPrinted,
}: {
  refs: ItRefs
  assets?: ItAssetRow[]
  tags?: ItTag[]
  // The site blank tags are for, so they count against its sticker stock.
  siteId?: string | null
  onClose: () => void
  onPrinted: (message: string) => void
}) {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])
  const ordered = useMemo(() => (assets ? walkOrder(assets, refs, siteName) : []), [assets, refs, siteName])
  const items = useMemo(
    () => (assets ? ordered.map((a) => assetLabel(a, refs, siteName)) : (tags ?? []).map((t) => blankLabel(t.tag, refs))),
    [assets, ordered, tags, refs, siteName],
  )
  const [templateId, setTemplateId] = useState(() => (assets ? defaultTemplateFor(assets, refs) : accountDefaultTemplate(refs))?.id ?? '')
  const [copies, setCopies] = useState('1')
  const [startAt, setStartAt] = useState('1')
  const [preview, setPreview] = useState<ArrayBuffer | null>(null)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const row = refs.templates.find((t) => t.id === templateId)
  const tpl = row ? toPrintTemplate(row) : null
  const sheet = !!tpl?.page_spec.page
  const per = tpl ? labelsPerPage(tpl.page_spec) : 1
  const nCopies = Math.max(1, Math.min(3, Number(copies) || 1))
  const start = sheet ? Math.max(0, Math.min(per - 1, (Number(startAt) || 1) - 1)) : 0
  const total = items.length * nCopies
  const pages = sheet ? Math.ceil((total + start) / per) : total

  // Preview just the first page (fast even for a few hundred stickers).
  useEffect(() => {
    if (!tpl || !items.length) return
    let alive = true
    const firstPage = sheet ? items.slice(0, Math.ceil((per - start) / nCopies)) : items.slice(0, 1)
    const id = window.setTimeout(() => {
      void buildLabelsPdf(tpl, firstPage, { copies: nCopies, startAt: start }).then(({ doc }) => {
        if (alive) setPreview(doc.output('arraybuffer'))
      })
    }, 120)
    return () => { alive = false; window.clearTimeout(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, nCopies, start, items])

  const print = async () => {
    if (!tpl || !row || !profile) return
    setPrinting(true)
    setError(null)
    try {
      const { doc, labels } = await buildLabelsPdf(tpl, items, { copies: nCopies, startAt: start })
      doc.save(`stickers-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`)
      const sites = new Set(ordered.map((a) => a.location_id))
      const { error: err } = await itInventory.recordPrint({
        account_id: profile.account_id,
        template_id: row.id,
        location_id: assets ? (sites.size === 1 ? [...sites][0] : null) : siteId ?? null,
        asset_ids: ordered.map((a) => a.id),
        tag_ids: (tags ?? []).map((t) => t.id),
        quantity: labels,
        copies: nCopies,
        printed_by: profile.id,
      })
      if (err) throw new Error(err.message)
      onPrinted(`Your ${labels} sticker${labels === 1 ? '' : 's'} downloaded as a PDF. Print it at 100% (Actual size).`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPrinting(false)
    }
  }

  const what = assets
    ? assets.length === 1 ? `${assets[0].asset_tag} ${assets[0].name}` : `${assets.length} items`
    : `${tags?.length ?? 0} blank tags`

  return (
    <Modal open onClose={onClose} size="lg" title="Print stickers" description={what}>
      <div className="grid gap-5 sm:grid-cols-[1fr_240px]">
        <div className="order-2 space-y-3 sm:order-1">
          <Field label="Sticker stock">
            {(id) => (
              <Select id={id} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {refs.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
          </Field>
          {assets && (
            <Field label="Stickers per item" hint="2 puts a matching sticker on the shelf or cable too. Same tag.">
              {(id) => (
                <Select id={id} value={copies} onChange={(e) => setCopies(e.target.value)}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </Select>
              )}
            </Field>
          )}
          {sheet && (
            <Field label="Start at label" hint={`For a sheet you've already used part of. 1 is top left, ${per} is bottom right.`}>
              {(id) => <Input id={id} type="number" min={1} max={per} inputMode="numeric" value={startAt} onChange={(e) => setStartAt(e.target.value)} />}
            </Field>
          )}
          <div className="rounded-md bg-content px-3 py-2 text-sm text-ink-muted">
            <p><span className="font-medium text-ink">{total} sticker{total === 1 ? '' : 's'}</span>, {pages} {sheet ? 'sheet' : 'label'}{pages === 1 ? '' : 's'}.</p>
            <p className="mt-1">Print at 100% (Actual size). Turn off "Fit to page".</p>
            {row?.is_outdoor && <p className="mt-1">Use weatherproof polyester or vinyl stock for outdoor gear.</p>}
            <p className="mt-1">Not lining up? <Link to="/app/it-inventory/stickers?tab=setup" className="text-accent hover:underline" onClick={onClose}>Adjust it in Printer setup</Link>.</p>
          </div>
          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        </div>
        <div className="order-1 sm:order-2">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Preview{pages > 1 ? ', page 1' : ''}</div>
          <PdfPagePreview data={preview} maxWidth={240} />
        </div>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={printing}>Cancel</Button>
        <Button onClick={() => void print()} disabled={printing || !tpl || !items.length}>
          {printing ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} Print {total} sticker{total === 1 ? '' : 's'}
        </Button>
      </div>
    </Modal>
  )
}
