import { useEffect, useState } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { customForms } from '@/lib/queries/opsSuite'
import { useAuth } from '@/lib/auth'
import {
  DEFAULT_SITE_REVIEW_SCHEMA,
  slugify,
  type SiteReviewItem,
  type SiteReviewItemType,
  type SiteReviewSchema,
  type SiteReviewSection,
} from './siteReviewSchema'

const ITEM_TYPES: { value: SiteReviewItemType; label: string }[] = [
  { value: 'pass_fail', label: 'Pass / Fail' },
  { value: 'text', label: 'Short text' },
  { value: 'number', label: 'Number' },
  { value: 'attachment', label: 'Attachment' },
  { value: 'comments', label: 'Comments' },
]

function newSectionId(title: string): string {
  const slug = slugify(title)
  return slug || `section_${crypto.randomUUID().slice(0, 8)}`
}

function newItemId(label: string): string {
  const slug = slugify(label)
  return slug || `item_${crypto.randomUUID().slice(0, 8)}`
}

function move<T>(arr: T[], index: number, delta: number): T[] {
  const next = [...arr]
  const target = index + delta
  if (target < 0 || target >= next.length) return arr
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export function SiteReviewBuilder({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const [draft, setDraft] = useState<SiteReviewSchema>(DEFAULT_SITE_REVIEW_SCHEMA)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)
    void customForms
      .get('site_review')
      .then(({ data }) => {
        const schema = data?.schema as SiteReviewSchema | undefined
        setDraft(schema?.sections?.length ? schema : DEFAULT_SITE_REVIEW_SCHEMA)
      })
      .then(() => setLoading(false), () => setLoading(false))
  }, [open])

  const updateSection = (idx: number, patch: Partial<SiteReviewSection>) => {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }))
  }

  const updateItem = (sIdx: number, iIdx: number, patch: Partial<SiteReviewItem>) => {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s, i) =>
        i === sIdx
          ? { ...s, items: s.items.map((it, j) => (j === iIdx ? { ...it, ...patch } : it)) }
          : s,
      ),
    }))
  }

  const addSection = () => {
    setDraft((d) => ({
      ...d,
      sections: [
        ...d.sections,
        { id: newSectionId(''), title: '', items: [] },
      ],
    }))
  }

  const removeSection = (idx: number) => {
    setDraft((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== idx) }))
  }

  const moveSection = (idx: number, delta: number) => {
    setDraft((d) => ({ ...d, sections: move(d.sections, idx, delta) }))
  }

  const addItem = (sIdx: number) => {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s, i) =>
        i === sIdx
          ? { ...s, items: [...s.items, { id: newItemId(''), label: '', type: 'pass_fail' }] }
          : s,
      ),
    }))
  }

  const removeItem = (sIdx: number, iIdx: number) => {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s, i) =>
        i === sIdx ? { ...s, items: s.items.filter((_, j) => j !== iIdx) } : s,
      ),
    }))
  }

  const moveItem = (sIdx: number, iIdx: number, delta: number) => {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s, i) =>
        i === sIdx ? { ...s, items: move(s.items, iIdx, delta) } : s,
      ),
    }))
  }

  const save = async () => {
    if (!profile) {
      setError('You must be signed in to save.')
      return
    }
    if (draft.sections.length === 0) {
      setError('Add at least one section.')
      return
    }
    for (const section of draft.sections) {
      if (!section.title.trim()) {
        setError('Every section needs a title.')
        return
      }
      if (section.items.length === 0) {
        setError(`Section "${section.title}" needs at least one item.`)
        return
      }
      for (const item of section.items) {
        if (!item.label.trim()) {
          setError(`Every item in "${section.title}" needs a label.`)
          return
        }
      }
    }

    const normalized: SiteReviewSchema = {
      version: 1,
      sections: draft.sections.map((s) => ({
        id: s.id || newSectionId(s.title),
        title: s.title.trim(),
        items: s.items.map((it) => ({
          ...it,
          id: it.id || newItemId(it.label),
          label: it.label.trim(),
        })),
      })),
    }

    setError(null)
    setSaving(true)
    const { error: upsertError } = await customForms.upsert(
      'site_review',
      normalized,
      profile.id,
      profile.account_id,
    )
    setSaving(false)
    if (upsertError) {
      setError(upsertError.message)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Customize Monthly Site Review" size="lg">
      {loading ? (
        <p className="text-sm text-ink-muted">Loading.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            Build the checklist your team fills out each month. Reorder sections and items with the arrows.
          </p>

          <div className="flex flex-col gap-4">
            {draft.sections.map((section, sIdx) => (
              <div key={`${section.id}-${sIdx}`} className="rounded-md border border-border bg-card p-4">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <Field label="Section title">
                      {(id) => (
                        <Input
                          id={id}
                          value={section.title}
                          onChange={(e) => updateSection(sIdx, { title: e.target.value })}
                          placeholder="e.g. Tunnel"
                        />
                      )}
                    </Field>
                  </div>
                  <div className="flex items-center gap-1 pt-7">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move section up"
                      disabled={sIdx === 0}
                      onClick={() => moveSection(sIdx, -1)}
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move section down"
                      disabled={sIdx === draft.sections.length - 1}
                      onClick={() => moveSection(sIdx, 1)}
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete section"
                      onClick={() => removeSection(sIdx)}
                    >
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2">
                  {section.items.map((item, iIdx) => (
                    <div
                      key={`${item.id}-${iIdx}`}
                      className="flex items-start gap-2 rounded-md border border-border bg-content/40 p-2"
                    >
                      <div className="flex-1">
                        <Input
                          value={item.label}
                          onChange={(e) => updateItem(sIdx, iIdx, { label: e.target.value })}
                          placeholder="Item label"
                        />
                      </div>
                      <div className="w-44">
                        <Select
                          value={item.type}
                          onChange={(e) =>
                            updateItem(sIdx, iIdx, { type: e.target.value as SiteReviewItemType })
                          }
                        >
                          {ITEM_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Move item up"
                          disabled={iIdx === 0}
                          onClick={() => moveItem(sIdx, iIdx, -1)}
                        >
                          <ChevronUp className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Move item down"
                          disabled={iIdx === section.items.length - 1}
                          onClick={() => moveItem(sIdx, iIdx, 1)}
                        >
                          <ChevronDown className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete item"
                          onClick={() => removeItem(sIdx, iIdx)}
                        >
                          <Trash2 className="size-4 text-danger" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div>
                    <Button variant="secondary" size="sm" onClick={() => addItem(sIdx)}>
                      <Plus className="size-4" /> Add item
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <Button variant="secondary" onClick={addSection}>
              <Plus className="size-4" /> Add section
            </Button>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving.' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
