import { useState } from 'react'
import { History } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { dateTime } from '@/lib/format'

type AuditRow = {
  id: string
  action: string
  diff: Record<string, unknown> | null
  created_at: string
  actor: { name: string } | null
}

const ACTION_LABEL: Record<string, string> = {
  time_entry_edited: 'Time entry edited',
  closeout_unlocked: 'Closeout unlocked',
  work_order_deleted: 'Work order deleted',
}

// Reusable "View history" affordance backed by the audit_log table. Manager+
// only (enforced by RLS); renders nothing actionable for others.
export function AuditHistory({ rowId, label = 'History' }: { rowId: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setOpen(true)
    setLoading(true)
    const { data } = await supabase
      .from('audit_log')
      .select('id, action, diff, created_at, actor:actor_user_id(name)')
      .eq('row_id', rowId)
      .order('created_at', { ascending: false })
    setRows((data as unknown as AuditRow[]) ?? [])
    setLoading(false)
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={load}>
        <History className="size-3.5" /> {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Audit history" size="md">
        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink-muted">No recorded changes.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {rows.map((r) => (
              <li key={r.id} className="py-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">
                    {ACTION_LABEL[r.action] ?? r.action}
                  </span>
                  <span className="text-xs text-ink-muted">{dateTime(r.created_at)}</span>
                </div>
                <p className="text-xs text-ink-muted">by {r.actor?.name ?? 'system'}</p>
                {r.diff?.before != null && (
                  <pre className="mt-1 overflow-x-auto rounded bg-content p-2 font-mono text-[11px] text-ink-muted">
                    {JSON.stringify(r.diff, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  )
}
