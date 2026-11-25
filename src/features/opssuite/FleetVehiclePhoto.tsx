import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2, Truck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { useAuth } from '@/lib/auth'
import { shrinkPhoto } from '@/lib/shrinkPhoto'
import { fleetPhotos, type FleetPhoto } from '@/lib/queries/fleet'

// Truck photos kept in Operator (migrations 0263-0264): Reveal shows a Picture per
// vehicle but its API doesn't share it. Fleet Map shows them in its list and
// Fleet Management's vehicle edit sets them; both use these.

// Every truck photo with a link that works for an hour, renewed before it runs out.
// eslint-disable-next-line react-refresh/only-export-components
export function useFleetPhotos() {
  const [rows, setRows] = useState<FleetPhoto[]>([])
  const [links, setLinks] = useState<Map<string, string>>(() => new Map())
  const [ready, setReady] = useState(false)
  const reload = useCallback(async () => {
    try {
      const r = await fleetPhotos.list()
      setLinks(await fleetPhotos.links(r))
      setRows(r)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[fleet photos]', e)
    } finally {
      setReady(true)
    }
  }, [])
  useEffect(() => {
    void reload()
    const id = setInterval(() => void reload(), 45 * 60_000)
    return () => clearInterval(id)
  }, [reload])
  return { rows, links, ready, reload }
}

// A truck's photo with Add / Replace / Remove. Saves right away (it isn't part of
// any form's Save). `large` shows the photo full width (Fleet Map); `inline` is a
// round photo beside the buttons, like Reveal's Picture field (vehicle edit).
export function VehiclePhotoField({ vehicleNumber, vehicleName, row, url, ready = true, onChanged, layout = 'large' }: {
  vehicleNumber: string
  vehicleName: string
  row: FleetPhoto | null
  url: string | null
  ready?: boolean
  onChanged: () => Promise<void>
  layout?: 'large' | 'inline'
}) {
  const { profile } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const pick = async (file: File | undefined) => {
    if (!file || !profile) return
    setBusy(true)
    setError(null)
    try {
      const small = await shrinkPhoto(file, 1200, { alwaysJpeg: true })
      if (small.size > 5 * 1024 * 1024) throw new Error('That picture is too large. Try a smaller one.')
      await fleetPhotos.save({ accountId: profile.account_id, userId: profile.id, vehicleNumber, file: small, previous: row?.path ?? null })
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the photo.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async () => {
    if (!row) return
    setBusy(true)
    setError(null)
    try {
      await fleetPhotos.remove(row)
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the photo.')
    } finally {
      setConfirmRemove(false)
      setBusy(false)
    }
  }

  const buttons = (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <Button size="sm" variant={layout === 'inline' ? 'secondary' : 'primary'} disabled={busy || !ready} onClick={() => fileRef.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        {row ? 'Replace photo' : 'Add a photo'}
      </Button>
      {row && (
        <Button variant="ghost" size="sm" className="text-danger" disabled={busy} onClick={() => setConfirmRemove(true)}>
          <Trash2 className="size-4" /> Remove
        </Button>
      )}
    </>
  )

  return (
    <>
      {layout === 'large' ? (
        <div className="flex flex-col gap-3">
          {url ? (
            <img src={url} alt={`Photo of ${vehicleName}`} className="max-h-[60vh] w-full rounded-md bg-content object-contain" />
          ) : (
            <div className="grid place-items-center gap-2 rounded-md border border-dashed border-border bg-content px-4 py-10 text-center">
              <Truck className="size-8 text-ink-subtle" />
              <p className="text-sm text-ink-muted">{ready ? 'No photo of this truck yet.' : 'Loading...'}</p>
            </div>
          )}
          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-2">{buttons}</div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          {url ? (
            <img src={url} alt={`Photo of ${vehicleName}`} className="size-20 shrink-0 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="grid size-20 shrink-0 place-items-center rounded-full bg-content text-ink-subtle ring-1 ring-border">
              {ready ? <Truck className="size-8" /> : <Loader2 className="size-5 animate-spin" />}
            </span>
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">Photo</div>
            <p className="text-xs text-ink-muted">Shows next to the truck on the Fleet Map. Saves right away.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">{buttons}</div>
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove this photo?"
        description={`The photo of ${vehicleName} will be taken off the Fleet Map and Fleet Management.`}
        confirmLabel="Remove"
        destructive
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  )
}
