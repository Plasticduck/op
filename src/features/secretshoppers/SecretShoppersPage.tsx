import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { QrCodeImage } from '@/components/data/QrCodeImage'
import { ShoppersPanel } from './ShoppersPanel'

// Secret Shoppers admin (/app/secret-shoppers, SECRET_SHOPPER_EMAILS only, not
// in the sidebar). Shoppers themselves never come here: they use the Secret
// Shopper phone app at /shop (ShopperApp, its own page and home-screen icon).
// This page hands out that link and manages who can sign in to it.

export default function SecretShoppersPage() {
  const appUrl = `${window.location.origin}/shop`
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(appUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked; the link is on screen to copy by hand */ }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Secret Shoppers" subtitle="Shoppers file their reports from the Secret Shopper app on their phones." />

      <section className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Shopper app</h2>
        <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="shrink-0 self-center sm:self-start">
            <QrCodeImage value={appUrl} size={152} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">
              Send shoppers this link, or have them scan the code with their phone camera. They sign in with their PIN.
              Nothing in Operator links to it.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="min-w-0 truncate rounded-md border border-border bg-content px-3 py-2 font-mono text-sm text-ink">{appUrl}</code>
              <Button variant="secondary" size="sm" onClick={() => void copy()}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy link'}
              </Button>
              <a href="/shop" target="_blank" rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-accent hover:bg-accent-soft">
                <ExternalLink className="size-4" /> Open
              </a>
            </div>
            <div className="mt-4 text-sm text-ink-muted">
              <div className="font-medium text-ink">Putting the app icon on their phone</div>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li><span className="font-medium text-ink">iPhone:</span> open the link in Safari, tap the Share button, then Add to Home Screen.</li>
                <li><span className="font-medium text-ink">Android:</span> open the link in Chrome, tap the ⋮ menu, then Add to Home screen (or Install app).</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <ShoppersPanel />
    </div>
  )
}
