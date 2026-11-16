// Page grants from the super admin (page_access, migration 0241). An edge function
// that keeps a page's data to named people or roles also lets in anyone granted
// that page on the Team page. Needs a service-role client.

// deno-lint-ignore no-explicit-any
type Any = any

export async function pageGranted(svc: Any, userId: string | null | undefined, page: string): Promise<boolean> {
  if (!userId) return false
  const { data, error } = await svc.rpc('page_granted_for', { p_user: userId, p_page: page })
  return !error && data === true
}
