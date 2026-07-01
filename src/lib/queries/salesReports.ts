import { supabase } from '@/lib/supabase'

// Daily general sales reports are stored as file attachments in ops_attachments
// (entity_type has no check constraint, so a new type just works). Keyed by site
// (entity_id) and the report day (label = 'YYYY-MM-DD'), so listing a day's
// uploads for a site is a simple filtered select.
const ENTITY = 'sales_report'

export type SalesReportFile = {
  id: string
  file_name: string | null
  file_type: string | null
  created_at: string
}

export const salesReports = {
  list: (locationId: string, reportDate: string) =>
    supabase
      .from('ops_attachments')
      .select('id, file_name, file_type, created_at')
      .eq('entity_type', ENTITY)
      .eq('entity_id', locationId)
      .eq('label', reportDate)
      .order('created_at', { ascending: false }),

  upload: (params: {
    account_id: string
    location_id: string
    report_date: string
    file_name: string
    file_type: string
    data_uri: string
  }) =>
    supabase.from('ops_attachments').insert({
      account_id: params.account_id,
      entity_type: ENTITY,
      entity_id: params.location_id,
      label: params.report_date,
      file_name: params.file_name,
      file_type: params.file_type,
      data_uri: params.data_uri,
    }),

  getDataUri: (id: string) =>
    supabase
      .from('ops_attachments')
      .select('data_uri, file_type, file_name')
      .eq('id', id)
      .single(),

  remove: (id: string) => supabase.from('ops_attachments').delete().eq('id', id),
}
