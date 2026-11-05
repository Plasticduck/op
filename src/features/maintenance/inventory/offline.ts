import { useEffect, useState } from 'react'
import { miRpc, type ScanResult, type StockRow } from '@/lib/queries/maintenanceInventory'

// Working with no signal. Stock and tool actions go through act(): each gets a
// client_txn_id up front, and if the network is gone it waits in IndexedDB and replays
// later with the same id, so the server posts it once however many times it arrives.
// A snapshot of tags, stock and open work orders lets a scan still resolve offline.

const DB_NAME = 'mi-offline'

export type Queued = { id: string; rpc: string; args: Record<string, unknown>; label: string; created_at: number; error?: string }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('queue', { keyPath: 'id' })
      req.result.createObjectStore('kv')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const r = run(db.transaction(store, mode).objectStore(store))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((f) => f())

export const listQueue = async (): Promise<Queued[]> =>
  (await tx<Queued[]>('queue', 'readonly', (s) => s.getAll() as IDBRequest<Queued[]>)).sort((a, b) => a.created_at - b.created_at)

export const discardQueued = async (id: string) => {
  await tx('queue', 'readwrite', (s) => s.delete(id))
  changed()
}

const isNetworkError = (e: unknown) => /fetch|network|load failed|connection/i.test(e instanceof Error ? e.message : String(e))

let flushing = false
export async function flushQueue(): Promise<void> {
  if (flushing || !navigator.onLine) return
  flushing = true
  try {
    for (const q of await listQueue()) {
      if (q.error) continue // waits for someone to look at it
      try {
        await miRpc(q.rpc, q.args)
        await tx('queue', 'readwrite', (s) => s.delete(q.id))
      } catch (e) {
        if (isNetworkError(e)) break
        await tx('queue', 'readwrite', (s) => s.put({ ...q, error: e instanceof Error ? e.message : String(e) }))
      }
      changed()
    }
  } finally {
    flushing = false
    changed()
  }
}

if (typeof window !== 'undefined') window.addEventListener('online', () => void flushQueue())

export type ActResult<T> = { queued: false; data: T } | { queued: true }

// These functions don't record where an action came from.
const NO_SOURCE = new Set(['mi_start_transfer', 'mi_reserve_parts', 'mi_post_count', 'mi_create_draft_pos'])

// Run a stock or tool action now, or queue it if there's no connection. A refusal from
// the server (not enough stock, wrong location) still throws, so it can be shown.
export async function act<T>(rpc: string, args: Record<string, unknown>, label: string): Promise<ActResult<T>> {
  const id = crypto.randomUUID()
  const full = { ...args, p_client_txn_id: id, ...(NO_SOURCE.has(rpc) ? {} : { p_source: args.p_source ?? 'mobile' }) }
  const enqueue = async (): Promise<ActResult<T>> => {
    await tx('queue', 'readwrite', (s) => s.put({ id, rpc, args: full, label, created_at: Date.now() } satisfies Queued))
    changed()
    return { queued: true }
  }
  if (!navigator.onLine) return enqueue()
  try {
    return { queued: false, data: await miRpc<T>(rpc, full) }
  } catch (e) {
    if (isNetworkError(e)) return enqueue()
    throw e
  }
}

export function usePendingSync() {
  const [items, setItems] = useState<Queued[]>([])
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    let alive = true
    const refresh = () => { void listQueue().then((q) => { if (alive) setItems(q) }).catch(() => {}) }
    const on = () => { setOnline(navigator.onLine); refresh() }
    listeners.add(refresh)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    refresh()
    void flushQueue()
    return () => {
      alive = false
      listeners.delete(refresh)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', on)
    }
  }, [])
  return { items, online, failed: items.filter((i) => i.error), waiting: items.filter((i) => !i.error) }
}

// ---- Snapshot for scanning offline ---------------------------------------------
export type OfflineSnapshot = {
  at: string
  tags: Array<{ code: string; entity_type: string; entity_id: string }>
  stock: StockRow[]
  barcodes: Array<{ code: string; part_id: string; name: string }>
  work_orders: Array<{ id: string; number: number; title: string; location_id: string; equipment_id: string | null }>
  tools: Array<{ id: string; name: string; status: string }>
  locations: Array<{ id: string; name: string; site_id: string | null; type: string }>
}

export async function refreshSnapshot(): Promise<void> {
  try {
    const snap = await miRpc<OfflineSnapshot>('mi_offline_snapshot')
    await tx('kv', 'readwrite', (s) => s.put(snap, 'snapshot'))
  } catch {
    // keep the last one
  }
}

export const readSnapshot = () => tx<OfflineSnapshot | undefined>('kv', 'readonly', (s) => s.get('snapshot') as IDBRequest<OfflineSnapshot | undefined>)

export async function resolveOffline(raw: string): Promise<ScanResult> {
  const snap = await readSnapshot()
  const code = raw.trim().toUpperCase()
  if (!snap) return { kind: 'unknown', raw }
  const tag = snap.tags.find((t) => t.code === code)
  if (tag?.entity_type === 'bin') {
    const stock = snap.stock.filter((s) => s.bin_id === tag.entity_id)
    const first = stock[0]
    return { kind: 'bin', code, id: tag.entity_id, name: first?.bin_name ?? code, location_id: first?.location_id ?? '', location_name: first?.location_name ?? '', site_id: first?.site_id ?? null, can_act: first?.can_act ?? true, stock }
  }
  if (tag) return { kind: tag.entity_type as 'tool' | 'asset' | 'location', code, id: tag.entity_id }
  const bc = snap.barcodes.find((b) => b.code === code)
  if (bc) return { kind: 'part', code, id: bc.part_id, name: bc.name, stock: snap.stock.filter((s) => s.part_id === bc.part_id) }
  return { kind: 'unknown', raw }
}
