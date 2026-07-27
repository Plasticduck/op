import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type ProcedureTemplate = T['procedure_templates']['Row']
export type ProcedureField = T['procedure_fields']['Row']
export type WorkOrderProcedure = T['work_order_procedures']['Row']
export type WorkOrderProcedureItem = T['work_order_procedure_items']['Row']

export type ProcedureFieldType =
  | 'section' | 'checkbox' | 'text' | 'number' | 'amount' | 'inspection' | 'multiple_choice' | 'date'

export const FIELD_TYPE_OPTIONS: Array<{ value: ProcedureFieldType; label: string }> = [
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'inspection', label: 'Inspection (Pass / Fail / Flag)' },
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'amount', label: 'Amount ($)' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'date', label: 'Date' },
  { value: 'section', label: 'Section heading' },
]

export type TemplateWithCount = ProcedureTemplate & { fields: { count: number }[] }
export type TemplateWithFields = ProcedureTemplate & { fields: ProcedureField[] }
export type WorkOrderProcedureWithItems = WorkOrderProcedure & { items: WorkOrderProcedureItem[] }

// A field as edited in the template editor (before it has an id).
export type DraftField = {
  label: string
  type: ProcedureFieldType
  required: boolean
  options: string[]
}

export const procedures = {
  templates: () =>
    supabase
      .from('procedure_templates')
      .select('*, fields:procedure_fields(count)')
      .eq('archived', false)
      .order('name'),

  template: (id: string) =>
    supabase
      .from('procedure_templates')
      .select('*, fields:procedure_fields(*)')
      .eq('id', id)
      .single(),

  createTemplate: (row: T['procedure_templates']['Insert']) =>
    supabase.from('procedure_templates').insert(row).select().single(),

  updateTemplate: (id: string, patch: T['procedure_templates']['Update']) =>
    supabase.from('procedure_templates').update(patch).eq('id', id).select().single(),

  removeTemplate: (id: string) => supabase.from('procedure_templates').delete().eq('id', id),

  // Set-and-replace the template's fields (mirrors the assignee/category pattern).
  setFields: async (templateId: string, fields: DraftField[]) => {
    await supabase.from('procedure_fields').delete().eq('template_id', templateId)
    if (fields.length > 0) {
      await supabase.from('procedure_fields').insert(
        fields.map((f, i) => ({
          template_id: templateId,
          order_index: i,
          label: f.label,
          type: f.type,
          required: f.required,
          options: f.options,
        })),
      )
    }
  },

  // --- work-order procedures (snapshot instances) ------------------------
  forWorkOrder: (workOrderId: string) =>
    supabase
      .from('work_order_procedures')
      .select('*, items:work_order_procedure_items(*)')
      .eq('work_order_id', workOrderId)
      .order('created_at'),

  // Attach a template to a work order: copy its fields into the instance.
  attach: async (workOrderId: string, template: { id: string; name: string }) => {
    const { data: tf } = await supabase
      .from('procedure_fields')
      .select('*')
      .eq('template_id', template.id)
      .order('order_index')
    const { data: proc, error } = await supabase
      .from('work_order_procedures')
      .insert({ work_order_id: workOrderId, template_id: template.id, name: template.name })
      .select()
      .single()
    if (error || !proc) return { error }
    if (tf && tf.length > 0) {
      await supabase.from('work_order_procedure_items').insert(
        tf.map((f) => ({
          wo_procedure_id: proc.id,
          order_index: f.order_index,
          label: f.label,
          type: f.type,
          required: f.required,
          options: f.options,
        })),
      )
    }
    return { data: proc, error: null }
  },

  detach: (woProcedureId: string) =>
    supabase.from('work_order_procedures').delete().eq('id', woProcedureId),

  setItemValue: (itemId: string, value: string | null, userId: string | null) =>
    supabase
      .from('work_order_procedure_items')
      .update({ value, responded_by: userId, responded_at: new Date().toISOString() })
      .eq('id', itemId),

  setCompleted: (woProcedureId: string, done: boolean) =>
    supabase
      .from('work_order_procedures')
      .update({ completed_at: done ? new Date().toISOString() : null })
      .eq('id', woProcedureId),
}
