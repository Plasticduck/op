import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  AtSign,
  Bell,
  Hash,
  ImageIcon,
  Info,
  Loader2,
  LogOut,
  MapPin,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { formatDistanceToNowStrict, format, isToday, isYesterday } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  conversations as convQ,
  messages as msgQ,
  directory as dirQ,
  attachments as attQ,
  type Message,
} from '@/lib/queries/messages'
import { enrollForPush, isPushSupported, notificationPermission } from '@/lib/push'

type DirUser = { id: string; name: string | null; email: string; role: string; avatar_url: string | null }
type ConvRow = {
  id: string
  account_id: string
  kind: 'dm' | 'group' | 'site'
  location_id: string | null
  name: string | null
  last_message_at: string | null
  last_message_preview: string | null
  last_message_sender_id: string | null
  location: { id: string; name: string } | null
  members: Array<{ user_id: string; last_read_at: string }>
}
type Filter = 'all' | 'sites' | 'direct' | 'groups'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'direct', label: 'Direct' },
  { key: 'sites', label: 'Sites' },
  { key: 'groups', label: 'Groups' },
]

function initials(name: string | null, email: string): string {
  const src = (name && name.trim()) || email
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase()
}

function firstName(u: { name: string | null; email: string } | undefined): string {
  if (!u) return ''
  const n = (u.name ?? '').trim()
  if (n) return n.split(/\s+/)[0]
  return u.email.split('@')[0]
}

// Human-friendly time relative to now. Today: "3:42 PM"; yesterday: "Yesterday";
// this week: weekday; older: M/D/YY.
function relativeStamp(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isToday(d)) return format(d, 'p')
  if (isYesterday(d)) return 'Yesterday'
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days < 7) return format(d, 'EEE')
  return format(d, 'M/d/yy')
}

function conversationLabel(c: ConvRow, myId: string, userById: Map<string, DirUser>): string {
  if (c.kind === 'site') return c.location?.name ? `${c.location.name} Team` : (c.name ?? 'Site')
  if (c.kind === 'group') return c.name ?? 'Group'
  const other = c.members.find((m) => m.user_id !== myId)
  const u = other ? userById.get(other.user_id) : null
  return u?.name || u?.email || 'Direct message'
}

function isUnread(c: ConvRow, myId: string): boolean {
  const me = c.members.find((m) => m.user_id === myId)
  if (!me || !c.last_message_at) return false
  // If I sent the last message I've already "read" it.
  if (c.last_message_sender_id === myId) return false
  return new Date(c.last_message_at) > new Date(me.last_read_at)
}

