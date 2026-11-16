// Per-account region scoping for On the Clock (the iSolved and FlexWash tabs).
// Some regional managers only need their own region's sites. Site strings are
// the MW codes (MWNN), which match each location's name. Region -> site
// membership mirrors accounts.company_settings.regions (alignment of 2026-11-16,
// migrations 0239-0240); change both together.
export const REGION_SITES: Record<string, string[]> = {
  'Lubbock Region': ['MW01', 'MW05', 'MW07', 'MW09', 'MW10', 'MW11', 'MW32', 'MW33', 'MW34'],
  'Permian Basin - Odessa': ['MW02', 'MW08', 'MW15', 'MW22', 'MW25'],
  'Permian Basin - Midland': ['MW03', 'MW04', 'MW06', 'MW12', 'MW13', 'MW14', 'MW24', 'MW31'],
  'New Mexico Region': ['MW16', 'MW17', 'MW18', 'MW19', 'MW20', 'MW21', 'MW23', 'MW26'],
  'Central Region': ['MW27', 'MW28', 'MW29', 'MW30', 'Spotless'],
}
// Email -> the single region that account is scoped to. Anyone not listed here
// (owners, other admins) sees every site.
export const SITE_SCOPE_BY_EMAIL: Record<string, string> = {
  'mcanales@mighty-wash.com': 'Lubbock Region',
  'isabel@mighty-wash.com': 'Permian Basin - Odessa',
  'djones@mighty-wash.com': 'Permian Basin - Midland',
  'rbreed@mighty-wash.com': 'New Mexico Region',
}
