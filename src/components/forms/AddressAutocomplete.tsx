import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

export type AddressPick = { address: string; lat: number; lon: number }

type Suggestion = { label: string; lat: number; lon: number }
type NominatimAddress = Record<string, string | undefined>
type NominatimItem = {
  lat: string
  lon: string
  display_name: string
  address?: NominatimAddress
}

function formatAddress(item: NominatimItem): string {
  const a = item.address
  if (!a) return item.display_name
  const line1 = [a.house_number, a.road].filter(Boolean).join(' ')
  const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb
  const parts = [line1, city, a.state, a.postcode].filter(Boolean)
  // Fall back to the full display_name if we couldn't assemble a street line.
  return line1 ? parts.join(', ') : item.display_name
}

// Free, keyless address type-ahead via Nominatim (OpenStreetMap) with full
// address details, so suggestions are exact street addresses. Selecting one
// yields a clean label + exact coordinates. Debounced + min length keeps the
// request rate low (Nominatim only sees a call when the user pauses typing).
export function AddressAutocomplete({
  id,
  value,
  placeholder,
  onChange,
  onSelect,
}: {
  id?: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
  onSelect: (pick: AddressPick) => void
}) {
  const [items, setItems] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [searching, setSearching] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const justPicked = useRef(false)

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false
      return
    }
    const q = value.trim()
    if (q.length < 4) {
      setItems([])
      setOpen(false)
      return
    }
    const ctrl = new AbortController()
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal, headers: { Accept: 'application/json' } },
        )
        if (!res.ok) return
        const arr = (await res.json()) as NominatimItem[]
        const sugg = (Array.isArray(arr) ? arr : [])
          .map((it) => ({ label: formatAddress(it), lat: parseFloat(it.lat), lon: parseFloat(it.lon) }))
          .filter((s) => s.label && Number.isFinite(s.lat))
        setItems(sugg)
        setOpen(sugg.length > 0)
        setActive(-1)
      } catch {
        /* aborted or network error */
      } finally {
        setSearching(false)
      }
    }, 450)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [value])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const pick = (s: Suggestion) => {
    justPicked.current = true
    onChange(s.label)
    onSelect({ address: s.label, lat: s.lat, lon: s.lon })
    setOpen(false)
    setItems([])
  }

  return (
    <div className="relative" ref={boxRef}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault()
            pick(items[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && (
        <ul className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
          {items.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
                className={cn(
                  'flex w-full items-start gap-2 px-3 py-2 text-left text-sm',
                  i === active ? 'bg-content' : 'hover:bg-content',
                )}
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" />
                <span className="text-ink">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searching && value.trim().length >= 4 && items.length === 0 && (
        <p className="mt-1 text-xs text-ink-subtle">Searching…</p>
      )}
    </div>
  )
}
