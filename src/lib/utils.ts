import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}

// Natural / human sort so "Site #2" precedes "Site #10", and named sites like
// "Spotless" sort after the numbered ones.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b)
}

// Order locations: numbered "Site #N" ascending, then any named sites A→Z.
export function compareLocationName(a: string, b: string): number {
  const na = /\d/.test(a)
  const nb = /\d/.test(b)
  if (na !== nb) return na ? -1 : 1
  return naturalCompare(a, b)
}
