// Who can open the FP&A Model page, by email (Kevan, 2026-11-25: "for now, those
// are the only accounts that should see that page"). The route and the Sidebar item
// follow this list. The numbers themselves load only for emails in fpa_readers
// (migrations 0253, 0262), which also decides who Operator AI describes the model
// to; everyone here must be on that list too, or the page opens empty.
export const FPA_PAGE_EMAILS: string[] = [
  'kevan@washlyfe.com',
  'kellyspiller@mighty-wash.com',
  'kspiller@mighty-wash.com',
  'becca.jowers@mighty-wash.com',
  'ssspore@mighty-wash.com',
]
