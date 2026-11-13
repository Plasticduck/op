import { useEffect, useMemo, useRef, useState } from 'react'
import { differenceInCalendarDays, format } from 'date-fns'
import { Check, Loader2, MessageSquare, Pencil, Search, SquarePen, Trash2, X } from 'lucide-react'
import { askHistory, type AiConversation, type AiSearchHit } from '@/lib/queries/askOperator'
import { cn } from '@/lib/utils'

// Slide-over list of the person's saved Operator AI conversations: open, start
// new, rename, delete, and search titles and what was said.

const GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'] as const
function groupOf(iso: string): (typeof GROUPS)[number] {
  const d = differenceInCalendarDays(new Date(), new Date(iso))
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d <= 7 ? 'Previous 7 days' : d <= 30 ? 'Previous 30 days' : 'Older'
}
const when = (iso: string) => {
  const d = new Date(iso)
  return differenceInCalendarDays(new Date(), d) <= 0 ? format(d, 'h:mm a') : format(d, 'MMM d')
}
// Search snippets mark matches with « »; show those as highlights.
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('«') ? <mark key={i} className="rounded bg-accent-soft px-0.5 text-ink">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>,
      )}
    </>
  )
}

export function HistoryPanel({
  open, onClose, currentId, onOpen, onNew, refreshKey,
}: {
  open: boolean
  onClose: () => void
  currentId: string | null
  onOpen: (id: string) => void
  onNew: () => void
  refreshKey: number
}) {
  const [list, setList] = useState<AiConversation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<AiSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    askHistory.list()
      .then((l) => { if (live) { setList(l); setError(null) } })
      .catch(() => { if (live) setError("Couldn't load your conversations.") })
    return () => { live = false }
  }, [open, refreshKey])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, editing])

  // What was said, searched on the server (stemmed words), a moment after typing stops.
  const q = query.trim()
  useEffect(() => {
    if (q.length < 2) { setHits(null); return }
    let live = true
    setSearching(true)
    const t = setTimeout(() => {
      askHistory.search(q)
        .then((h) => { if (live) setHits(h) })
        .catch(() => { if (live) setHits([]) })
        .finally(() => { if (live) setSearching(false) })
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  const shown = useMemo(() => {
    const l = list ?? []
    return q ? l.filter((c) => c.title.toLowerCase().includes(q.toLowerCase())) : l
  }, [list, q])
  const grouped = useMemo(() => GROUPS.map((g) => ({ g, items: shown.filter((c) => groupOf(c.last_message_at) === g) })).filter((x) => x.items.length), [shown])
  // One hit per conversation, best first.
  const hitList = useMemo(() => {
    const seen = new Set<string>()
    return (hits ?? []).filter((h) => (seen.has(h.conversation_id) ? false : (seen.add(h.conversation_id), true)))
  }, [hits])

  const saveTitle = async () => {
    if (!editing) return
    const title = editing.title.trim()
    setEditing(null)
    if (!title) return
    setList((l) => l?.map((c) => (c.id === editing.id ? { ...c, title } : c)) ?? l)
    await askHistory.rename(editing.id, title).catch(() => setError("Couldn't rename that conversation."))
  }
  const remove = async (id: string) => {
    setConfirmDelete(null)
    setList((l) => l?.filter((c) => c.id !== id) ?? l)
    try {
      await askHistory.remove(id)
      if (id === currentId) onNew()
    } catch {
      setError("Couldn't delete that conversation.")
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Your conversations">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <aside className="ai-rise absolute inset-y-0 left-0 flex w-[21rem] max-w-[88vw] flex-col border-r border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <MessageSquare className="size-4 text-accent" />
          <h2 className="text-sm font-semibold text-ink">Your conversations</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-ink-subtle hover:bg-content hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-2 px-3 pt-3">
          <button type="button" onClick={() => { onNew(); onClose() }}
            className="flex w-full items-center gap-2 rounded-xl border border-border bg-content px-3 py-2 text-sm font-medium text-ink hover:border-accent/50">
            <SquarePen className="size-4 text-accent" /> New conversation
          </button>
          <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:border-accent/60">
            <Search className="size-4 shrink-0 text-ink-subtle" />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations"
              aria-label="Search conversations"
              className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm text-ink outline-none placeholder:text-ink-subtle focus:ring-0" />
            {searching && <Loader2 className="size-3.5 animate-spin text-ink-subtle" />}
          </label>
        </div>

        <div className="scrollbar-slim mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {error && <p className="mx-2 my-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
          {list == null && !error && (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Loading…</div>
          )}
          {list && list.length === 0 && (
            <p className="px-3 py-4 text-sm text-ink-muted">No conversations yet. Ask something and it will show up here.</p>
          )}

          {grouped.map(({ g, items }) => (
            <section key={g} className="mt-2">
              <h3 className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{g}</h3>
              <ul>
                {items.map((c) => (
                  <li key={c.id} className={cn('group relative rounded-lg', c.id === currentId ? 'bg-accent-soft' : 'hover:bg-content')}>
                    {editing?.id === c.id ? (
                      <div className="flex items-center gap-1 px-2 py-1.5">
                        <input autoFocus value={editing.title} onChange={(e) => setEditing({ id: c.id, title: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') void saveTitle(); if (e.key === 'Escape') setEditing(null) }}
                          aria-label="Conversation name" maxLength={120}
                          className="h-8 min-w-0 flex-1 rounded-md border border-accent/60 bg-card px-2 text-sm text-ink outline-none focus:ring-0" />
                        <button type="button" onClick={() => void saveTitle()} aria-label="Save name" className="rounded-md p-1.5 text-accent hover:bg-card"><Check className="size-4" /></button>
                      </div>
                    ) : confirmDelete === c.id ? (
                      <div className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-ink">Delete this conversation?</span>
                        <button type="button" onClick={() => void remove(c.id)} className="rounded-md bg-danger px-2 py-0.5 text-xs font-semibold text-white">Delete</button>
                        <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-md px-2 py-0.5 text-xs text-ink-muted hover:bg-card">Keep</button>
                      </div>
                    ) : (
                      <>
                        <button type="button" onClick={() => { onOpen(c.id); onClose() }} className="flex w-full items-baseline gap-2 px-3 py-2 pr-16 text-left">
                          <span className={cn('min-w-0 flex-1 truncate text-sm', c.id === currentId ? 'font-medium text-ink' : 'text-ink')}>{c.title}</span>
                          <span className="shrink-0 text-[11px] text-ink-subtle group-hover:invisible">{when(c.last_message_at)}</span>
                        </button>
                        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                          <button type="button" onClick={() => setEditing({ id: c.id, title: c.title })} aria-label={`Rename ${c.title}`}
                            className="rounded-md p-1.5 text-ink-subtle hover:bg-card hover:text-ink"><Pencil className="size-3.5" /></button>
                          <button type="button" onClick={() => setConfirmDelete(c.id)} aria-label={`Delete ${c.title}`}
                            className="rounded-md p-1.5 text-ink-subtle hover:bg-card hover:text-danger"><Trash2 className="size-3.5" /></button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {q.length >= 2 && hits != null && (
            <section className="mt-3 border-t border-border pt-2">
              <h3 className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">In what was said</h3>
              {hitList.length === 0 ? (
                <p className="px-3 py-2 text-sm text-ink-muted">No messages mention that.</p>
              ) : (
                <ul>
                  {hitList.map((h) => (
                    <li key={h.conversation_id}>
                      <button type="button" onClick={() => { onOpen(h.conversation_id); onClose() }}
                        className="w-full rounded-lg px-3 py-2 text-left hover:bg-content">
                        <span className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{h.title}</span>
                          <span className="shrink-0 text-[11px] text-ink-subtle">{when(h.created_at)}</span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-xs text-ink-muted"><Snippet text={h.snippet} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}
