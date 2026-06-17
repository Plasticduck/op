import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar as CalendarIcon, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { endOfMonth, format, startOfMonth } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { MonthGrid, type MonthGridEvent } from '@/components/data/MonthGrid'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { socialPosts, type SocialPost } from '@/lib/queries/social'
import { holidaysInRange, type Holiday } from '@/lib/social/holidays'

const STATUS_TONE: Record<string, 'neutral' | 'accent' | 'ok' | 'warn'> = {
  draft: 'neutral',
  scheduled: 'accent',
  posted: 'ok',
}

export default function SocialCalendarPage() {
  const { profile } = useAuth()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [selectedHoliday, setSelectedHoliday] = useState<{ holiday: Holiday; date: Date } | null>(null)

  const monthStart = useMemo(() => startOfMonth(month), [month])
  const monthEnd = useMemo(() => endOfMonth(month), [month])

  const load = useCallback(async () => {
    setLoading(true)
    const from = format(monthStart, 'yyyy-MM-dd')
    const to = format(monthEnd, 'yyyy-MM-dd')
    const { data } = await socialPosts.forRange(from, to)
    setPosts((data as SocialPost[] | null) ?? [])
    setLoading(false)
  }, [monthStart, monthEnd])

  useEffect(() => { void load() }, [load])

  const holidays = useMemo(() => holidaysInRange(monthStart, monthEnd), [monthStart, monthEnd])

  const gridEvents: MonthGridEvent[] = useMemo(() => {
    const evs: MonthGridEvent[] = []
    for (const { holiday, date } of holidays) {
      evs.push({
        id: 'h:' + holiday.id,
        date,
        title: holiday.name,
        emoji: holiday.emoji,
        tone: holiday.tone ?? 'neutral',
      })
    }
    for (const p of posts) {
      evs.push({
        id: 'p:' + p.id,
        date: p.post_date,
        title: p.title ?? '(untitled post)',
        emoji: p.status === 'posted' ? '✅' : p.status === 'scheduled' ? '📅' : '📝',
        tone: STATUS_TONE[p.status] ?? 'accent',
      })
    }
    return evs
  }, [holidays, posts])

  const onEventClick = (e: MonthGridEvent) => {
    if (e.id.startsWith('h:')) {
      const id = e.id.slice(2)
      const found = holidays.find((h) => h.holiday.id === id)
      if (found) setSelectedHoliday(found)
    }
    if (e.id.startsWith('p:')) {
      const date = typeof e.date === 'string' ? new Date(e.date) : e.date
      setSelectedDay(date)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Social Calendar"
        subtitle="Plan posts around holidays, observances, and your wash's promo moments."
        actions={
          <Button onClick={() => setSelectedDay(new Date())}>
            <Plus className="size-4" /> New post
          </Button>
        }
      />

      <div className="rounded-md border border-warn/30 bg-warn-soft/40 px-3 py-2 text-sm text-ink">
        <span className="font-medium text-warn">Tip:</span> Click any holiday in the grid to get AI post ideas tailored to your wash. Click a day to draft a custom post.
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading...</p>
      ) : (
        <MonthGrid
          month={month}
          events={gridEvents}
          onMonthChange={setMonth}
          onDayClick={(d) => setSelectedDay(d)}
          onEventClick={onEventClick}
          rightSlot={
            <div className="flex items-center gap-3 text-xs text-ink-muted">
              <Legend dot="bg-accent" label="Posts" />
              <Legend dot="bg-warn" label="Seasonal" />
              <Legend dot="bg-ok" label="Big day" />
            </div>
          }
        />
      )}

      {selectedHoliday && (
        <HolidayModal
          holiday={selectedHoliday.holiday}
          date={selectedHoliday.date}
          accountId={profile?.account_id ?? ''}
          createdBy={profile?.id ?? null}
          onClose={() => setSelectedHoliday(null)}
          onSaved={() => { setSelectedHoliday(null); void load() }}
        />
      )}

      {selectedDay && (
        <DayPostsModal
          date={selectedDay}
          posts={posts.filter((p) => p.post_date === format(selectedDay, 'yyyy-MM-dd'))}
          accountId={profile?.account_id ?? ''}
          createdBy={profile?.id ?? null}
          onClose={() => setSelectedDay(null)}
          onSaved={() => { setSelectedDay(null); void load() }}
        />
      )}
    </div>
  )
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={'inline-block size-2 rounded-full ' + dot} /> {label}
    </span>
  )
}

