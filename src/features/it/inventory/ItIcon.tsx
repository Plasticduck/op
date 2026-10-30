import { createElement } from 'react'
import { Package } from 'lucide-react'
import { IT_ICONS } from './icons'

// A category's icon by its stored key (it_categories.icon).
export function ItIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  return createElement((name && IT_ICONS[name]) || Package, { className })
}
