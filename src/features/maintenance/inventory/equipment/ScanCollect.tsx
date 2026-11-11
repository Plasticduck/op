import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { BarcodeScanner } from '@/components/scan/BarcodeScanner'
import { Button } from '@/components/ui/Button'
import { parseScan } from '@/features/it/inventory/scan'

// Scan stickers one after another to pick machines for a bulk change. The list already
// knows every machine's tag, so nothing goes to the server per scan.

export function ScanCollect({ count, onScan, onClose }: { count: number; onScan: (tag: string) => 'added' | 'again' | 'unknown'; onClose: () => void }) {
  const [last, setLast] = useState<{ text: string; tone: 'ok' | 'warn' | 'danger' } | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
        <span className="text-sm font-medium">{count} selected. Keep scanning.</span>
        <button type="button" aria-label="Done" onClick={onClose} className="grid size-10 place-items-center rounded-full bg-white/10"><X className="size-5" /></button>
      </div>
      <BarcodeScanner continuous className="min-h-0 flex-1" onDetect={(text) => {
        const tag = parseScan(text)?.tag
        if (!tag) { setLast({ text: "That isn't one of our stickers.", tone: 'danger' }); return }
        const r = onScan(tag)
        setLast(r === 'added' ? { text: `${tag} added.`, tone: 'ok' } : r === 'again' ? { text: `${tag} is already picked.`, tone: 'warn' } : { text: `${tag} isn't in this list.`, tone: 'danger' })
      }} />
      <div className="flex flex-col gap-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {last && (
          <p className={last.tone === 'ok' ? 'rounded-md bg-ok px-3 py-2 text-sm text-white' : last.tone === 'warn' ? 'rounded-md bg-warn px-3 py-2 text-sm text-white' : 'rounded-md bg-danger px-3 py-2 text-sm text-white'}>{last.text}</p>
        )}
        <Button size="lg" onClick={onClose}>Done</Button>
      </div>
    </div>
  )
}
