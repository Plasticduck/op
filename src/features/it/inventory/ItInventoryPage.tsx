import { useLocation, useParams } from 'react-router-dom'
import { AssetDetail } from './AssetDetail'
import { AssetList } from './AssetList'
import { StickersPage } from './StickersPage'

// IT Inventory (docs/it-inventory/SPEC.md). /app/it-inventory is the list,
// /app/it-inventory/stickers the sticker tools, /app/it-inventory/:id one asset.
export default function ItInventoryPage() {
  const { id } = useParams()
  const { pathname } = useLocation()
  if (/\/it-inventory\/stickers\/?$/.test(pathname)) return <StickersPage />
  return id ? <AssetDetail key={id} id={id} /> : <AssetList />
}
