import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { miTunnel, type TunnelItem, type TunnelLayout } from '@/lib/queries/miTunnel'
import { errText } from '../format'
import { ErrorNote, Loading } from '../ui'
import { TunnelEditor } from './TunnelEditor'

// Settings > Tunnel diagrams > Edit: the same editor as a site's drawing, but shapes
// name a machine type instead of a machine.
export default function TemplateEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [d, setD] = useState<{ layout: TunnelLayout; items: TunnelItem[]; can_edit: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!id) return
    let alive = true
    miTunnel.template(id).then((r) => { if (alive) setD(r) }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [id])
  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!d) return <Loading />
  if (!d.can_edit) return <ErrorNote>Only a corporate maintenance director or admin can change templates.</ErrorNote>
  return <TunnelEditor layout={d.layout} items={d.items} assets={{}} onClose={() => navigate('/app/maintenance-inventory/settings#tunnels')} />
}
