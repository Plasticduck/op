import { useParams } from 'react-router-dom'
import { AssetDetail } from './AssetDetail'
import { AssetList } from './AssetList'

// IT Inventory (docs/it-inventory/SPEC.md). /app/it-inventory is the list,
// /app/it-inventory/:id one asset.
export default function ItInventoryPage() {
  const { id } = useParams()
  return id ? <AssetDetail key={id} id={id} /> : <AssetList />
}
