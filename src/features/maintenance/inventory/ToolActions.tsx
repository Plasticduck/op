import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { mi, type ToolCondition, type ToolDetail } from '@/lib/queries/maintenanceInventory'
import { scanFeedback } from '@/lib/scan/feedback'
import { useMi } from './context'
import { errText, TOOL_CONDITION, TOOL_STATUS, day } from './format'
import { act } from './offline'
import { ErrorNote, Loading, WarnNote } from './ui'

// What you can do with a tool, shown after a scan or on its page: check out, return,
// hand off, report a problem, or accept one being handed to you.

type Mode = 'menu' | 'checkout' | 'return' | 'transfer' | 'issue'

export function ToolActions({ toolId, onDone }: { toolId: string; onDone: (message: string) => void }) {
  const { refs } = useMi()
  const [d, setD] = useState<ToolDetail | null>(null)
  const [mode, setMode] = useState<Mode>('menu')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  // Check out / hand off
  const [target, setTarget] = useState('me')
  const [due, setDue] = useState('')
  const [condition, setCondition] = useState<ToolCondition>('good')
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    try {
      setD(await mi.toolDetail(toolId))
    } catch {
      setOffline(true)
    }
  }, [toolId])
  useEffect(() => { void load() }, [load])

  const run = async (rpc: string, args: Record<string, unknown>, text: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await act(rpc, args, text)
      scanFeedback()
      onDone(res.queued ? 'Saved on this phone. It will sync when you have signal.' : text)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  // "user:<id>" or "loc:<id>", from the one picker.
  const parts = (v: string) => (v === 'me' ? {} : v.startsWith('loc:') ? { p_to_location: v.slice(4) } : { p_to_user: v.slice(5) })
  const targets = (
    <>
      <optgroup label="People">
        {refs.people.map((p) => <option key={p.id} value={`user:${p.id}`}>{p.name}</option>)}
      </optgroup>
      <optgroup label="Trucks and cribs">
        {refs.locations.filter((l) => l.active).map((l) => <option key={l.id} value={`loc:${l.id}`}>{l.name}</option>)}
      </optgroup>
    </>
  )

  if (offline) {
    return (
      <div className="flex flex-col gap-3">
        <WarnNote>No signal. You can still check this out or return it, and it will sync later.</WarnNote>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button size="lg" className="h-14" disabled={busy} onClick={() => void run('mi_checkout_tool', { p_tool: toolId }, 'Checked out')}>Check out to me</Button>
        <Button size="lg" variant="secondary" className="h-14" disabled={busy} onClick={() => void run('mi_return_tool', { p_tool: toolId, p_condition: 'good' }, 'Returned')}>Return, in good shape</Button>
      </div>
    )
  }
  if (!d) return <Loading />
  if (d.hidden) return <WarnNote>{d.message}</WarnNote>
  const t = d.tool
  const s = TOOL_STATUS[t.status]

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold text-ink">{t.name}</span>
          <Badge tone={s.tone}>{s.label}</Badge>
          {t.overdue && t.status === 'checked_out' && <Badge tone="danger">Overdue</Badge>}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          With {t.custodian ?? 'no one'}{t.due_at ? `, due ${day(t.due_at)}` : ''}. Home: {t.home_name}.
        </p>
        {t.pending_to && <p className="mt-1 text-sm text-warn">Being handed to {t.pending_to}.</p>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      {mode === 'menu' && (
        <div className="grid gap-2">
          {t.can_accept && <Button size="lg" className="h-14" disabled={busy} onClick={() => void run('mi_accept_tool_transfer', { p_tool: t.id }, `You now have ${t.name}.`)}>Accept hand-off</Button>}
          {t.status === 'available' || (t.status === 'checked_out' && t.holds_it) ? (
            !t.holds_it && <Button size="lg" className="h-14" onClick={() => setMode('checkout')}>Check out</Button>
          ) : null}
          {(t.status === 'checked_out' || t.status === 'in_repair') && <Button size="lg" className="h-14" variant={t.holds_it ? 'primary' : 'secondary'} onClick={() => setMode('return')}>Return</Button>}
          {!['lost', 'retired'].includes(t.status) && <Button size="lg" className="h-14" variant="secondary" onClick={() => { setTarget(''); setMode('transfer') }}>Hand off</Button>}
          <Button size="lg" className="h-14" variant="secondary" onClick={() => setMode('issue')}>Report a problem</Button>
          {t.pending_to && (t.holds_it || t.can_manage) && (
            <Button variant="ghost" disabled={busy} onClick={() => { void mi.cancelToolTransfer(t.id).then(load).catch((e) => setError(errText(e))) }}>Cancel the hand-off</Button>
          )}
        </div>
      )}

      {mode === 'checkout' && (
        <div className="flex flex-col gap-3">
          <Field label="Who has it">
            {(id) => (
              <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="me">Me</option>
                {targets}
              </Select>
            )}
          </Field>
          <Field label="Due back" hint="Optional.">
            {(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
          </Field>
          <Button size="lg" className="h-14 text-lg" disabled={busy} onClick={() => void run('mi_checkout_tool', { p_tool: t.id, ...parts(target), p_due: due ? new Date(`${due}T23:59:00`).toISOString() : null }, `Checked out ${t.name}.`)}>
            <Check className="size-5" /> Check out
          </Button>
        </div>
      )}

      {mode === 'return' && (
        <div className="flex flex-col gap-3">
          <Field label="Condition">
            {(id) => (
              <Select id={id} value={condition} onChange={(e) => setCondition(e.target.value as ToolCondition)}>
                {Object.entries(TOOL_CONDITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            )}
          </Field>
          {condition !== 'good' && <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What's wrong with it?" />}
          <Button size="lg" className="h-14 text-lg" disabled={busy} onClick={() => void run('mi_return_tool', { p_tool: t.id, p_condition: condition, p_notes: notes || null }, condition === 'good' ? `Returned ${t.name}.` : `Returned ${t.name}. It's marked for repair.`)}>
            <Check className="size-5" /> Return
          </Button>
        </div>
      )}

      {mode === 'transfer' && (
        <div className="flex flex-col gap-3">
          <Field label="Hand it to" hint="They have to accept it before it's theirs.">
            {(id) => (
              <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Pick someone</option>
                {targets}
              </Select>
            )}
          </Field>
          <Button size="lg" className="h-14 text-lg" disabled={busy || !target} onClick={() => void run('mi_start_tool_transfer', { p_tool: t.id, ...parts(target) }, `Waiting for them to accept ${t.name}.`)}>
            <Check className="size-5" /> Start hand-off
          </Button>
        </div>
      )}

      {mode === 'issue' && (
        <div className="flex flex-col gap-3">
          <Field label="What's wrong">
            {(id) => (
              <Select id={id} value={condition} onChange={(e) => setCondition(e.target.value as ToolCondition)}>
                <option value="needs_repair">{TOOL_CONDITION.needs_repair}</option>
                <option value="damaged">{TOOL_CONDITION.damaged}</option>
                <option value="missing_parts">{TOOL_CONDITION.missing_parts}</option>
              </Select>
            )}
          </Field>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details" />
          <Button size="lg" className="h-14 text-lg" disabled={busy} onClick={() => void run('mi_report_tool_issue', { p_tool: t.id, p_condition: condition === 'good' ? 'needs_repair' : condition, p_notes: notes || null }, `Reported ${t.name}.`)}>
            <Check className="size-5" /> Report it
          </Button>
        </div>
      )}
    </div>
  )
}
