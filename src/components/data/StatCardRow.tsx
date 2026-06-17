import { StatCard, type StatCardProps } from '@/components/data/StatCard'
import { cn } from '@/lib/utils'

export type StatCardRowProps = {
  items: StatCardProps[]
  className?: string
}

export function StatCardRow({ items, className }: StatCardRowProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4',
        className,
      )}
    >
      {items.map((item) => (
        <StatCard key={item.label} {...item} />
      ))}
    </div>
  )
}
