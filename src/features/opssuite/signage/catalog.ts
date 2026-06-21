export type SignageCategory = {
  slug: string
  name: string
  // Second-level options shown in the vendor's flyout for this category.
  // Sizes and pricing per option come next.
  items: string[]
}

// Mirrored from the sign vendor's "Select Products" menu (sharperprinting.com).
// Order matches the vendor's site. `items` are the options under each category.
export const SIGNAGE_CATEGORIES: SignageCategory[] = [
  {
    slug: 'specialty-printing-products',
    name: 'Specialty Printing Products',
    items: [
      '15 oz. Vinyl Banners DS (Mascot Junction)',
      '15 oz. Vinyl Banners SS (Mascot Junction)',
      'Extra High Tac Vinyl',
      'Low Tac Vinyl (Mascot Junction)',
      'MAG X (Mascot Junction)',
      'Magnets Dry Erase (Mascot Junction)',
      'Magnets (Mascot Junction)',
      'Marine Vinyl Bottom (MBS)',
      'Marine Vinyl Nose (MBS)',
      'Multishield (Mascot Junction)',
      'Thought Bubbles - Controltac (Mascot Junction)',
    ],
  },
  {
    slug: 'banners',
    name: 'Banners',
    items: [
      '13 oz. Vinyl Banners',
      '15 oz. Vinyl Banners',
      '18 oz. Vinyl Banners',
      'Mesh Banners',
    ],
  },
  {
    slug: 'flags',
    name: 'Flags',
    items: [
      'Angled Feather Flags',
      'Convex Feather Flags',
      'Econo Feather Flags',
      'Pole Flags',
      'Teardrop Flags',
      'Wholesale Rectangular Feather Flags',
    ],
  },
  {
    slug: 'hardware',
    name: 'Hardware',
    items: [
      'Cross Base with Water Bag',
      'Deluxe A-Frame Hardware',
      'Deluxe Retractable Banner Stand Hardware',
      'Feather Flag Replacement Pole & Hardware Set',
      'Ground Stake',
      'Square Feather Flag Base',
      'Standard Retractable Banner Stand Hardware',
      'Tube Display (Step & Repeat) Hardware',
      'X-Stand Hardware',
    ],
  },
  {
    slug: 'yard-signs',
    name: 'Yard Signs',
    items: ['H-Stakes Heavy Duty', 'H-Stakes for Yard Signs', 'Yard Signs'],
  },
  {
    slug: 'banner-stands',
    name: 'Banner Stands',
    items: [
      'Clear Deluxe Retractable Banner Stand',
      'Clear Standard Retractable Banner Stand',
      'Deluxe Retractable Banner Stand - Double Sided',
      'Deluxe Retractable Banner Stand - Single Sided',
      'Mini Retractable Banner Stand',
      'Miniature X-Stand Banner',
      'SD Retractable Banner Stand',
      'Standard Retractable Banner Stand',
      'X-Stand Display Banner',
    ],
  },
  {
    slug: 'tradeshow-printing',
    name: 'Tradeshow Printing',
    items: [
      '8-Foot Custom Tablecloth',
      'Custom 6-Foot Table Cover',
      'Economy Tube Display (Step & Repeat)',
      'Event Tent',
      'Floor Mat',
      'Heavy Duty Tube Display (Step & Repeat)',
      'Rigid Substrate M Base',
      'Table Runner',
      "Tension Fabric Display - 6' Curved",
      "Tension Fabric Display - 8' & 10' Curved",
      'Tension Fabric Display - Straight',
      'Tension Fabric Stand',
      'Velcro Fabric Display - Curved',
      'Velcro Fabric Pop-Up Display - Straight',
      'Xanita Board',
    ],
  },
  {
    slug: 'adhesive-vinyl-products',
    name: 'Adhesive Vinyl Products',
    items: [
      '3M™ 40C Controltac™ Print Film',
      'Adhesive Vinyl',
      'Air Release Gloss Vinyl',
      'AlumiGraphics® GRIP',
      'AlumiGraphics® SMOOTH',
      'Brick Vinyl',
      'Car Wrap Vinyl - 3M 180',
      'Car Wrap Vinyl - 3M 480',
      'Clear Adhesive Vinyl Film',
      'Embossed Wall Vinyl',
      'Extra High Tac Vinyl',
      'Front Mount Adhesive',
      'Frosted Vinyl',
      'Glass Apeel',
      'Photo Tex',
      'Photo Tex EX High Tack',
      'Polar Smooth 150 Air',
      'Reflective Adhesive Vinyl',
      'Static Cling Vinyl Film',
      'Stickers',
      'Translucent Vinyl',
      'TwoWay Vision',
      'Window Perf (Exterior Mount)',
      'Window Perf (Interior Mount - Clear)',
      'panoRama Walk & Wall',
    ],
  },
  {
    slug: 'floor-adhesive-products',
    name: 'Floor Adhesive Products',
    items: [
      'Carpet Vinyl',
      'Embossed Floor Vinyl',
      'FloorAppeal',
      'Sidewalk Graphics Media',
    ],
  },
  {
    slug: 'rigid-substrates',
    name: 'Rigid Substrates',
    items: [
      '1/4" Clear Acrylic',
      '1/4" White Acrylic',
      '3/16" Clear Acrylic',
      '3/16" White Acrylic',
      'Aluminum',
      'Bubble X',
      'Bulldog Board Material - 3mm C2S',
      'Coroplast - 10mm',
      'Coroplast - 4mm',
      'Foam Core',
      'Foam PVC - 3mm',
      'Foam PVC - 6mm',
      'Gatorplast - 1/2" White',
      'Gatorplast - 3/16" White',
      'Max Metal - 3mm',
      'Max Metal - 6mm',
      'Multishield',
      'Polycarbonate',
      'Styrene',
    ],
  },
  {
    slug: 'full-sheets',
    name: 'Full Sheets',
    items: [
      '3mm Foam PVC Full Sheets',
      '3mm Max Metal Full Sheets',
      '4mm Coroplast Full Sheets',
      'Foam Core Full Sheets',
      'Styrene Full Sheets',
    ],
  },
  {
    slug: 'magnets',
    name: 'Magnets',
    items: ['Custom Vehicle Magnets', 'Small Magnets'],
  },
  {
    slug: 'signage',
    name: 'Signage',
    items: ['Deluxe A-Frame', 'LED Backlit Polyester', 'LED Light Box Insert'],
  },
  {
    slug: 'paper-products',
    name: 'Paper Products',
    items: ['C2S 24pt Paper Board', 'Paper Poster'],
  },
  {
    slug: 'fabric',
    name: 'Fabric',
    items: ['Flag Fabric'],
  },
  {
    slug: 'art-displays',
    name: 'Art Displays',
    items: ['Canvas Wraps', 'Custom Canvas', 'Framed Print', 'Snap Poster Hanger'],
  },
  {
    slug: 'frames-and-stands',
    name: 'Frames & Stands',
    items: [
      'Banjo Frame',
      'Folding Frame',
      'Outdoor Sidewalk Sign',
      'Rigid Product M Base',
      'T-Bar Stake',
    ],
  },
]