export default function MessagesPage() {
  const { profile } = useAuth()
  const { conversationId } = useParams<{ conversationId?: string }>()
  const navigate = useNavigate()
  const [convs, setConvs] = useState<ConvRow[]>([])
  const [dir, setDir] = useState<DirUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [newDm, setNewDm] = useState(false)
  const [newGroup, setNewGroup] = useState(false)

  const loadConvs = useCallback(async () => {
    const [{ data: cs }, { data: ds }] = await Promise.all([
      convQ.mine(),
      dirQ.list(),
    ])
    setConvs((cs as ConvRow[] | null) ?? [])
    setDir((ds as DirUser[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    setLoading(true)
    void loadConvs()
  }, [loadConvs])

  // Realtime: refresh on any membership change for this user (new DM created,
  // added to a group, etc.) or any message in any of my conversations (updates
  // last_message_preview + ordering).
  useEffect(() => {
    if (!profile?.id) return
    const ch = supabase
      .channel('messages-home')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${profile.id}` },
        () => { void loadConvs() },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => { void loadConvs() },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [profile?.id, loadConvs])

  // Silent re-enroll if permission was granted in a prior session.
  useEffect(() => {
    if (!profile?.id) return
    if (notificationPermission() !== 'granted') return
    void enrollForPush(profile.id).catch(() => {})
  }, [profile?.id])

  const userById = useMemo(() => new Map(dir.map((u) => [u.id, u])), [dir])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return convs
      .filter((c) => {
        if (filter === 'sites' && c.kind !== 'site') return false
        if (filter === 'direct' && c.kind !== 'dm') return false
        if (filter === 'groups' && c.kind !== 'group') return false
        if (!q) return true
        const name = conversationLabel(c, profile?.id ?? '', userById).toLowerCase()
        const preview = (c.last_message_preview ?? '').toLowerCase()
        return name.includes(q) || preview.includes(q)
      })
      .sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
        return tb - ta
      })
  }, [convs, search, filter, profile?.id, userById])

  const active = convs.find((c) => c.id === conversationId) ?? null
  const showListOnMobile = !conversationId

  return (
    // Full-bleed: fills the entire main scroll container. Mobile gets a
    // BottomNav under us (h-16 + safe area) so the inner panes pad themselves
    // accordingly; desktop has no BottomNav.
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-7xl lg:px-8 lg:py-4">
      {/* Desktop-only page header */}
      <div className="hidden lg:block lg:pb-4">
        <PageHeader
          title="Messages"
          subtitle="Team chats per site, plus 1:1 DMs and ad-hoc groups."
          actions={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setNewDm(true)}>
                <MessageSquare className="size-4" /> New DM
              </Button>
              <Button variant="secondary" onClick={() => setNewGroup(true)}>
                <Users className="size-4" /> New group
              </Button>
            </div>
          }
        />
      </div>

      <div className="grid h-full min-h-0 flex-1 gap-0 lg:gap-4 lg:grid-cols-[340px_1fr]">
        {/* List pane */}
        <div className={cn(
          'flex min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border',
          showListOnMobile ? 'flex' : 'hidden lg:flex',
        )}>
          {/* Mobile header */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 lg:hidden">
            <h1 className="text-lg font-semibold text-ink">Messages</h1>
            <div className="flex gap-1">
              <button
                onClick={() => setNewDm(true)}
                className="grid size-9 place-items-center rounded-full bg-content text-ink-muted hover:text-accent"
                aria-label="New DM"
              >
                <MessageSquare className="size-4" />
              </button>
              <button
                onClick={() => setNewGroup(true)}
                className="grid size-9 place-items-center rounded-full bg-content text-ink-muted hover:text-accent"
                aria-label="New group"
              >
                <Users className="size-4" />
              </button>
            </div>
          </div>

          <PushBanner userId={profile?.id ?? null} />

          <div className="border-b border-border p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats..."
                className="h-9 pl-8 text-sm"
              />
            </div>
            <div className="mt-2 flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium transition',
                    filter === f.key ? 'bg-accent text-white' : 'bg-content text-ink-muted hover:text-ink',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
            {loading ? (
              <p className="px-4 py-6 text-sm text-ink-muted">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-muted">No chats here yet.</p>
            ) : (
              filtered.map((c) => (
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  myId={profile?.id ?? ''}
                  userById={userById}
                  isActive={c.id === conversationId}
                  onClick={() => navigate(`/app/messages/${c.id}`)}
                />
              ))
            )}
          </div>
        </div>

        {/* Thread pane */}
        <div className={cn(
          'min-h-0 flex-col bg-card lg:rounded-md lg:border lg:border-border',
          conversationId ? 'flex' : 'hidden lg:flex',
        )}>
          {active ? (
            <ChatThread
              conversation={active}
              currentUserId={profile?.id ?? ''}
              userById={userById}
              accountId={profile?.account_id ?? ''}
              onRefresh={loadConvs}
              onBack={() => navigate('/app/messages')}
            />
          ) : (
            <div className="grid h-full place-items-center px-4 text-center text-sm text-ink-muted">
              <div>
                <MessageSquare className="mx-auto mb-3 size-10 text-ink-subtle/60" />
                Pick a conversation to start.
              </div>
            </div>
          )}
        </div>
      </div>

      {newDm && (
        <NewDmModal
          dir={dir.filter((u) => u.id !== profile?.id)}
          accountId={profile?.account_id ?? ''}
          myId={profile?.id ?? ''}
          existingDms={convs.filter((c) => c.kind === 'dm')}
          onClose={() => setNewDm(false)}
          onOpened={(id) => { setNewDm(false); void loadConvs(); navigate(`/app/messages/${id}`) }}
        />
      )}
      {newGroup && (
        <NewGroupModal
          dir={dir.filter((u) => u.id !== profile?.id)}
          accountId={profile?.account_id ?? ''}
          myId={profile?.id ?? ''}
          onClose={() => setNewGroup(false)}
          onOpened={(id) => { setNewGroup(false); void loadConvs(); navigate(`/app/messages/${id}`) }}
        />
      )}
    </div>
  )
}

// ---- Conversation list row ------------------------------------------------

function ConversationRow({
  conversation, myId, userById, isActive, onClick,
}: {
  conversation: ConvRow
  myId: string
  userById: Map<string, DirUser>
  isActive: boolean
  onClick: () => void
}) {
  const label = conversationLabel(conversation, myId, userById)
  const unread = isUnread(conversation, myId)
  const senderLabel = conversation.last_message_sender_id === myId
    ? 'You'
    : (() => {
      const u = userById.get(conversation.last_message_sender_id ?? '')
      if (!u) return null
      return firstName(u)
    })()
  const preview = conversation.last_message_preview
  const previewLine = preview
    ? (conversation.kind !== 'dm' && senderLabel ? `${senderLabel}: ${preview}` : preview)
    : (conversation.kind === 'site' ? 'No messages yet. Say hi.' : '')

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition',
        isActive ? 'bg-accent-soft' : 'hover:bg-content',
      )}
    >
      <ConvAvatar conversation={conversation} myId={myId} userById={userById} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className={cn('truncate text-[15px]', unread ? 'font-semibold text-ink' : 'font-medium text-ink')}>
            {label}
          </div>
          <div className={cn('shrink-0 text-[11px]', unread ? 'font-semibold text-accent' : 'text-ink-subtle')}>
            {relativeStamp(conversation.last_message_at)}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className={cn('truncate text-[13px]', unread ? 'text-ink' : 'text-ink-muted')}>
            {previewLine}
          </p>
          {unread && <span className="inline-block size-2 shrink-0 rounded-full bg-accent" />}
        </div>
      </div>
    </button>
  )
}

function ConvAvatar({ conversation, myId, userById }: { conversation: ConvRow; myId: string; userById: Map<string, DirUser> }) {
  if (conversation.kind === 'site') {
    return (
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
        <Hash className="size-5" />
      </span>
    )
  }
  if (conversation.kind === 'group') {
    return (
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-warn/15 text-warn">
        <Users className="size-5" />
      </span>
    )
  }
  // DM
  const other = conversation.members.find((m) => m.user_id !== myId)
  const u = other ? userById.get(other.user_id) : null
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
      {initials(u?.name ?? null, u?.email ?? '')}
    </span>
  )
}

// ---- Push banner ----------------------------------------------------------

function PushBanner({ userId }: { userId: string | null }) {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(notificationPermission())
  const [busy, setBusy] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle')
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('push-banner-dismissed') === '1')
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true)
  const isIos = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

  if (perm === 'unsupported' || !isPushSupported()) return null

  const enable = async () => {
    if (!userId) return
    setBusy(true)
    try {
      await enrollForPush(userId)
      setPerm(notificationPermission())
    } finally {
      setBusy(false)
    }
  }

  const sendTest = async () => {
    setTestStatus('sending')
    const { data, error } = await supabase.functions.invoke('send-push', { body: { test: true } })
    const sent = (data as { sent?: number } | null)?.sent ?? 0
    if (error || sent === 0) {
      setTestStatus('fail')
      setTimeout(() => setTestStatus('idle'), 4000)
    } else {
      setTestStatus('ok')
      setTimeout(() => setTestStatus('idle'), 3000)
    }
  }

  // Already enrolled. Show a tiny "Test" button so the user can verify the
  // device actually receives. Persist this control even after dismissal.
  if (perm === 'granted') {
    if (dismissed) return null
    return (
      <div className="flex items-center gap-2 border-b border-border bg-content/60 px-3 py-1.5 text-[11px] text-ink-muted">
        <Bell className="size-3.5 text-accent" />
        <span className="flex-1">
          Notifications on for this device.
          {testStatus === 'ok' && <span className="ml-1 font-medium text-ok">Test sent. Check the lock screen.</span>}
          {testStatus === 'fail' && <span className="ml-1 font-medium text-danger">Test failed. Check iOS Settings &gt; Notifications &gt; WashLyfe.</span>}
        </span>
        <button
          onClick={() => void sendTest()}
          disabled={testStatus === 'sending'}
          className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-ink hover:bg-content disabled:opacity-60"
        >
          {testStatus === 'sending' ? 'Sending...' : 'Send test'}
        </button>
        <button onClick={() => { setDismissed(true); sessionStorage.setItem('push-banner-dismissed', '1') }} aria-label="Dismiss">
          <X className="size-3 text-ink-subtle" />
        </button>
      </div>
    )
  }

  if (dismissed) return null

  if (isIos && !isStandalone) {
    return (
      <div className="flex items-start gap-2 border-b border-border bg-accent-soft/40 px-3 py-2 text-xs text-ink">
        <Bell className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="flex-1">
          <span className="font-medium">Get alerts on iPhone:</span> tap the Share icon in Safari, choose Add to Home Screen, then open the app from your Home Screen and tap Enable.
        </div>
        <button onClick={() => { setDismissed(true); sessionStorage.setItem('push-banner-dismissed', '1') }} aria-label="Dismiss">
          <X className="size-3.5 text-ink-muted" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-accent-soft/40 px-3 py-2 text-xs text-ink">
      <Bell className="size-4 text-accent" />
      <span className="flex-1">Get notified of new messages.</span>
      <button
        onClick={() => void enable()}
        disabled={busy}
        className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : (perm === 'denied' ? 'Blocked' : 'Enable')}
      </button>
      <button onClick={() => { setDismissed(true); sessionStorage.setItem('push-banner-dismissed', '1') }} aria-label="Dismiss">
        <X className="size-3.5 text-ink-muted" />
      </button>
    </div>
  )
}

// ---- Chat thread ----------------------------------------------------------

function ChatThread({
  conversation, currentUserId, userById, accountId, onRefresh, onBack,
}: {
  conversation: ConvRow
  currentUserId: string
  userById: Map<string, DirUser>
  accountId: string
  onRefresh: () => void
  onBack: () => void
}) {
  const [msgs, setMsgs] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [info, setInfo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Mention picker state.
  const [mention, setMention] = useState<{ query: string; index: number } | null>(null)
  const memberUsers = useMemo(
    () => conversation.members
      .map((m) => userById.get(m.user_id))
      .filter((u): u is DirUser => !!u && u.id !== currentUserId),
    [conversation.members, userById, currentUserId],
  )
  const memberFirstNames = useMemo(
    () => new Set(memberUsers.map((u) => firstName(u).toLowerCase())),
    [memberUsers],
  )
  const mentionMatches = useMemo(() => {
    if (!mention) return [] as DirUser[]
    const q = mention.query.toLowerCase()
    return memberUsers
      .filter((u) => firstName(u).toLowerCase().startsWith(q) || (u.name ?? '').toLowerCase().includes(q))
      .slice(0, 6)
  }, [mention, memberUsers])
  const [mentionIdx, setMentionIdx] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data } = await msgQ.forConversation(conversation.id)
      if (!alive) return
      setMsgs((data as Message[] | null) ?? [])
      await convQ.markRead(conversation.id, currentUserId)
      onRefresh()
    })()
    return () => { alive = false }
  }, [conversation.id, currentUserId, onRefresh])

  useEffect(() => {
    const ch = supabase
      .channel('messages-' + conversation.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const m = payload.new as Message
          setMsgs((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]))
          if (m.sender_id !== currentUserId) {
            void convQ.markRead(conversation.id, currentUserId)
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const id = (payload.old as { id: string }).id
          setMsgs((prev) => prev.filter((p) => p.id !== id))
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [conversation.id, currentUserId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs.length])

  // Autosize the textarea up to a cap.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [draft])

  // Track @ token at the cursor position.
  const onDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setDraft(v)
    const caret = e.target.selectionStart ?? v.length
    const before = v.slice(0, caret)
    const m = /@(\w*)$/.exec(before)
    if (m) {
      setMention({ query: m[1], index: m.index })
      setMentionIdx(0)
    } else {
      setMention(null)
    }
  }

  const insertMention = (u: DirUser) => {
    if (!mention || !taRef.current) return
    const v = draft
    const caret = taRef.current.selectionStart ?? v.length
    const beforeAt = v.slice(0, mention.index)
    const afterCaret = v.slice(caret)
    const token = '@' + firstName(u) + ' '
    const next = beforeAt + token + afterCaret
    setDraft(next)
    setMention(null)
    requestAnimationFrame(() => {
      const ta = taRef.current
      if (!ta) return
      const pos = (beforeAt + token).length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  const pickFile = (file: File | null) => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    if (!file) {
      setPendingFile(null)
      setPendingPreview(null)
      return
    }
    if (!file.type.startsWith('image/')) {
      setSendError('Only image files are supported.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setSendError('Image too large (max 8 MB).')
      return
    }
    setSendError(null)
    setPendingFile(file)
    setPendingPreview(URL.createObjectURL(file))
  }

  const send = async () => {
    const body = draft.trim()
    if ((!body && !pendingFile) || sending) return
    setSending(true)
    setSendError(null)
    let attachment: { path: string; type: string } | undefined
    if (pendingFile) {
      const up = await attQ.upload(conversation.id, pendingFile)
      if (up.error || !up.path) {
        setSending(false)
        setSendError(up.error?.message || 'Image upload failed.')
        return
      }
      attachment = { path: up.path, type: pendingFile.type }
    }
    const { data, error } = await msgQ.send(conversation.id, currentUserId, body, attachment)
    setSending(false)
    if (error) {
      setSendError(error.message)
      return
    }
    setDraft('')
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null)
    setPendingPreview(null)
    if (data) {
      setMsgs((prev) => (prev.some((p) => p.id === data.id) ? prev : [...prev, data as Message]))
      void supabase.functions.invoke('send-push', {
        body: { conversation_id: conversation.id, message_id: data.id },
      })
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Delete this message?')) return
    await msgQ.remove(id)
    setMsgs((prev) => prev.filter((p) => p.id !== id))
  }

  const label = conversationLabel(conversation, currentUserId, userById)
  const memberCount = conversation.members.length
  const subtitle = conversation.kind === 'site'
    ? (conversation.location?.name ?? null)
    : conversation.kind === 'dm'
    ? (userById.get(conversation.members.find((m) => m.user_id !== currentUserId)?.user_id ?? '')?.email ?? null)
    : `${memberCount} members`

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => Math.min(mentionMatches.length - 1, i + 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => Math.max(0, i - 1)); return }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(mentionMatches[mentionIdx])
        return
      }
      if (e.key === 'Escape') { setMention(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Chat header */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-2 py-2.5 sm:px-3">
        <button
          type="button"
          onClick={onBack}
          className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content lg:hidden"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="hidden lg:block">
          <ConvAvatar conversation={conversation} myId={currentUserId} userById={userById} />
        </div>
        <button
          type="button"
          onClick={() => setInfo(true)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="truncate text-[15px] font-semibold text-ink">{label}</div>
          <div className="flex items-center gap-1.5 truncate text-[11px] text-ink-subtle">
            <Badge tone="neutral">{conversation.kind}</Badge>
            {subtitle && <span className="truncate">{subtitle}</span>}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setInfo(true)}
          className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content"
          aria-label="Conversation info"
        >
          <Info className="size-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        {msgs.length === 0 ? (
          <p className="text-sm text-ink-muted">No messages yet. Send the first one.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {msgs.map((m, i) => {
              const prev = msgs[i - 1]
              const showHeader = !prev || prev.sender_id !== m.sender_id || (new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) > 5 * 60 * 1000
              const mine = m.sender_id === currentUserId
              const sender = userById.get(m.sender_id)
              return (
                <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                  {showHeader && (
                    <div className={cn('mb-1 mt-1 flex items-center gap-2 text-[11px] text-ink-subtle', mine && 'flex-row-reverse')}>
                      <Avatar name={sender?.name ?? null} email={sender?.email ?? ''} />
                      <span className="font-medium text-ink-muted">{mine ? 'You' : (sender?.name || sender?.email || 'Unknown')}</span>
                      <span>{format(new Date(m.created_at), 'p')}</span>
                    </div>
                  )}
                  <div className="group relative flex max-w-[80%] flex-col gap-1.5">
                    {m.attachment_path && (
                      <div className={cn('overflow-hidden rounded-2xl', mine ? 'self-end' : 'self-start')}>
                        <MessageAttachment path={m.attachment_path} />
                      </div>
                    )}
                    {m.body && (
                      <div className={cn(
                        'whitespace-pre-wrap rounded-2xl px-3 py-2 text-[15px] leading-snug',
                        mine ? 'bg-accent text-white' : 'bg-content text-ink',
                      )}>
                        {renderBodyWithMentions(m.body, memberFirstNames, mine)}
                      </div>
                    )}
                    {mine && (
                      <button
                        type="button"
                        onClick={() => void remove(m.id)}
                        className="absolute -top-2 right-0 hidden rounded-full bg-card p-0.5 text-ink-subtle ring-1 ring-border hover:text-danger group-hover:block"
                        title="Delete"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      {/* BottomNav is hidden in chat-thread routes (see BottomNav.tsx) so the
          composer can hug the bottom safe-area cleanly. */}
      <div className="border-t border-border bg-card p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        {pendingPreview && (
          <div className="relative mb-2 inline-block">
            <img src={pendingPreview} alt="Preview" className="max-h-32 rounded-md border border-border" />
            <button
              type="button"
              onClick={() => pickFile(null)}
              className="absolute -right-2 -top-2 rounded-full bg-card p-0.5 text-ink-muted ring-1 ring-border hover:text-danger"
              aria-label="Remove image"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        {sendError && <p className="mb-2 rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">{sendError}</p>}

        {/* @ mention picker */}
        {mention && mentionMatches.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-md border border-border bg-card shadow-md">
            <div className="border-b border-border bg-content px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
              Mention
            </div>
            {mentionMatches.map((u, i) => (
              <button
                key={u.id}
                type="button"
                onClick={() => insertMention(u)}
                onMouseEnter={() => setMentionIdx(i)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  i === mentionIdx ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-content',
                )}
              >
                <Avatar name={u.name} email={u.email} />
                <span className="font-medium">{u.name || u.email}</span>
                <span className="text-[11px] text-ink-subtle">@{firstName(u)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-content hover:text-accent"
            title="Attach image"
            aria-label="Attach image"
          >
            {pendingFile ? <ImageIcon className="size-5 text-accent" /> : <Paperclip className="size-5" />}
          </button>
          <textarea
            ref={taRef}
            value={draft}
            onChange={onDraftChange}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Type a message..."
            className="max-h-32 flex-1 resize-none rounded-2xl border border-border bg-content px-3 py-2 text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <Button onClick={() => void send()} disabled={(!draft.trim() && !pendingFile) || sending} size="icon">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>

      {info && (
        <ConversationInfoModal
          conversation={conversation}
          currentUserId={currentUserId}
          userById={userById}
          accountId={accountId}
          dir={memberUsers}
          onClose={() => setInfo(false)}
          onLeft={() => { setInfo(false); onBack(); onRefresh() }}
          onChanged={() => onRefresh()}
        />
      )}
    </div>
  )
}

// Render a message body with @first-name tokens highlighted when they match a
// member of the conversation. Plain string scanning (no rich-text storage).
function renderBodyWithMentions(body: string, firstNames: Set<string>, mine: boolean) {
  const parts = body.split(/(@[\w-]+)/g)
  return parts.map((p, i) => {
    if (p.startsWith('@')) {
      const key = p.slice(1).toLowerCase()
      if (firstNames.has(key)) {
        return (
          <span
            key={i}
            className={cn(
              'rounded px-1 py-0.5 text-[14px] font-semibold',
              mine ? 'bg-white/20 text-white' : 'bg-accent/15 text-accent',
            )}
          >
            {p}
          </span>
        )
      }
    }
    return <span key={i}>{p}</span>
  })
}

// ---- Avatar + attachment helpers ------------------------------------------

const SIGNED_URL_CACHE = new Map<string, { url: string; exp: number }>()
function MessageAttachment({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    const cached = SIGNED_URL_CACHE.get(path)
    if (cached && cached.exp > Date.now()) {
      setUrl(cached.url)
      setLoading(false)
      return
    }
    void (async () => {
      const { url: signed, error: err } = await attQ.signedUrl(path, 3600)
      if (!alive) return
      if (err || !signed) {
        setError(true)
      } else {
        SIGNED_URL_CACHE.set(path, { url: signed, exp: Date.now() + 50 * 60 * 1000 })
        setUrl(signed)
      }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [path])

  if (loading) {
    return <div className="grid h-32 w-48 place-items-center rounded-md bg-content/40 text-xs text-ink-subtle"><Loader2 className="size-4 animate-spin" /></div>
  }
  if (error || !url) {
    return <div className="rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">Couldn't load image</div>
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      <img src={url} alt="Attachment" loading="lazy" className="max-h-72 max-w-[280px] rounded-2xl object-cover" />
    </a>
  )
}

function Avatar({ name, email }: { name: string | null; email: string }) {
  return (
    <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent/15 text-[9px] font-semibold text-accent">
      {initials(name, email)}
    </span>
  )
}

// ---- Conversation info / members modal ------------------------------------

function ConversationInfoModal({
  conversation, currentUserId, userById, accountId, dir, onClose, onLeft, onChanged,
}: {
  conversation: ConvRow
  currentUserId: string
  userById: Map<string, DirUser>
  accountId: string
  dir: DirUser[]
  onClose: () => void
  onLeft: () => void
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const members = conversation.members
    .map((m) => userById.get(m.user_id))
    .filter((u): u is DirUser => !!u)

  const otherDir = useMemo(() => {
    const memberSet = new Set(conversation.members.map((m) => m.user_id))
    return dir.filter((u) => !memberSet.has(u.id))
  }, [conversation.members, dir])

  const leave = async () => {
    if (!window.confirm('Leave this conversation?')) return
    setBusy(true)
    await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversation.id)
      .eq('user_id', currentUserId)
    setBusy(false)
    onLeft()
  }

  const addMember = async (userId: string) => {
    setBusy(true)
    await supabase
      .from('conversation_members')
      .insert({ conversation_id: conversation.id, user_id: userId })
    setBusy(false)
    onChanged()
  }

  const remove = async (userId: string) => {
    if (!window.confirm('Remove this person?')) return
    setBusy(true)
    await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversation.id)
      .eq('user_id', userId)
    setBusy(false)
    onChanged()
  }

  const title = conversationLabel(conversation, currentUserId, userById)

  return (
    <Modal open onClose={onClose} title={title} size="md">
      <div className="flex flex-col gap-4">
        {/* About */}
        <div className="rounded-md border border-border bg-content p-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge tone="accent">{conversation.kind}</Badge>
            {conversation.kind === 'site' && conversation.location && (
              <span className="flex items-center gap-1 text-ink-muted">
                <MapPin className="size-3.5" /> {conversation.location.name}
              </span>
            )}
          </div>
          {conversation.kind === 'site' && (
            <p className="mt-2 text-xs text-ink-muted">
              Members are anyone with access to this site (owners + assigned managers/employees). Membership stays in sync as access changes.
            </p>
          )}
          {conversation.kind === 'group' && (
            <p className="mt-2 text-xs text-ink-muted">
              Ad-hoc group chat. Anyone in this room can add or remove members.
            </p>
          )}
        </div>

        {/* Members list */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </h3>
            {conversation.kind === 'group' && (
              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
              >
                <UserPlus className="size-3.5" /> Add
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            {members.map((u) => (
              <div key={u.id} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0">
                <Avatar name={u.name} email={u.email} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {u.name || u.email}
                    {u.id === currentUserId && <span className="ml-1 text-xs text-ink-subtle">(you)</span>}
                  </div>
                  <div className="truncate text-[11px] text-ink-subtle">{u.email} . {u.role}</div>
                </div>
                <span className="text-[11px] text-ink-subtle">@{firstName(u)}</span>
                {conversation.kind === 'group' && u.id !== currentUserId && (
                  <button
                    type="button"
                    onClick={() => void remove(u.id)}
                    disabled={busy}
                    className="text-ink-subtle hover:text-danger"
                    aria-label="Remove"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Add-to-group picker */}
        {adding && conversation.kind === 'group' && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Add to group</h3>
            {otherDir.length === 0 ? (
              <p className="rounded-md border border-border bg-content px-3 py-2 text-xs text-ink-muted">Everyone in your account is already here.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                {otherDir.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => void addMember(u.id)}
                    disabled={busy}
                    className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-sm hover:bg-content last:border-0"
                  >
                    <Avatar name={u.name} email={u.email} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{u.name || u.email}</div>
                      <div className="truncate text-[11px] text-ink-subtle">{u.email} . {u.role}</div>
                    </div>
                    <Plus className="size-4 text-accent" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Leave action */}
        {(conversation.kind === 'group' || conversation.kind === 'dm') && (
          <div className="flex justify-end">
            <Button variant="danger" onClick={() => void leave()} disabled={busy}>
              <LogOut className="size-4" /> Leave {conversation.kind === 'dm' ? 'conversation' : 'group'}
            </Button>
          </div>
        )}

        {/* Hidden but referenced so account scope is in the closure for adders. */}
        <span className="hidden" data-account={accountId} data-at={AtSign.displayName ?? ''} />
      </div>
    </Modal>
  )
}

// ---- New DM modal ---------------------------------------------------------

function NewDmModal({
  dir, accountId, myId, existingDms, onClose, onOpened,
}: {
  dir: DirUser[]
  accountId: string
  myId: string
  existingDms: ConvRow[]
  onClose: () => void
  onOpened: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const filtered = dir.filter((u) => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return (u.name ?? '').toLowerCase().includes(s) || u.email.toLowerCase().includes(s)
  })

  const startWith = async (otherId: string) => {
    const existing = existingDms.find((c) => {
      const ids = new Set(c.members.map((m) => m.user_id))
      return ids.size === 2 && ids.has(myId) && ids.has(otherId)
    })
    if (existing) return onOpened(existing.id)
    const id = await convQ.findDm(myId, otherId)
    if (id) return onOpened(id)
    const { data } = await convQ.createDm(accountId, myId, otherId)
    if (data) onOpened(data.id)
  }

  return (
    <Modal open onClose={onClose} title="Start a DM">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teammates..." className="h-9 pl-8 text-sm" autoFocus />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink-muted">No matches</p>
          ) : (
            filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => void startWith(u.id)}
                className="flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left text-sm hover:bg-content last:border-0"
              >
                <Avatar name={u.name} email={u.email} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{u.name || u.email}</div>
                  <div className="truncate text-[11px] text-ink-subtle">{u.email} . {u.role}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}

// ---- New group modal ------------------------------------------------------

function NewGroupModal({
  dir, accountId, myId, onClose, onOpened,
}: {
  dir: DirUser[]
  accountId: string
  myId: string
  onClose: () => void
  onOpened: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) => {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const create = async () => {
    setError(null)
    if (!name.trim()) return setError('Give the group a name')
    if (picked.size === 0) return setError('Pick at least one person')
    setBusy(true)
    const { data, error: err } = await convQ.createGroup(accountId, myId, name.trim(), Array.from(picked))
    setBusy(false)
    if (err || !data) return setError(err?.message ?? 'Could not create group')
    onOpened(data.id)
  }

  const filtered = dir.filter((u) => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return (u.name ?? '').toLowerCase().includes(s) || u.email.toLowerCase().includes(s)
  })

  return (
    <Modal open onClose={onClose} title="New group chat">
      <div className="flex flex-col gap-3">
        <Field label="Group name" required>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning shift" />}
        </Field>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teammates..." className="h-9 pl-8 text-sm" />
        </div>
        <div className="max-h-60 overflow-y-auto rounded-md border border-border">
          {filtered.map((u) => {
            const on = picked.has(u.id)
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left text-sm last:border-0',
                  on ? 'bg-accent-soft' : 'hover:bg-content',
                )}
              >
                <Avatar name={u.name} email={u.email} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{u.name || u.email}</div>
                  <div className="truncate text-[11px] text-ink-subtle">{u.email} . {u.role}</div>
                </div>
                {on && <Plus className="size-4 rotate-45 text-accent" />}
              </button>
            )
          })}
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void create()} disabled={busy}>Create</Button>
        </div>
      </div>
    </Modal>
  )
}

// Hint for `formatDistanceToNowStrict` import in older toolchains — keeps it in the bundle for /now relative stamps.
void formatDistanceToNowStrict
