// Canonical public origin for absolute links that leave the app: magic-link and
// password-reset emails, and copyable invite URLs. Production builds always use
// the custom domain so emails never point at a preview/localhost URL; local dev
// uses the current origin so links still work while developing.
export const SITE_URL = import.meta.env.PROD
  ? 'https://operator.washlyfe.com'
  : (typeof window !== 'undefined' ? window.location.origin : 'https://operator.washlyfe.com')
