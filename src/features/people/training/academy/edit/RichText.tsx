import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bold, Code2, Heading2, Italic, List, ListOrdered, MessageSquareQuote, Pilcrow, Table, Type } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sanitizeHtml } from '../prose'
import { areaCls } from './fields'

type ToolId = 'p' | 'h2' | 'lead' | 'bold' | 'italic' | 'ul' | 'ol' | 'callout' | 'table'
const TOOLS: { id: ToolId; icon: ReactNode; label: string }[] = [
  { id: 'p', icon: <Pilcrow className="size-4" />, label: 'Paragraph' },
  { id: 'h2', icon: <Heading2 className="size-4" />, label: 'Heading' },
  { id: 'lead', icon: <Type className="size-4" />, label: 'Intro (lead) paragraph' },
  { id: 'bold', icon: <Bold className="size-4" />, label: 'Bold' },
  { id: 'italic', icon: <Italic className="size-4" />, label: 'Italic' },
  { id: 'ul', icon: <List className="size-4" />, label: 'Bulleted list' },
  { id: 'ol', icon: <ListOrdered className="size-4" />, label: 'Numbered list' },
  { id: 'callout', icon: <MessageSquareQuote className="size-4" />, label: 'Callout' },
  { id: 'table', icon: <Table className="size-4" />, label: 'Table' },
]
const COMMANDS: Record<Exclude<ToolId, 'lead'>, [string, string?]> = {
  p: ['formatBlock', 'p'],
  h2: ['formatBlock', 'h2'],
  bold: ['bold'],
  italic: ['italic'],
  ul: ['insertUnorderedList'],
  ol: ['insertOrderedList'],
  callout: ['insertHTML', '<div class="callout"><div class="eyebrow red">Remember</div><p>Callout text</p></div><p></p>'],
  table: ['insertHTML', '<div class="tablewrap"><table><tbody><tr><th>Item</th><th>Standard</th></tr><tr><td class="k">Item</td><td>What good looks like</td></tr></tbody></table></div><p></p>'],
}

// A small writing box for lesson text: headings, lists, bold, the intro "lead" style,
// callouts and tables, with an HTML view for anything else. What it saves is
// sanitized, the same as what lessons show.
export function RichText({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [htmlMode, setHtmlMode] = useState(false)
  const [raw, setRaw] = useState(value)

  // Fill the box once (and when leaving the HTML view). After that it owns its text.
  useEffect(() => {
    if (!htmlMode && box.current && box.current.innerHTML !== value) box.current.innerHTML = sanitizeHtml(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlMode])

  const emit = () => { if (box.current) onChange(box.current.innerHTML) }
  const run = (cmd: string, arg?: string) => {
    box.current?.focus()
    document.execCommand(cmd, false, arg)
    emit()
  }
  // The block element around the cursor, inside the box.
  const currentBlock = (): HTMLElement | null => {
    const sel = window.getSelection()
    let n: Node | null = sel?.anchorNode ?? null
    while (n && n !== box.current) {
      if (n instanceof HTMLElement && /^(P|H2|H3|H4|LI|DIV)$/.test(n.tagName)) return n
      n = n.parentNode
    }
    return null
  }
  const toggleLead = () => {
    box.current?.focus()
    let b = currentBlock()
    if (!b || b.tagName !== 'P') {
      document.execCommand('formatBlock', false, 'p')
      b = currentBlock()
    }
    if (b && b.tagName === 'P') b.classList.toggle('lead')
    emit()
  }

  const apply = (tool: ToolId) => {
    if (tool === 'lead') { toggleLead(); return }
    const [cmd, arg] = COMMANDS[tool]
    run(cmd, arg)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-content px-1.5 py-1">
        {!htmlMode && TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.label}
            aria-label={t.label}
            onMouseDown={(e) => { e.preventDefault(); apply(t.id) }}
            className="rounded p-1.5 text-ink-muted hover:bg-card hover:text-ink"
          >
            {t.icon}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            if (htmlMode) {
              const clean = sanitizeHtml(raw)
              onChange(clean)
              if (box.current) box.current.innerHTML = clean
            } else {
              setRaw(box.current?.innerHTML ?? value)
            }
            setHtmlMode(!htmlMode)
          }}
          className={cn('ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs', htmlMode ? 'bg-accent text-white' : 'text-ink-muted hover:bg-card hover:text-ink')}
        >
          <Code2 className="size-3.5" /> HTML
        </button>
      </div>
      {htmlMode ? (
        <textarea
          value={raw}
          onChange={(e) => { setRaw(e.target.value); onChange(e.target.value) }}
          rows={18}
          className={cn(areaCls, 'rounded-none border-0 font-mono text-xs')}
        />
      ) : (
        <div
          ref={box}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          data-placeholder="Write the lesson…"
          className="ac-prose ac-editable max-h-[65vh] min-h-48 overflow-y-auto px-4 py-3"
        />
      )}
    </div>
  )
}
