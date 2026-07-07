import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Upload } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { shortDate } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { documents, type DocumentRow } from '@/lib/queries/ops'

const CATEGORIES = [
  { value: 'sop', label: 'SOP' },
  { value: 'sds', label: 'SDS' },
  { value: 'policy', label: 'Policy' },
  { value: 'other', label: 'Other' },
]

const TONE = { sop: 'accent', sds: 'warn', policy: 'neutral', other: 'neutral' } as const

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const isManagerPlus = profile?.role !== 'employee'
  const [rows, setRows] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [uploadCategory, setUploadCategory] = useState('sop')
  const [applyAll, setApplyAll] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<DocumentRow | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await documents.list(locationId)
    setRows((data as DocumentRow[] | null) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const onUpload = async (files: FileList) => {
    const list = Array.from(files)
    if (list.length === 0) return
    // Fan the same file out to every site the user can manage, or just this one.
    const targets = applyAll && locations.length > 0 ? locations.map((l) => l.id) : [locationId]
    const total = list.length * targets.length
    setProgress({ done: 0, total })
    let done = 0
    for (const file of list) {
      for (const loc of targets) {
        const path = `${loc}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`
        const { error: upErr } = await supabase.storage.from('documents').upload(path, file)
        if (!upErr) {
          await documents.create({
            location_id: loc,
            name: file.name,
            category: uploadCategory,
            file_url: path,
            uploaded_by: profile?.id ?? null,
          })
        }
        done += 1
        setProgress({ done, total })
      }
    }
    setProgress(null)
    await load()
    if (fileRef.current) fileRef.current.value = ''
  }

  const view = async (doc: DocumentRow) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_url, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.category === filter)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documents"
        subtitle="SOPs, safety data sheets, and policies."
        actions={
          isManagerPlus ? (
            <div className="flex flex-wrap items-center gap-2">
              {locations.length > 1 && (
                <label className="flex items-center gap-1.5 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    checked={applyAll}
                    onChange={(e) => setApplyAll(e.target.checked)}
                    disabled={!!progress}
                  />
                  Apply to all sites
                </label>
              )}
              <Select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                className="w-32"
                disabled={!!progress}
              >
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && onUpload(e.target.files)}
              />
              <Button onClick={() => fileRef.current?.click()} disabled={!!progress}>
                <Upload className="size-4" />
                {progress ? `Uploading ${progress.done}/${progress.total}…` : 'Upload'}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex items-center gap-2">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No documents" description="Upload SOPs, SDS sheets, and policies for your team." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium">Uploaded</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{d.name}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={TONE[d.category as keyof typeof TONE]}>{d.category.toUpperCase()}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(d.created_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => view(d)}>View</Button>
                    {isManagerPlus && (
                      <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setArchiveTarget(d)}>
                        Archive
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        title={`Archive ${archiveTarget?.name}?`}
        description="It will be hidden from the library. The file is preserved, not deleted."
        confirmLabel="Archive"
        destructive
        onConfirm={async () => { if (archiveTarget) await documents.archive(archiveTarget.id); setArchiveTarget(null); void load() }}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  )
}

export default function DocumentsPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
