import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, CheckCheck, Download, Search, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useLocations } from '@/lib/locations'
import { academy, teamLevelPct, teamLevelUnits, type TeamRow } from '@/lib/queries/academy'
import { cn } from '@/lib/utils'
import { ACADEMY_BASE, useAcademy } from './context'
import { TraineePicker } from './TraineePicker'
import { Bar, Card, Eyebrow, Pill, TraineeBar } from './ui'
import { errText, fmtDate, useMySites } from './helpers'

const inputCls = 'h-9 rounded-md border border-border bg-content px-2.5 text-sm text-ink outline-none focus:border-accent'

function overall(row: TeamRow, keys: string[]): number {
  let got = 0
  let units = 0
  for (const k of keys) {
    const u = teamLevelUnits(row.levels[k])
    got += u.got
    units += u.units
  }
  return units ? Math.round((got / units) * 100) : 0
}

// Leaders: everyone at their sites who has started the Academy, by level, with the
// sign-offs waiting for a leader to verify.
export function TeamTab() {
  const { outline, me, toast, trainee } = useAcademy()
  const { locations } = useLocations()
  const sites = useMySites()
  const navigate = useNavigate()
  const [site, setSite] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<TeamRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await academy.team(site || null))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [site])
  useEffect(() => { void load() }, [load])

  const levels = useMemo(() => outline?.levels ?? [], [outline])
  const keys = levels.map((l) => l.key)
  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])
  const shown = (rows ?? []).filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()))
  const waiting = shown.flatMap((r) =>
    levels
      .filter((l) => r.levels[l.key]?.signoff_id && !r.levels[l.key]?.verified)
      .map((l) => ({ row: r, level: l, t: r.levels[l.key] })),
  )

  const verify = async (signoffId: string) => {
    setBusy(signoffId)
    try {
      await academy.verify(signoffId, true)
      toast('Sign-off verified')
      await load()
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(null)
    }
  }

  const exportCsv = () => {
    const head = ['Name', 'Login', 'Site', 'Role', 'Overall %', ...levels.flatMap((l) => [`L${l.num} %`, `L${l.num} assessment`, `L${l.num} signed`, `L${l.num} verified`]), 'Last active']
    const lines = shown.map((r) => [
      r.name, r.is_user ? 'yes' : 'no', r.location_id ? siteName.get(r.location_id) ?? '' : '',
      levels.find((l) => l.key === r.level_key)?.title ?? '', String(overall(r, keys)),
      ...levels.flatMap((l) => {
        const t = r.levels[l.key]
        return [String(teamLevelPct(t)), t?.best != null ? String(t.best) : '', t?.signed_on ?? '', t?.verified ? 'yes' : '']
      }),
      r.last_active_at ? r.last_active_at.slice(0, 10) : '',
    ])
    const csv = [head, ...lines].map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `academy-team-progress-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex flex-col gap-4">
      <TraineeBar />
      <div className="flex flex-wrap items-center gap-2">
        <select value={site} onChange={(e) => setSite(e.target.value)} className={cn(inputCls, 'pr-8')} aria-label="Site">
          <option value="">All my sites</option>
          {sites.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names" className={cn(inputCls, 'w-48 pl-8')} />
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!shown.length}><Download className="size-4" /> CSV</Button>
          {!trainee && <Button size="sm" onClick={() => setPicking(true)}><UserPlus className="size-4" /> Train a team member</Button>}
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      {waiting.length > 0 && (
        <Card>
          <Eyebrow>Waiting for a leader to verify</Eyebrow>
          <ul className="mt-2 divide-y divide-border">
            {waiting.map(({ row, level, t }) => {
              const own = row.learner_id === me?.learner?.id
              return (
                <li key={t.signoff_id!} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <b className="text-ink">{row.name}</b>
                    <span className="text-ink-muted"> · Level {level.num} {level.short_title} · signed {fmtDate(t.signed_on)}</span>
                  </span>
                  {own ? (
                    <span className="text-xs text-ink-subtle">Someone else verifies yours</span>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={busy === t.signoff_id} onClick={() => void verify(t.signoff_id!)}>
                      <Check className="size-4" /> Verify
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {rows == null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : shown.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            {q ? 'No one matches.' : 'No one at these sites has started the Academy yet. People show up here once they open it, or once you train them on your device.'}
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Site</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Overall</th>
                {levels.map((l) => <th key={l.id} className="px-2 py-2 text-center font-medium" title={l.title}>L{l.num}</th>)}
                <th className="px-3 py-2 font-medium">Last active</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const pct = overall(r, keys)
                return (
                  <tr
                    key={r.learner_id}
                    onClick={() => navigate(`${ACADEMY_BASE}/people/${r.learner_id}`)}
                    className="cursor-pointer border-t border-border hover:bg-content"
                  >
                    <td className="px-3 py-2">
                      <span className="font-medium text-ink">{r.name}</span>
                      {!r.is_user && <span className="ml-1.5"><Pill>no login</Pill></span>}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{r.location_id ? siteName.get(r.location_id) ?? '' : ''}</td>
                    <td className="px-3 py-2 text-ink-muted">{levels.find((l) => l.key === r.level_key)?.short_title ?? 'Not set'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Bar pct={pct} className="w-16" />
                        <b className="tabular-nums text-ink">{pct}%</b>
                      </div>
                    </td>
                    {levels.map((l) => {
                      const t = r.levels[l.key]
                      const p = teamLevelPct(t)
                      return (
                        <td key={l.id} className="px-2 py-2 text-center">
                          <span
                            title={`${l.title}: ${p}%${t?.best != null ? `, assessment ${t.best}%` : ''}${t?.signoff_id ? (t.verified ? ', verified' : ', signed') : ''}`}
                            className={cn(
                              'inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums',
                              t?.verified ? 'bg-ok text-white' : t?.signoff_id ? 'bg-ok-soft text-ok' : p > 0 ? 'bg-accent-soft text-accent' : 'bg-content text-ink-subtle',
                            )}
                          >
                            {t?.verified ? <CheckCheck className="size-3.5" /> : t?.signoff_id ? <Check className="size-3.5" /> : `${p}%`}
                          </span>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-ink-muted">{fmtDate(r.last_active_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-subtle">One check means signed off; two checks means a leader verified it. Click a person for their full record.</p>
      {picking && <TraineePicker onClose={() => setPicking(false)} onStarted={() => navigate('/app/training')} />}
    </div>
  )
}
