import { useCallback, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import { primeScanSound } from '@/lib/scan/feedback'
import { cn } from '@/lib/utils'
import { AssetDetail } from './AssetDetail'
import { AssetList } from './AssetList'
import { ImportPage } from './ImportPage'
import { OverviewPage } from './OverviewPage'
import { ScanSheet } from './ScanSheet'
import { SettingsPage } from './SettingsPage'
import { StickersPage } from './StickersPage'
import { SubscriptionsPage } from './SubscriptionsPage'
import { SuppliesPage } from './SuppliesPage'

// IT Inventory (docs/it-inventory/SPEC.md). /app/it-inventory is the
// equipment list; /overview, /subscriptions and /supplies are its sibling
// screens; /stickers, /import and /settings are the tools; /:id is one asset.
// On phones a Scan button floats on every screen of the module, one tap away.
export default function ItInventoryPage() {
  const { id } = useParams()
  const { pathname } = useLocation()
  const [scanning, setScanning] = useState(false)
  const openScan = useCallback(() => {
    primeScanSound() // iOS: sound has to start from a tap
    setScanning(true)
  }, [])
  const closeScan = useCallback(() => setScanning(false), [])

  const tool = pathname.match(/\/it-inventory\/(stickers|import|settings|overview|subscriptions|supplies)\/?$/)?.[1]
  // Asset pages hide the bottom nav, so the button can sit lower there.
  const detail = !!id && !tool

  return (
    <>
      {tool === 'stickers' ? <StickersPage />
        : tool === 'import' ? <ImportPage />
          : tool === 'settings' ? <SettingsPage />
            : tool === 'overview' ? <OverviewPage />
              : tool === 'subscriptions' ? <SubscriptionsPage />
                : tool === 'supplies' ? <SuppliesPage />
                  : id ? <AssetDetail key={id} id={id} /> : <AssetList onScan={openScan} />}
      <button
        type="button"
        onClick={openScan}
        aria-label="Scan a sticker"
        className={cn(
          'fixed right-4 z-30 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg transition hover:bg-accent-hover lg:hidden',
          detail ? 'bottom-[calc(1rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(5rem+env(safe-area-inset-bottom))]',
        )}
      >
        <ScanLine className="size-6" />
      </button>
      {scanning && <ScanSheet onClose={closeScan} />}
    </>
  )
}
