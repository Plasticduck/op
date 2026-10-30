import type { ImportEntity } from '@/lib/queries/itInventory'

// What each import understands. `synonyms` are header names people actually
// use; the wizard matches a spreadsheet's columns to fields with them and the
// person fixes anything it got wrong.

export type ImportField = { key: string; label: string; required?: boolean; synonyms: string[]; example?: string }

const ASSET_FIELDS: ImportField[] = [
  { key: 'tag', label: 'Tag', synonyms: ['tag', 'asset tag', 'tag number', 'asset id', 'asset number', 'asset no', 'sticker'], example: '' },
  { key: 'name', label: 'Name', synonyms: ['name', 'asset name', 'device name', 'device', 'item', 'description'], example: 'Pay Lane 1 pay station' },
  { key: 'site', label: 'Site', required: true, synonyms: ['site', 'location', 'store', 'wash', 'site name', 'branch'], example: 'MW12' },
  { key: 'area', label: 'Area', synonyms: ['area', 'room', 'zone', 'placement', 'where'], example: 'Pay Lane 1' },
  { key: 'category', label: 'Category', synonyms: ['category', 'type', 'device type', 'asset type', 'kind'], example: 'Pay Station' },
  { key: 'model', label: 'Model', synonyms: ['model', 'model name'], example: 'XPT' },
  { key: 'manufacturer', label: 'Manufacturer', synonyms: ['manufacturer', 'make', 'brand', 'mfr'], example: 'DRB' },
  { key: 'serial', label: 'Serial number', synonyms: ['serial', 'serial number', 'serial no', 's n', 'sn'], example: 'DRB-XPT-00412' },
  { key: 'mac', label: 'MAC address', synonyms: ['mac', 'mac address'], example: '' },
  { key: 'ip', label: 'IP address', synonyms: ['ip', 'ip address'], example: '192.168.1.40' },
  { key: 'hostname', label: 'Hostname', synonyms: ['hostname', 'host name', 'computer name'], example: '' },
  { key: 'status', label: 'Status', synonyms: ['status', 'state'], example: 'In Service' },
  { key: 'purchase_date', label: 'Purchase date', synonyms: ['purchase date', 'purchased', 'date purchased', 'bought on', 'install date'], example: '2024-03-15' },
  { key: 'purchase_cost', label: 'Cost', synonyms: ['cost', 'price', 'purchase cost', 'purchase price', 'amount'], example: '8500' },
  { key: 'supplier', label: 'Bought from', synonyms: ['supplier', 'vendor', 'bought from', 'seller', 'reseller'], example: '' },
  { key: 'order_number', label: 'Order number', synonyms: ['order', 'order number', 'po', 'po number', 'invoice', 'invoice number'], example: '' },
  { key: 'warranty_end', label: 'Warranty ends', synonyms: ['warranty', 'warranty end', 'warranty ends', 'warranty expires', 'warranty expiration'], example: '2027-03-15' },
  { key: 'notes', label: 'Notes', synonyms: ['notes', 'note', 'comments', 'comment'], example: '' },
]

const MODEL_FIELDS: ImportField[] = [
  { key: 'name', label: 'Model name', required: true, synonyms: ['model', 'model name', 'name'], example: 'XPT' },
  { key: 'manufacturer', label: 'Manufacturer', synonyms: ['manufacturer', 'make', 'brand', 'mfr'], example: 'DRB' },
  { key: 'category', label: 'Category', synonyms: ['category', 'type', 'device type', 'kind'], example: 'Pay Station' },
  { key: 'model_number', label: 'Model number', synonyms: ['model number', 'model no', 'part number', 'sku'], example: '' },
  { key: 'warranty_months', label: 'Warranty (months)', synonyms: ['warranty', 'warranty months', 'warranty length'], example: '24' },
  { key: 'eol_months', label: 'End of life (months)', synonyms: ['eol', 'end of life', 'life', 'lifespan', 'eol months'], example: '84' },
  { key: 'notes', label: 'Notes', synonyms: ['notes', 'note', 'comments'], example: '' },
]

const SUBSCRIPTION_FIELDS: ImportField[] = [
  { key: 'name', label: 'Name', required: true, synonyms: ['name', 'subscription', 'service', 'plan name'], example: 'Spectrum Business Internet' },
  { key: 'site', label: 'Site (blank = every site)', synonyms: ['site', 'location', 'store', 'wash'], example: 'MW12' },
  { key: 'provider', label: 'Provider', synonyms: ['provider', 'vendor', 'supplier', 'company', 'carrier'], example: 'Spectrum' },
  { key: 'category', label: 'Category', synonyms: ['category', 'type', 'kind'], example: 'Internet Service' },
  { key: 'account_number', label: 'Account number', synonyms: ['account', 'account number', 'account no', 'circuit', 'circuit id'], example: '8448-1102-334' },
  { key: 'seats', label: 'Seats', synonyms: ['seats', 'licenses', 'users', 'quantity', 'qty'], example: '' },
  { key: 'cost', label: 'Cost', synonyms: ['cost', 'price', 'amount', 'monthly cost', 'fee'], example: '219.99' },
  { key: 'billing_cycle', label: 'Billing cycle', synonyms: ['billing cycle', 'billing', 'cycle', 'frequency', 'term'], example: 'monthly' },
  { key: 'start_date', label: 'Start date', synonyms: ['start', 'start date', 'started'], example: '2024-01-01' },
  { key: 'renewal_date', label: 'Renewal date', synonyms: ['renewal', 'renewal date', 'renews', 'renews on', 'expires', 'expiration'], example: '2026-12-31' },
  { key: 'auto_renew', label: 'Auto renews', synonyms: ['auto renew', 'auto renews', 'autorenew', 'auto'], example: 'yes' },
  { key: 'cancel_notice_days', label: 'Cancel notice (days)', synonyms: ['cancel notice', 'notice', 'notice days', 'cancel notice days'], example: '30' },
  { key: 'notes', label: 'Notes', synonyms: ['notes', 'note', 'comments'], example: '' },
]

export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  assets: ASSET_FIELDS,
  models: MODEL_FIELDS,
  subscriptions: SUBSCRIPTION_FIELDS,
}

export const ENTITY_LABEL: Record<ImportEntity, string> = { assets: 'Equipment', models: 'Models', subscriptions: 'Subscriptions' }

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Best field for each spreadsheet column ('' = don't import). Exact synonym
// matches first, then a column that contains a synonym (longest wins). Each
// field is used once.
export function autoMap(headers: string[], fields: ImportField[]): string[] {
  const taken = new Set<string>()
  const out = headers.map(() => '')
  const hs = headers.map(norm)
  hs.forEach((h, i) => {
    const f = fields.find((x) => !taken.has(x.key) && (x.synonyms.includes(h) || norm(x.label) === h))
    if (f) { out[i] = f.key; taken.add(f.key) }
  })
  hs.forEach((h, i) => {
    if (out[i] || !h) return
    let best: { key: string; len: number } | null = null
    for (const f of fields) {
      if (taken.has(f.key)) continue
      for (const s of f.synonyms) {
        if (s.length >= 3 && (h.includes(s) || s.includes(h)) && (!best || s.length > best.len)) best = { key: f.key, len: s.length }
      }
    }
    if (best) { out[i] = best.key; taken.add(best.key) }
  })
  return out
}
