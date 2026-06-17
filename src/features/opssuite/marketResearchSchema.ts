export type MarketResearchItemType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'rating'
  | 'datetime'
  | 'attachment'

export type MarketResearchItem = {
  id: string
  label: string
  type: MarketResearchItemType
  required?: boolean
  helpText?: string
  options?: string[]
  min?: number
  max?: number
}

export type MarketResearchSection = {
  id: string
  title: string
  items: MarketResearchItem[]
}

export type MarketResearchSchema = {
  version: 1
  sections: MarketResearchSection[]
}

export type MarketResearchAnswers = Record<string, unknown>

export const DEFAULT_MARKET_RESEARCH_SCHEMA: MarketResearchSchema = {
  version: 1,
  sections: [
    {
      id: 'competitor_site_basics',
      title: 'Competitor Site Basics',
      items: [
        { id: 'competitor_brand_name', label: 'Competitor Brand Name', type: 'text', required: true },
        { id: 'address_location', label: 'Address / Location', type: 'text', required: true },
        {
          id: 'operation_type',
          label: 'Type of Operation',
          type: 'select',
          options: [
            'Express tunnel',
            'Full service',
            'Flex service',
            'Self-serve',
            'In-bay automatic',
            'Quick lube + wash combo',
            'Other',
          ],
        },
        {
          id: 'tunnel_length',
          label: 'Approximate Tunnel Length',
          type: 'select',
          options: ['Under 70 ft', '70-90 ft', '90-120 ft', '120-150 ft', '150+ ft', 'Unknown'],
        },
        { id: 'visit_date_time', label: 'Date and Time of Visit', type: 'datetime' },
      ],
    },
    {
      id: 'operational_evaluation',
      title: 'Operational Evaluation',
      items: [
        {
          id: 'staffing_levels',
          label: 'Staffing Levels Observed',
          type: 'select',
          options: ['Fully staffed', 'Slightly understaffed', 'Severely understaffed', 'Overstaffed'],
        },
        { id: 'staff_professionalism', label: 'Staff Professionalism / Appearance', type: 'rating', min: 1, max: 5 },
        { id: 'speed_of_service', label: 'Speed of Service', type: 'rating', min: 1, max: 5 },
        {
          id: 'queue_length',
          label: 'Queue Length at Time of Visit',
          type: 'select',
          options: ['No line', 'Short (1-3 cars)', 'Moderate (4-7 cars)', 'Long (8+ cars)'],
        },
        { id: 'equipment_condition', label: 'Equipment Condition (open answer)', type: 'text' },
        { id: 'notable_technology', label: 'Notable Technology Used', type: 'text' },
        { id: 'operational_strengths', label: 'Any unique operational strengths noticed?', type: 'textarea' },
        { id: 'operational_weaknesses', label: 'Any operational weaknesses observed?', type: 'textarea' },
      ],
    },
    {
      id: 'customer_experience',
      title: 'Customer Experience',
      items: [
        { id: 'customer_service_quality', label: 'Greeting / Customer Service Quality', type: 'rating', min: 1, max: 5 },
        { id: 'site_cleanliness', label: 'Site Cleanliness', type: 'rating', min: 1, max: 5 },
        { id: 'vacuum_area_condition', label: 'Vacuum Area Condition', type: 'rating', min: 1, max: 5 },
        { id: 'amenities_offered', label: 'Amenities Offered (open answer)', type: 'text' },
        {
          id: 'upkeep_issues',
          label: 'Did you observe trash, clutter, or poor upkeep?',
          type: 'select',
          options: ['No', 'Minimal', 'Noticeable', 'Serious issues'],
        },
        {
          id: 'customer_volume',
          label: 'Customer Volume During Visit',
          type: 'select',
          options: ['Low', 'Moderate', 'Busy', 'Very busy'],
        },
      ],
    },
    {
      id: 'pricing_membership',
      title: 'Pricing & Membership Insights',
      items: [
        { id: 'wash_package_names', label: 'Competitor Wash Package Names', type: 'textarea' },
        { id: 'wash_pricing', label: 'Pricing for Each Wash Level', type: 'textarea' },
        { id: 'membership_pricing', label: 'Membership Pricing', type: 'textarea' },
        { id: 'membership_perks', label: 'Membership Perks Observed', type: 'textarea' },
        { id: 'promotional_offers', label: 'Promotional Offers', type: 'textarea' },
        { id: 'upgrades_addons', label: 'Upgrades or Add-ons', type: 'textarea' },
      ],
    },
    {
      id: 'competitive_intelligence',
      title: 'Competitive Intelligence',
      items: [
        { id: 'standout', label: 'What stands out about this competitor?', type: 'textarea' },
        { id: 'strengths', label: 'Their biggest strengths', type: 'textarea' },
        { id: 'weaknesses', label: 'Their biggest weaknesses', type: 'textarea' },
        { id: 'opportunities', label: 'What opportunities does this competitor create for the operator?', type: 'textarea' },
        { id: 'attachments', label: 'Photos / Attachments From Visit', type: 'attachment' },
      ],
    },
  ],
}

export function emptyAnswersFor(schema: MarketResearchSchema): MarketResearchAnswers {
  const answers: MarketResearchAnswers = {}
  for (const section of schema.sections) {
    for (const item of section.items) {
      switch (item.type) {
        case 'text':
        case 'textarea':
        case 'select':
        case 'datetime':
          answers[item.id] = { value: '' }
          break
        case 'rating':
          answers[item.id] = { value: null }
          break
        case 'attachment':
          answers[item.id] = { attachmentIds: [] }
          break
      }
    }
  }
  return answers
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
