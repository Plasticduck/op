export type SignageCategory = { slug: string; name: string }

// Top-level product categories, mirrored from the sign vendor's "Select
// Products" menu. Order matches the vendor's site. Items/subcategories get
// filled in per category as their screenshots come in.
export const SIGNAGE_CATEGORIES: SignageCategory[] = [
  { slug: 'specialty-printing-products', name: 'Specialty Printing Products' },
  { slug: 'banners', name: 'Banners' },
  { slug: 'flags', name: 'Flags' },
  { slug: 'hardware', name: 'Hardware' },
  { slug: 'yard-signs', name: 'Yard Signs' },
  { slug: 'banner-stands', name: 'Banner Stands' },
  { slug: 'tradeshow-printing', name: 'Tradeshow Printing' },
  { slug: 'adhesive-vinyl-products', name: 'Adhesive Vinyl Products' },
  { slug: 'floor-adhesive-products', name: 'Floor Adhesive Products' },
  { slug: 'rigid-substrates', name: 'Rigid Substrates' },
  { slug: 'full-sheets', name: 'Full Sheets' },
  { slug: 'magnets', name: 'Magnets' },
  { slug: 'signage', name: 'Signage' },
  { slug: 'paper-products', name: 'Paper Products' },
  { slug: 'fabric', name: 'Fabric' },
  { slug: 'art-displays', name: 'Art Displays' },
  { slug: 'frames-and-stands', name: 'Frames & Stands' },
]