// ---------------------------------------------------------------------------
// Per-item order form ("Job Specifications") + product info.
//
// Each item that has been built out gets a SignageItemDetail. The spec fields
// mirror the vendor's order form for that product. Pricing on the vendor side
// is a live quote computed server-side; until we have their price model we show
// the minimum order and treat it as the unit price.
// ---------------------------------------------------------------------------

export type SpecField =
  | { kind: 'text'; key: string; label: string; placeholder?: string }
  | { kind: 'textarea'; key: string; label: string; placeholder?: string }
  | { kind: 'number'; key: string; label: string; default: number; min?: number }
  | {
      kind: 'size'
      key: string
      label: string
      unit: string
      defaultWidth: number
      defaultHeight: number
    }
  | { kind: 'select'; key: string; label: string; options: string[]; default: string }

export type SignageItemDetail = {
  /** Display title as the vendor shows it, e.g. "Custom 13-oz. Vinyl Banners". */
  title: string
  minimumOrder?: string
  features?: string
  info?: { label: string; value: string }[]
  specs: SpecField[]
  notes?: string[]
}

// Keyed by `${categorySlug}::${itemName}`.
export const SIGNAGE_ITEM_DETAILS: Record<string, SignageItemDetail> = {
  'banners::13 oz. Vinyl Banners': {
    title: 'Custom 13-oz. Vinyl Banners',
    minimumOrder: '$12.00 per artwork',
    features:
      'Tear and fade resistant, our 13 oz. vinyl banner material is an economical choice for advertising your message. Printed single sided, in full color and high resolution, the 1000 x 1000 dpi print makes this style perfect for indoor and outdoor applications. Printed on 13 oz. vinyl, these custom banners are hemmed on all sides with grommets every two feet for easy display.',
    info: [
      { label: 'Substrate', value: '13 oz. Vinyl Material' },
      { label: 'Color', value: 'Printed Full Color' },
      { label: 'Sided', value: 'Single Sided' },
      {
        label: 'Standard Grommets',
        value:
          'Choose the layout you need in the dropdown menu and select the chrome, black, or brass grommet color you desire.',
      },
      {
        label: 'Wind Slits',
        value:
          'Strategically placed half-circle cuts placed throughout the banner to allow wind to flow through and reduce tension caused by wind load.',
      },
      {
        label: 'Pole Pockets',
        value:
          'Extra fabric wrapped around and hemmed to create a strong pocket that the pole slides through. Available at the top and bottom, the top only, or the bottom only.',
      },
      {
        label: 'Reinforced Corners',
        value: 'Adds extra strength to the corners if there are grommets.',
      },
      {
        label: 'Banner Webbing',
        value:
          'Nylon webbing added to the hem that strengthens the banner and reinforces grommets from being torn out by nature elements such as high wind.',
      },
    ],
    notes: [
      'Artwork includes a 1" bleed on all sides.',
      'All important elements are at least 1" from the edge.',
      'No crop marks are present in artwork.',
      'If you require slits, pole pockets, reinforced corners, or webbing on your custom vinyl banners, please specify in the dropdown menus.',
    ],
    specs: [
      { kind: 'text', key: 'project_title', label: 'Project Title' },
      { kind: 'number', key: 'quantity', label: 'Quantity', default: 1, min: 1 },
      {
        kind: 'size',
        key: 'product_size',
        label: 'Product Size (Width x Height)',
        unit: '"',
        defaultWidth: 12,
        defaultHeight: 12,
      },
      {
        kind: 'select',
        key: 'proofs',
        label: 'Proofs',
        options: ['PDF Proof', 'No Proof'],
        default: 'PDF Proof',
      },
      {
        kind: 'select',
        key: 'grommet_layout',
        label: 'Standard Grommet Layout',
        options: ['Every 2 Feet', 'Corners Only', 'No Grommets', 'Custom'],
        default: 'Every 2 Feet',
      },
      {
        kind: 'select',
        key: 'grommet_color',
        label: 'Grommet Color',
        options: ['Black', 'Chrome', 'Brass'],
        default: 'Black',
      },
      {
        kind: 'select',
        key: 'hem',
        label: 'Hem',
        options: ['All Sides', 'No Hem'],
        default: 'All Sides',
      },
      {
        kind: 'select',
        key: 'wind_slits',
        label: 'Wind Slits',
        options: ['No', 'Yes'],
        default: 'No',
      },
      {
        kind: 'select',
        key: 'pole_pocket',
        label: 'Pole Pocket',
        options: ['No', 'Top & Bottom', 'Top Only', 'Bottom Only'],
        default: 'No',
      },
      {
        kind: 'select',
        key: 'reinforced_corners',
        label: 'Reinforced Corners',
        options: ['No', 'Yes'],
        default: 'No',
      },
      {
        kind: 'select',
        key: 'webbing',
        label: 'Webbing',
        options: ['No', 'Yes'],
        default: 'No',
      },
      {
        kind: 'textarea',
        key: 'special_instructions',
        label: 'Special Instructions',
      },
    ],
  },
}

export function getItemDetail(
  categorySlug: string,
  itemName: string,
): SignageItemDetail | undefined {
  return SIGNAGE_ITEM_DETAILS[`${categorySlug}::${itemName}`]
}

/** Parse a leading dollar amount like "$12.00 per artwork" into 12. */
export function parseMinimum(minimumOrder?: string): number | null {
  if (!minimumOrder) return null
  const m = minimumOrder.match(/\$?([\d,]+(?:\.\d+)?)/)
  return m ? Number(m[1].replace(/,/g, '')) : null
}
