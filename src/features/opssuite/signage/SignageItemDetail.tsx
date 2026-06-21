import { useMemo, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import {
  parseMinimum,
  type SignageItemDetail as Detail,
  type SpecField,
} from './catalog'

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

// Build the initial form values from the spec defaults. Everything is stored as
// strings (input-friendly); size fields use `${key}__w` / `${key}__h`.
function initialValues(specs: SpecField[]): Record<string, string> {
  const v: Record<string, string> = {}
  for (const f of specs) {
    if (f.kind === 'size') {
      v[`${f.key}__w`] = String(f.defaultWidth)
      v[`${f.key}__h`] = String(f.defaultHeight)
    } else if (f.kind === 'number') {
      v[f.key] = String(f.default)
    } else if (f.kind === 'select') {
      v[f.key] = f.default
    } else {
      v[f.key] = ''
    }
  }
  return v
}

export function SignageItemDetail({ detail }: { detail: Detail }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(detail.specs),
  )
  const [submitted, setSubmitted] = useState(false)

  const set = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const unitPrice = parseMinimum(detail.minimumOrder)

  // Until we have the vendor's price model, the quote reflects the minimum.
  const subtotal = unitPrice

  const summary = useMemo(
    () =>
      detail.specs.map((f) => {
        if (f.kind === 'size') {
          return {
            label: f.label,
            value: `${values[`${f.key}__w`]}${f.unit} x ${values[`${f.key}__h`]}${f.unit}`,
          }
        }
        return { label: f.label, value: values[f.key] || '—' }
      }),
    [detail.specs, values],
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Product info */}
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">{detail.title}</h2>
          {detail.minimumOrder && (
            <p className="mt-1 text-sm text-ink-muted">
              Minimum order: {detail.minimumOrder}
            </p>
          )}
        </div>

        {detail.notes && detail.notes.length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-md border border-warn/30 bg-warn-soft px-4 py-3">
            {detail.notes.map((n) => (
              <li key={n} className="flex items-start gap-2 text-sm text-ink">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-warn" />
                {n}
              </li>
            ))}
          </ul>
        )}

        {detail.features && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Features
            </h3>
            <p className="mt-1.5 text-sm text-ink-muted">{detail.features}</p>
          </div>
        )}

        {detail.info && detail.info.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Info
            </h3>
            <dl className="mt-2 flex flex-col gap-2">
              {detail.info.map((row) => (
                <div key={row.label} className="text-sm">
                  <dt className="font-medium text-ink">{row.label}</dt>
                  <dd className="text-ink-muted">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {/* Job specifications */}
      <div className="h-fit overflow-hidden rounded-lg border border-border bg-card">
        <div className="bg-shell px-4 py-3 text-sm font-semibold uppercase tracking-wider text-ink-invert">
          Job Specifications
        </div>

        <div className="flex flex-col gap-4 p-4">
          {detail.specs.map((f) => (
            <SpecFieldInput key={f.key} field={f} values={values} set={set} />
          ))}

          <div className="rounded-md border border-border bg-content p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Real Time Quote
            </p>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-ink-muted">Sub Total</span>
              <span className="font-medium text-ink">
                {subtotal != null ? money(subtotal) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-muted">Unit Price</span>
              <span className="font-medium text-ink">
                {unitPrice != null ? money(unitPrice) : '—'}
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-subtle">
              Estimated from the minimum order. Live pricing is configured once
              the vendor price model is added.
            </p>
          </div>

          <Button onClick={() => setSubmitted(true)}>Continue</Button>

          {submitted && (
            <div className="rounded-md border border-border bg-content p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Selected
              </p>
              <dl className="mt-2 flex flex-col gap-1">
                {summary.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-start justify-between gap-3 text-sm"
                  >
                    <dt className="text-ink-muted">{row.label}</dt>
                    <dd className="text-right font-medium text-ink">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-ink-subtle">
                Order submission will be wired up next.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SpecFieldInput({
  field,
  values,
  set,
}: {
  field: SpecField
  values: Record<string, string>
  set: (key: string, value: string) => void
}) {
  if (field.kind === 'size') {
    return (
      <Field label={field.label}>
        {() => (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type="number"
                min={0}
                value={values[`${field.key}__w`]}
                onChange={(e) => set(`${field.key}__w`, e.target.value)}
                aria-label={`${field.label} width`}
              />
            </div>
            <span className="text-sm text-ink-muted">{field.unit} x</span>
            <div className="relative flex-1">
              <Input
                type="number"
                min={0}
                value={values[`${field.key}__h`]}
                onChange={(e) => set(`${field.key}__h`, e.target.value)}
                aria-label={`${field.label} height`}
              />
            </div>
            <span className="text-sm text-ink-muted">{field.unit}</span>
          </div>
        )}
      </Field>
    )
  }

  if (field.kind === 'select') {
    return (
      <Field label={field.label}>
        {(id) => (
          <Select
            id={id}
            value={values[field.key]}
            onChange={(e) => set(field.key, e.target.value)}
          >
            {field.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        )}
      </Field>
    )
  }

  if (field.kind === 'textarea') {
    return (
      <Field label={field.label}>
        {(id) => (
          <textarea
            id={id}
            value={values[field.key]}
            onChange={(e) => set(field.key, e.target.value)}
            rows={3}
            placeholder={field.placeholder}
            className={cn(
              'w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink',
              'placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent',
            )}
          />
        )}
      </Field>
    )
  }

  return (
    <Field label={field.label}>
      {(id) => (
        <Input
          id={id}
          type={field.kind === 'number' ? 'number' : 'text'}
          min={field.kind === 'number' ? field.min : undefined}
          value={values[field.key]}
          onChange={(e) => set(field.key, e.target.value)}
          placeholder={field.kind === 'text' ? field.placeholder : undefined}
        />
      )}
    </Field>
  )
}