function HolidayModal({
  holiday, date, accountId, createdBy, onClose, onSaved,
}: {
  holiday: Holiday
  date: Date
  accountId: string
  createdBy: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Array<{ platform: string; title: string; body: string }>>([])
  const [platform, setPlatform] = useState('Instagram')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const dateStr = format(date, 'yyyy-MM-dd')

  const generate = async () => {
    setBusy(true); setError(null)
    const { data, error: err } = await supabase.functions.invoke('suggest-social-post', {
      body: { holiday_id: holiday.id, date: dateStr, platform },
    })
    setBusy(false)
    if (err) return setError(err.message || 'Failed to generate.')
    if (data?.error === 'no_key') return setError('AI is not configured yet (ANTHROPIC_API_KEY is unset).')
    const arr = (data as { suggestions?: Array<{ platform: string; title: string; body: string }> }).suggestions ?? []
    setSuggestions(arr)
  }

  const applySuggestion = (s: { platform: string; title: string; body: string }) => {
    setPlatform(s.platform)
    setTitle(s.title)
    setBody(s.body)
  }

  const save = async (status: 'draft' | 'scheduled') => {
    setBusy(true); setError(null)
    const { error: err } = await socialPosts.create({
      account_id: accountId,
      post_date: dateStr,
      holiday_id: holiday.id,
      platform,
      status,
      title: title.trim() || holiday.name,
      body: body.trim() || null,
      ai_generated: suggestions.length > 0,
      created_by: createdBy,
    })
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={`${holiday.emoji} ${holiday.name}`} size="lg">
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-border bg-content p-3 text-sm">
          <p className="text-ink-muted">{format(date, 'EEEE, MMMM d, yyyy')}</p>
          <p className="mt-1 text-ink"><span className="font-medium">Promo angle:</span> {holiday.promoAngle}</p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Platform" className="w-40">
            {(id) => (
              <Select id={id} value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option>Instagram</option>
                <option>Facebook</option>
                <option>X</option>
                <option>TikTok</option>
              </Select>
            )}
          </Field>
          <Button variant="secondary" onClick={() => void generate()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Generate AI ideas
          </Button>
        </div>

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">AI suggestions</div>
            {suggestions.map((s, i) => (
              <div key={i} className="rounded-md border border-border bg-card p-3">
                <div className="mb-1 flex items-center justify-between">
                  <Badge tone="accent">{s.platform}</Badge>
                  <Button variant="ghost" size="sm" onClick={() => applySuggestion(s)}>Use this</Button>
                </div>
                <div className="text-sm font-medium text-ink">{s.title}</div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{s.body}</p>
              </div>
            ))}
          </div>
        )}

        <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={holiday.name + ' post'} />}</Field>
        <Field label="Body">
          {(id) => (
            <textarea
              id={id}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
            />
          )}
        </Field>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={() => void save('draft')} disabled={busy}>Save as draft</Button>
          <Button onClick={() => void save('scheduled')} disabled={busy}>Schedule</Button>
        </div>
      </div>
    </Modal>
  )
}

function DayPostsModal({
  date, posts, accountId, createdBy, onClose, onSaved,
}: {
  date: Date
  posts: SocialPost[]
  accountId: string
  createdBy: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [creating, setCreating] = useState(posts.length === 0)
  const [platform, setPlatform] = useState('Instagram')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const dateStr = format(date, 'yyyy-MM-dd')

  const save = async (status: 'draft' | 'scheduled') => {
    setBusy(true); setError(null)
    const { error: err } = await socialPosts.create({
      account_id: accountId,
      post_date: dateStr,
      platform,
      status,
      title: title.trim() || '(untitled post)',
      body: body.trim() || null,
      created_by: createdBy,
    })
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  const remove = async (id: string) => {
    if (!window.confirm('Delete this post?')) return
    await socialPosts.remove(id)
    onSaved()
  }

  const setStatus = async (id: string, status: 'draft' | 'scheduled' | 'posted') => {
    await socialPosts.update(id, { status })
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={format(date, 'EEEE, MMMM d, yyyy')} size="lg">
      <div className="flex flex-col gap-4">
        {posts.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Posts on this day</div>
            {posts.map((p) => (
              <div key={p.id} className="rounded-md border border-border bg-card p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
                    {p.platform && <span className="text-xs text-ink-muted">{p.platform}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void setStatus(p.id, 'draft')}>Draft</Button>
                    <Button variant="ghost" size="sm" onClick={() => void setStatus(p.id, 'scheduled')}>Schedule</Button>
                    <Button variant="ghost" size="sm" onClick={() => void setStatus(p.id, 'posted')}>Posted</Button>
                    <Button variant="ghost" size="sm" onClick={() => void remove(p.id)} aria-label="Delete">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {p.title && <div className="text-sm font-medium text-ink">{p.title}</div>}
                {p.body && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{p.body}</p>}
              </div>
            ))}
          </div>
        )}

        {!creating ? (
          <Button variant="secondary" onClick={() => setCreating(true)}><Plus className="size-4" /> Add another post</Button>
        ) : (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">New post</div>
            <Field label="Platform">
              {(id) => (
                <Select id={id} value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  <option>Instagram</option>
                  <option>Facebook</option>
                  <option>X</option>
                  <option>TikTok</option>
                </Select>
              )}
            </Field>
            <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
            <Field label="Body">
              {(id) => (
                <textarea
                  id={id}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                />
              )}
            </Field>
            {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
              <Button variant="secondary" onClick={() => void save('draft')} disabled={busy}>Save draft</Button>
              <Button onClick={() => void save('scheduled')} disabled={busy}>Schedule</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export const SocialCalendarPageIcon = CalendarIcon
