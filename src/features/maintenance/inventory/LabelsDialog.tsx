import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Loader2, Printer } from 'lucide-react'
import { PdfPagePreview } from '@/components/data/PdfPagePreview'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { buildLabelsPdf, type PrintTemplate, type StickerLogo } from '@/lib/labels/labelPdf'
import { labelsPerPage, type LabelContent, type LabelLayoutSpec, type LabelSpec } from '@/lib/labels/layout'
import { readStickerLogo } from '@/lib/labels/stickerLogo'
import { mi, type LabelSetup } from '@/lib/queries/maintenanceInventory'
import { supabase } from '@/lib/supabase'
import { tagUrl } from '@/features/it/inventory/format'
import { errText } from './format'
import { ErrorNote, Loading } from './ui'

// Stickers for bins, tools, assets and locations: same templates, calibration, logo and
// QR link as IT Inventory, so the same scanner reads them. A tag's code is made the first
// time it's printed.

export type LabelItem = { type: 'bin' | 'tool' | 'asset' | 'location'; id: string; name: string; site?: string | null }

const toTemplate = (t: LabelSetup['templates'][number]): PrintTemplate => ({
  name: t.name,
  page_spec: t.page_spec as LabelSpec,
  layout: t.layout as LabelLayoutSpec,
  offset_x_mm: Number(t.offset_x_mm),
  offset_y_mm: Number(t.offset_y_mm),
  scale: Number(t.scale),
})

export function LabelsDialog({ items, onClose }: { items: LabelItem[]; onClose: () => void }) {
  const [setup, setSetup] = useState<LabelSetup | null>(null)
  const [labels, setLabels] = useState<LabelContent[] | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [copies, setCopies] = useState(1)
  const [preview, setPreview] = useState<ArrayBuffer | null>(null)
  const [logo, setLogo] = useState<StickerLogo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const s = await mi.labelSetup()
        if (!alive) return
        setSetup(s)
        setTemplateId((s.templates.find((t) => t.is_default) ?? s.templates[0])?.id ?? '')
        if (!s.settings) throw new Error('Stickers are set up under IT Inventory. Open it once so the sticker settings exist.')
        const shortCode = s.settings.short_code
        const out: LabelContent[] = []
        for (const it of items) {
          const tag = await mi.ensureTag(it.type, it.id)
          out.push({ tag, url: tagUrl(shortCode, tag), name: it.name, site: it.site ?? null })
        }
        if (alive) setLabels(out)
        if (s.settings.label_show_logo && s.settings.label_logo_path) {
          const { data } = await supabase.storage.from('it-inventory').download(s.settings.label_logo_path)
          if (data && alive) setLogo(await readStickerLogo(data))
        }
      } catch (e) {
        if (alive) setError(errText(e))
      }
    })()
    return () => { alive = false }
  }, [items])

  const row = setup?.templates.find((t) => t.id === templateId)
  const tpl = useMemo(() => (row ? toTemplate(row) : null), [row])

  useEffect(() => {
    if (!tpl || !labels?.length) return
    let alive = true
    const first = tpl.page_spec.page ? labels.slice(0, labelsPerPage(tpl.page_spec)) : labels.slice(0, 1)
    void buildLabelsPdf(tpl, first, { copies, logo }).then(({ doc }) => { if (alive) setPreview(doc.output('arraybuffer')) })
    return () => { alive = false }
  }, [tpl, labels, copies, logo])

  const print = async () => {
    if (!tpl || !labels) return
    setPrinting(true)
    try {
      const { doc } = await buildLabelsPdf(tpl, labels, { copies, logo })
      doc.save(`maintenance-labels-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`)
      await mi.markPrinted(labels.map((l) => l.tag))
      onClose()
    } catch (e) {
      setError(errText(e))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Print ${items.length} label${items.length === 1 ? '' : 's'}`} description="Downloads a PDF. Print it at 100% (Actual size). Printer calibration lives under IT Inventory > Stickers." size="lg">
      {error ? <ErrorNote>{error}</ErrorNote> : !labels || !setup ? <Loading /> : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sticker size">
              {(id) => (
                <Select id={id} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {setup.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Copies of each">
              {(id) => (
                <Select id={id} value={String(copies)} onChange={(e) => setCopies(Number(e.target.value))}>
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <p className="text-xs text-ink-muted">{labels.map((l) => l.tag).slice(0, 8).join(', ')}{labels.length > 8 ? ` and ${labels.length - 8} more` : ''}</p>
          <PdfPagePreview data={preview} maxWidth={460} className="mx-auto" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={printing || !tpl} onClick={() => void print()}>
              {printing ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} Download PDF
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
