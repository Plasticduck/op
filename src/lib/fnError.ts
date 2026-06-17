// supabase.functions.invoke() puts non-2xx response bodies on the error's
// `context` (a fetch Response), NOT on `data` — so edge-function error
// messages (e.g. Stripe's explanation of why Connect onboarding failed) get
// silently dropped unless you parse them out. This helper does that.

type InvokeError = { context?: Response | unknown; message?: string } | null

export async function fnErrorMessage(
  error: InvokeError,
  data: { message?: string; error?: string } | null,
  fallback: string,
): Promise<string> {
  if (data?.message) return data.message
  if (error && typeof error === 'object' && 'context' in error && error.context instanceof Response) {
    try {
      const body = await error.context.clone().json() as { message?: string; error?: string }
      if (body?.message) return body.message
      if (body?.error) return `${fallback} (${body.error})`
    } catch { /* body wasn't JSON */ }
  }
  if (data?.error) return `${fallback} (${data.error})`
  return fallback
}
