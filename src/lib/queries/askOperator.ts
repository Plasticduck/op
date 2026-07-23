import { supabase } from '@/lib/supabase'

// "Ask Operator" data assistant. Everything runs in the ask-operator edge
// function, which queries the database read-only under the caller's own RLS.
export type AskTurn = { role: 'user' | 'assistant'; content: string }
export type AskStep = { tool?: string; sql?: string; rowCount?: number; error?: string }
export type AskResult = { answer?: string; steps?: AskStep[]; error?: string; message?: string }

export const askOperator = {
  ask: (question: string, history: AskTurn[]) =>
    supabase.functions.invoke('ask-operator', { body: { question, history } }),
}
