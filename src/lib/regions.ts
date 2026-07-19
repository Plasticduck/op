// Region -> site grouping, shared across features (violations, dashboard) and
// editable in Company settings. Built-in defaults seed a new account and act as
// the fallback until a custom configuration is saved.

// Seed shape: sites referenced by location name (used before we know ids).
export type NamedRegion = { name: string; sites: string[] }

// Saved/effective shape: sites referenced by location id.
export type RegionDef = { name: string; siteIds: string[] }

export type RegionGroup<L> = { region: string; locations: L[] }

export const DEFAULT_REGIONS: NamedRegion[] = [
  { name: 'Corporate', sites: ['Corporate'] },
  {
    name: 'Lubbock Region',
    sites: ['Site 1', 'Site 5', 'Site 7', 'Site 9', 'Site 10', 'Site 11', 'Site 14'],
  },
  {
    name: 'Permian Basin Region (A)',
    sites: [
      'Site 2',
      'Site 4',
      'Site 6',
      'Site 8',
      'Site 13',
      'Site 15',
      'Site 22',
      'Site 24',
      'Site 25',
    ],
  },
  { name: 'Permian Basin Region (B)', sites: ['Site 3', 'Site 12', 'Site 31'] },
  {
    name: 'New Mexico Region',
    sites: ['Site 16', 'Site 17', 'Site 18', 'Site 19', 'Site 20', 'Site 21', 'Site 23', 'Site 26'],
  },
  {
    name: 'Central Region',
    sites: ['Site 27', 'Site 28', 'Site 29', 'Site 30', 'Spotless'],
  },
]

// Short display labels for the dashboard region toggle. Names not listed show
// as-is.
export function shortRegionLabel(name: string): string {
  const map: Record<string, string> = {
    'Permian Basin Region (A)': 'PB Region A',
    'Permian Basin Region (B)': 'PB Region B',
    'New Mexico Region': 'NM Region',
  }
  return map[name] ?? name
}

// The effective regions for an account: exactly what it has saved, and nothing
// otherwise. Regions are per-account, so one account's regions never appear on
// another's. An account with no saved regions shows its sites ungrouped.
// DEFAULT_REGIONS is only a template for seeding, never an automatic fallback.
export function resolveRegions(saved?: RegionDef[] | null): RegionDef[] {
  return saved && saved.length ? saved : []
}

// Group locations into id-based regions. Any location not in a region falls
// into a trailing "Other" group so nothing is hidden. Empty regions are dropped.
export function groupByRegions<L extends { id: string; name: string }>(
  locations: L[],
  regions: RegionDef[],
): RegionGroup<L>[] {
  const byId = new Map(locations.map((l) => [l.id, l]))
  const groups: RegionGroup<L>[] = regions.map((r) => ({
    region: r.name,
    locations: r.siteIds.map((id) => byId.get(id)).filter((l): l is L => Boolean(l)),
  }))
  const claimed = new Set(regions.flatMap((r) => r.siteIds))
  const other = locations.filter((l) => !claimed.has(l.id))
  if (other.length) groups.push({ region: 'Other', locations: other })
  return groups.filter((g) => g.locations.length > 0)
}
