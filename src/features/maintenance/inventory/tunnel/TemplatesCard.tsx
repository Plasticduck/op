import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Loader2, Map as MapIcon, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { miTunnel, type TemplateList } from '@/lib/queries/miTunnel'
import { useMi } from '../context'
import { day, errText } from '../format'
import { Card, ErrorNote, Loading, Muted } from '../ui'
import { ApplyTemplateDialog } from './ApplyTemplateDialog'
import { EXPRESS_TEMPLATE_NAME, expressTemplate } from './expressTemplate'

// Settings > Tunnel diagrams. A template is the drawing every site starts from; each
// site's copy is then adjusted on its own Tunnel screen. Directors keep the templates.

export function TemplatesCard() {
  const { refs } = useMi()
  const [d, setD] = useState<TemplateList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setD(await miTunnel.templates())
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const createStandard = async () => {
    setBusy(true)
    try {
      await miTunnel.save(expressTemplate())
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const has = new Set((d?.site_layouts ?? []).filter((s) => s.tunnel_no === 1).map((s) => s.location_id))
  const sites = refs.sites.map((s) => ({ id: s.id, name: s.name, has: has.has(s.id) }))
  const withDiagram = sites.filter((s) => s.has).length

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><MapIcon className="size-4 text-accent" /> Tunnel diagrams</span>}
      actions={d?.can_edit_templates && !d.templates.some((t) => t.name === EXPRESS_TEMPLATE_NAME) ? (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void createStandard()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Create the standard template
        </Button>
      ) : undefined}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!d && !error && <Loading />}
      {d && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            {withDiagram} of {sites.length} sites have a diagram. Each site starts from a template, links its own machines by type, and is then dragged to match the real tunnel on its Tunnel screen.
          </p>
          {d.templates.length === 0 ? <Muted>No templates yet.</Muted> : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {d.templates.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{t.name}</div>
                    <div className="text-xs text-ink-muted">{t.items} shapes, {t.length_ft} ft tunnel, used by {t.sites_using} site{t.sites_using === 1 ? '' : 's'}. Changed {day(t.updated_at)}.</div>
                  </div>
                  {d.can_edit_templates && (
                    <>
                      <Button size="sm" onClick={() => setApplying({ id: t.id, name: t.name })}><Copy className="size-3.5" /> Set up sites</Button>
                      <Link to={`/app/maintenance-inventory/settings/tunnels/${t.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-sm text-ink hover:bg-content"><Pencil className="size-3.5" /> Edit</Link>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${t.name}`} onClick={() => setRemoving({ id: t.id, name: t.name })}><Trash2 className="size-3.5" /></Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!d.can_edit_templates && <p className="text-xs text-ink-subtle">A corporate maintenance director or admin keeps the templates.</p>}
        </div>
      )}
      {applying && <ApplyTemplateDialog source={applying} sites={sites} preselect={sites.filter((s) => !s.has).map((s) => s.id)} onClose={() => setApplying(null)} onDone={() => void load()} />}
      <ConfirmDialog open={!!removing} title={`Remove ${removing?.name ?? 'this template'}?`}
        description="Sites set up from it keep their own diagrams. This only removes the template." confirmLabel="Remove" destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const t = removing
          setRemoving(null)
          if (t) void miTunnel.remove(t.id).then(load).catch((e) => setError(errText(e)))
        }} />
    </Card>
  )
}
