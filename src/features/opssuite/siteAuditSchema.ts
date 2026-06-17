export type SiteAuditItemType = 'pass_fail' | 'text' | 'number' | 'attachment' | 'comments'

export type SiteAuditItem = {
  id: string
  label: string
  type: SiteAuditItemType
  required?: boolean
  helpText?: string
}

export type SiteAuditSection = {
  id: string
  title: string
  items: SiteAuditItem[]
}

export type SiteAuditSchema = {
  version: 1
  sections: SiteAuditSection[]
}

export type SiteAuditAnswers = Record<string, unknown>

export const DEFAULT_SITE_AUDIT_SCHEMA: SiteAuditSchema = {
  version: 1,
  sections: [
    {
      id: 'initial_observations',
      title: 'Initial Observations (Curb Appeal)',
      items: [
        {
          id: 'observations',
          label: 'Paint, Signage, Trash, Team Appearance/Hustle',
          type: 'comments',
        },
      ],
    },
    {
      id: 'primary',
      title: 'Primary (Washing your Car)',
      items: [
        { id: 'pay_stations', label: 'Pay Stations', type: 'pass_fail', helpText: 'Attended? Clean? Free of Sticky Notes? Etc.' },
        { id: 'prep', label: 'Prep', type: 'pass_fail', helpText: 'Friendly? Neat Appearance? Efficient? Timely?' },
        { id: 'tunnel', label: 'Tunnel', type: 'pass_fail', helpText: 'Clean? Uncluttered?' },
        { id: 'equipment', label: 'Equipment', type: 'pass_fail', helpText: 'Clean? Working/Spinning? Touching the car?' },
        { id: 'chemical', label: 'Chemical', type: 'pass_fail', helpText: 'Working? Good Coverage?' },
        { id: 'blowers', label: 'Blowers', type: 'pass_fail', helpText: 'Clean? Functioning? Free of Debris?' },
        { id: 'qc', label: 'QC', type: 'pass_fail', helpText: 'Friendly? Neat Appearance? Efficient? Complete?' },
        { id: 'primary_comments', label: 'Section comments (optional)', type: 'comments' },
      ],
    },
    {
      id: 'secondary',
      title: 'Secondary (Behind the Scenes)',
      items: [
        { id: 'mechanical_room', label: 'Mechanical Room', type: 'pass_fail', helpText: 'Clean? Neat? Organized?' },
        { id: 'office', label: 'Office', type: 'pass_fail', helpText: 'Clean? Neat? Organized?' },
        { id: 'restrooms', label: 'Restrooms', type: 'pass_fail', helpText: 'Clean? Neat? Supplies?' },
        { id: 'vac_shed', label: 'Vac Shed', type: 'pass_fail', helpText: 'Uncluttered? Organized?' },
        { id: 'vac_area', label: 'Vac Area', type: 'pass_fail', helpText: 'Clean? Hoses? Attachments? Trash Cans?' },
        { id: 'vac_pressure', label: 'Vac Pressure', type: 'pass_fail' },
        { id: 'secondary_comments', label: 'Section comments (optional)', type: 'comments' },
      ],
    },
    {
      id: 'priority',
      title: 'Priority (Safety)',
      items: [
        { id: 'fire_extinguishers', label: 'Fire Extinguishers', type: 'pass_fail', helpText: 'Tagged? Off the Ground?' },
        { id: 'safety_supplies', label: 'Safety Supplies', type: 'pass_fail', helpText: 'Stocked?' },
        { id: 'first_aid_kit', label: 'First Aid Kit', type: 'pass_fail', helpText: 'Stocked?' },
        { id: 'hazmat_suits', label: 'Hazmat Suits', type: 'pass_fail', helpText: 'Available?' },
        { id: 'safety_signage', label: 'Safety Signage', type: 'pass_fail', helpText: 'Visible? Clean?' },
        { id: 'housekeeping', label: 'Housekeeping', type: 'pass_fail', helpText: 'Complete?' },
        { id: 'storage_tool_room', label: 'Storage/Tool Room', type: 'pass_fail', helpText: 'Clean? Organized?' },
        { id: 'site_hazards', label: 'Site Hazards', type: 'pass_fail', helpText: 'Extension Cords? Ladders? Electrical Boxes?' },
        { id: 'priority_comments', label: 'Section comments (optional)', type: 'comments' },
      ],
    },
    {
      id: 'final_thoughts',
      title: 'Final Thoughts (Customer Takeaways)',
      items: [
        { id: 'customer_service', label: 'Customer Service', type: 'pass_fail' },
        { id: 'fast', label: 'Fast', type: 'pass_fail' },
        { id: 'friendly', label: 'Friendly', type: 'pass_fail' },
        { id: 'clean', label: 'Clean', type: 'pass_fail' },
        { id: 'efficient', label: 'Efficient', type: 'pass_fail' },
        { id: 'anything_stand_out', label: 'Anything Stand Out: (Good or Bad)', type: 'pass_fail' },
        { id: 'final_thoughts_comments', label: 'Section comments (optional)', type: 'comments' },
      ],
    },
    {
      id: 'explanation',
      title: 'Explanation',
      items: [
        { id: 'explanation', label: 'Explanation', type: 'comments' },
      ],
    },
    {
      id: 'attachments',
      title: 'Attachments',
      items: [
        { id: 'photos', label: 'Photos / attachments', type: 'attachment' },
      ],
    },
  ],
}

export function emptyAnswersFor(schema: SiteAuditSchema): SiteAuditAnswers {
  const answers: SiteAuditAnswers = {}
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
