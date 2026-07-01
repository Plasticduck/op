// Region -> site grouping, shared across features (violations, dashboard).
// Sites are grouped into regions by their location name.

export type Region = { name: string; sites: string[] }

export const REGIONS: Region[] = [
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

export type RegionGroup<L> = { region: string; locations: L[] }

// Group the given locations into the configured regions (by name). Any location
// that isn't in a region falls into a trailing "Other" group so nothing is
// hidden. Empty regions are dropped.
export function groupLocationsByRegion<L extends { id: string; name: string }>(
  locations: L[],
): RegionGroup<L>[] {
  const byName = new Map(locations.map((l) => [l.name, l]))
  const groups: RegionGroup<L>[] = REGIONS.map((r) => ({
    region: r.name,
    locations: r.sites.map((s) => byName.get(s)).filter((l): l is L => Boolean(l)),
  }))
  const claimed = new Set(REGIONS.flatMap((r) => r.sites))
  const other = locations.filter((l) => !claimed.has(l.name))
  if (other.length) groups.push({ region: 'Other', locations: other })
  return groups.filter((g) => g.locations.length > 0)
}
