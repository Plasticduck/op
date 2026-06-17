import { useEffect, useState } from 'react'
import { FileText, Image as ImageIcon, Paperclip, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { attachments } from '@/lib/queries/opsSuite'

type Meta = { id: string; label: string | null; file_name: string | null; file_type: string | null }

// Convert a base64 data URI to a Blob so large PDFs open reliably in a new tab
// (browsers cap the size of a data: URL used directly as a window location).
function dataUriToBlob(uri: string): Blob {
  const [head, b64] = uri.split(',')
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

const isPdf = (t: string | null) => !!t && t.includes('pdf')
const isImage = (t: string | null) => !!t && t.startsWith('image/')

// Lists attachments for a record and previews them inline (image/PDF) with an
// "Open in new tab" fallback. Blobs are loaded only when a file is opened.
export function AttachmentViewer({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [items, setItems] = useState<Meta[] | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [uri, setUri] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    attachments.metaForEntity(entityType, entityId).then(({ data }) => setItems((data as Meta[]) ?? []))
  }, [entityType, entityId])

  const open = async (id: string) => {
    setActive(id); setUri(null); setLoading(true)
    const { data } = await attachments.data(id)
    setUri(data?.data_uri ?? null)
    setLoading(false)
  }

  const openTab = () => {
    if (!uri) return
    const url = URL.createObjectURL(dataUriToBlob(uri))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  if (!items || items.length === 0) return null
  const activeMeta = items.find((i) => i.id === active)

  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        <Paperclip className="size-3.5" /> Attachments ({items.length})
      </h3>
      <ul className="flex flex-wrap gap-2">
        {items.map((a) => {
          const Icon = isImage(a.file_type) ? ImageIcon : FileText
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => open(a.id)}
                className={
                  'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition ' +
                  (active === a.id ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-card text-ink hover:bg-content')
                }
              >
                <Icon className="size-4" />
                {a.file_name || a.label || (isPdf(a.file_type) ? 'Document.pdf' : 'Attachment')}
              </button>
            </li>
          )
        })}
      </ul>

      {active && (
        <div className="mt-3 rounded-md border border-border bg-content p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="truncate text-xs text-ink-muted">{activeMeta?.file_name || activeMeta?.label || 'Preview'}</span>
            <Button variant="ghost" size="sm" onClick={openTab} disabled={!uri}>
              <ExternalLink className="size-3.5" /> Open in new tab
            </Button>
          </div>
          {loading ? (
            <div className="grid h-48 place-items-center text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
          ) : !uri ? (
            <p className="p-4 text-sm text-ink-muted">Unable to load attachment.</p>
          ) : isImage(activeMeta?.file_type ?? null) ? (
            <img src={uri} alt={activeMeta?.file_name ?? 'attachment'} className="mx-auto max-h-[70vh] rounded" />
          ) : (
            <iframe title="attachment" src={uri} className="h-[70vh] w-full rounded bg-white" />
          )}
        </div>
      )}
    </section>
  )
}
