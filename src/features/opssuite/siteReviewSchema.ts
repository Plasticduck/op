export type SiteReviewItemType = 'pass_fail' | 'text' | 'number' | 'attachment' | 'comments'

export type SiteReviewItem = {
  id: string
  label: string
  type: SiteReviewItemType
  required?: boolean
  helpText?: string
}

export type SiteReviewSection = {
  id: string
  title: string
  items: SiteReviewItem[]
}

export type SiteReviewSchema = {
  version: 1
  sections: SiteReviewSection[]
}

export type SiteReviewAnswers = Record<string, unknown>

export const DEFAULT_SITE_REVIEW_SCHEMA: SiteReviewSchema = {
  version: 1,
  sections: [
    {
      id: 'site_approach',
      title: 'Site Approach',
      items: [
        { id: 'trash_on_lot', label: 'Trash on lot and curbs', type: 'pass_fail' },
        { id: 'signs_clean_visible', label: 'Signs are clean, visible, and not fading', type: 'pass_fail' },
        { id: 'xpt_screens_clean', label: 'XPT screens and area are clean', type: 'pass_fail' },
        { id: 'building_clean_yard_maintained', label: 'Building clean and yard maintained with no weeds', type: 'pass_fail' },
        { id: 'employees_clean_attire', label: 'Employees clean and in proper attire', type: 'pass_fail' },
        { id: 'employee_present_at_xpts', label: 'Employee present at XPTs when arrived', type: 'pass_fail' },
        { id: 'dumpster_pad_clean', label: 'Dumpster pad clean of debris and gates shut', type: 'pass_fail' },
      ],
    },
    {
      id: 'tunnel',
      title: 'Tunnel',
      items: [
        { id: 'cleanliness_of_walls', label: 'Cleanliness of walls', type: 'pass_fail' },
        { id: 'windows_cleaned', label: 'Windows cleaned outside and in (including sills)', type: 'pass_fail' },
        { id: 'equipment_working', label: 'Equipment working properly', type: 'pass_fail' },
        { id: 'equipment_cleaned', label: 'Equipment cleaned properly', type: 'pass_fail' },
        { id: 'chain_tension', label: 'Chain tension', type: 'pass_fail' },
        { id: 'tool_room_clean', label: 'Tool room cleaned and organized', type: 'pass_fail' },
        { id: 'floor_ceiling_cleaned', label: 'Floor and ceiling cleaned', type: 'pass_fail' },
        { id: 'trash_cleaned_power_locks', label: 'Trash cleaned from power locks', type: 'pass_fail' },
        { id: 'cameras_wiped', label: 'All cameras wiped', type: 'pass_fail' },
      ],
    },
    {
      id: 'procedures_management',
      title: 'Procedures / Management',
      items: [
        { id: 'proper_prepping', label: 'Proper prepping procedures', type: 'pass_fail' },
        { id: 'proper_hand_dry', label: 'Proper hand dry procedures', type: 'pass_fail' },
        { id: 'proper_qc', label: 'Proper QC procedures', type: 'pass_fail' },
        { id: 'proper_interior', label: 'Proper interior procedures', type: 'pass_fail' },
        { id: 'finished_product', label: 'Finished product', type: 'pass_fail' },
      ],
    },
    {
      id: 'summary',
      title: 'Summary',
      items: [
        { id: 'summary', label: 'Overall summary / action items', type: 'comments' },
        { id: 'photos', label: 'Photos / attachments', type: 'attachment' },
      ],
    },
  ],
}

export function emptyAnswersFor(schema: SiteReviewSchema): SiteReviewAnswers {
  const answers: SiteReviewAnswers = {}
  for (const section of schema.sections) {
    for (const item of section.items) {
      switch (item.type) {
        case 'pass_fail':
          answers[item.id] = { value: null, comments: '' }
          break
        case 'text':
          answers[item.id] = { value: '' }
          break
        case 'number':
          answers[item.id] = { value: null }
          break
        case 'attachment':
          answers[item.id] = { attachmentIds: [] }
          break
        case 'comments':
          answers[item.id] = { value: '' }
          break
      }
    }
  }
  return answers
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
