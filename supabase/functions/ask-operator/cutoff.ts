// A reply that runs past max_tokens stops wherever it is: mid-sentence, or in the
// middle of a tool call. A cut tool call has broken input and never runs, which is
// how a report used to vanish right after "let me build the report". The loop sends
// the cut back with a note so the model finishes the job.
import type Anthropic from 'npm:@anthropic-ai/sdk'

export type CutOff = {
  // The tool whose call was cut off, or null when it was the written answer.
  tool: string | null
  // The text that did come through, to keep as the model's turn (may be empty).
  kept: Anthropic.TextBlockParam[]
  // What to tell the model next.
  note: string
}

export function recoverCutOff(content: Anthropic.ContentBlock[]): CutOff {
  const kept = content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text' && b.text.trim() !== '')
    .map((b) => ({ type: 'text' as const, text: b.text }))
  const calls = content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!calls.length) {
    return {
      tool: null,
      kept,
      note: 'Your answer was cut off at the length limit. Continue exactly where it stopped, without repeating anything or starting over.',
    }
  }
  // The cut one is always the last; any before it didn't run either, since a
  // reply's tool calls only run once the whole reply is in.
  const tool = calls[calls.length - 1].name
  const others = calls.length > 1 ? ' None of the other tool calls in that reply ran either, so make again any you still need.' : ''
  const note = tool === 'build_report'
    ? 'Your build_report call ran past the length limit and was cut off, so no report reached the user. Call build_report again, smaller: keep each table to the rows and columns that matter most, roll the rest into totals or one short line, and keep text sections brief.' + others
    : `Your ${tool} call ran past the length limit and was cut off, so it did not run. Make it again, shorter.` + others
  return { tool, kept, note }
}

// Adds a note for the model as the next user turn. When the conversation already
// ends on a user turn (tool results, or the question itself), the note joins it,
// so turns keep alternating.
export function appendUserNote(messages: Anthropic.MessageParam[], note: string): void {
  const last = messages[messages.length - 1]
  if (last?.role !== 'user') {
    messages.push({ role: 'user', content: note })
  } else if (typeof last.content === 'string') {
    last.content = `${last.content}\n\n${note}`
  } else {
    last.content = [...last.content, { type: 'text', text: note }]
  }
}
