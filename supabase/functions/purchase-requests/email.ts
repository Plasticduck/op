// Purchase request emails (Resend). Plain, branded HTML with one button.
import { usd } from '../_shared/esign.ts'

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export type EmailSummary = { number: string; title: string; vendor: string; site: string; total: number | string; requester: string }

export function emailHtml(o: {
  heading: string
  intro: string
  summary: EmailSummary
  button?: { label: string; url: string }
  note?: string
  footer?: string
}): string {
  const rows: [string, string][] = [
    ['Request', `${o.summary.number}: ${o.summary.title}`],
    ['Vendor', o.summary.vendor],
    ['Site', o.summary.site],
    ['Total', usd(o.summary.total)],
    ['Requested by', o.summary.requester],
  ]
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:22px 24px 8px;">
      <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;font-weight:600;">Operator · Purchase Request</div>
      <h1 style="margin:8px 0 6px;font-size:20px;line-height:1.3;">${esc(o.heading)}</h1>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#374151;">${esc(o.intro)}</p>
    </td></tr>
    <tr><td style="padding:0 24px;">
      <table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;">
        ${rows.map(([k, v]) => `<tr><td style="padding:7px 0;border-top:1px solid #f0f1f3;color:#6b7280;width:120px;vertical-align:top;">${esc(k)}</td><td style="padding:7px 0;border-top:1px solid #f0f1f3;font-weight:500;">${esc(v)}</td></tr>`).join('')}
      </table>
    </td></tr>
    ${o.note ? `<tr><td style="padding:12px 24px 0;"><div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;font-size:14px;line-height:1.5;color:#374151;white-space:pre-wrap;">${esc(o.note)}</div></td></tr>` : ''}
    ${o.button ? `<tr><td style="padding:20px 24px 4px;"><a href="${esc(o.button.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:6px;">${esc(o.button.label)}</a></td></tr>` : ''}
    <tr><td style="padding:18px 24px 22px;font-size:12px;line-height:1.5;color:#6b7280;">
      ${esc(o.footer ?? 'You are getting this because you are part of this purchase request in Operator. Signing happens in Operator, where you sign in with your own account.')}
    </td></tr>
  </table></body></html>`
}
