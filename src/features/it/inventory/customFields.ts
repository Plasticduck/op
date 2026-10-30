import type { ItCustomField } from '@/lib/queries/itInventory'
import type { ItRefs } from './useItRefs'

// Custom fields that apply to an item: its category's fields plus its model's,
// in the order the admin set.
export function fieldsFor(refs: ItRefs, categoryId: string | null | undefined, modelId?: string | null): ItCustomField[] {
  const ids = new Set<string>()
  const cat = categoryId ? refs.category.get(categoryId) : undefined
  const model = modelId ? refs.model.get(modelId) : undefined
  for (const fs of [cat?.default_fieldset_id, model?.fieldset_id]) {
    if (fs) for (const id of refs.fieldsetFields.get(fs) ?? []) ids.add(id)
  }
  return refs.fields.filter((f) => ids.has(f.id)).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
}

// Categories a field is attached to.
export function categoriesFor(refs: ItRefs, fieldId: string): string[] {
  return refs.categories
    .filter((c) => c.default_fieldset_id && (refs.fieldsetFields.get(c.default_fieldset_id) ?? []).includes(fieldId))
    .map((c) => c.id)
}

export const FIELD_TYPES: { key: string; label: string }[] = [
  { key: 'text', label: 'Text' },
  { key: 'number', label: 'Number' },
  { key: 'date', label: 'Date' },
  { key: 'boolean', label: 'Yes or no' },
  { key: 'select', label: 'Pick from a list' },
  { key: 'url', label: 'Link' },
  { key: 'ip', label: 'IP address' },
  { key: 'secret', label: 'Secret (admins only)' },
]

export const fieldOptions = (f: ItCustomField): string[] => (Array.isArray(f.options) ? (f.options as unknown[]).map(String) : [])

// A short, stable key from a field name: "Firmware version" -> firmware_version.
export const keyFromName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40) || 'field'
