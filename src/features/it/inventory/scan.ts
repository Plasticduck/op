// What a scanned code means. A sticker's QR is a link, /t/<account>/<tag>; its
// Code 128 (or a typed tag) is just the tag. Any other link is someone else's
// QR code, not one of our stickers.

export const TAG_RE = /^[A-Z0-9][A-Z0-9-]{1,31}$/

export type ParsedScan = { short: string | null; tag: string }

export function parseScan(raw: string): ParsedScan | null {
  const text = raw.trim()
  if (!text) return null
  const link = text.match(/^https?:\/\/[^/]+\/t\/([^/?#]+)\/([^/?#]+)/i)
  if (link) {
    return { short: decodeURIComponent(link[1]).toLowerCase(), tag: decodeURIComponent(link[2]).toUpperCase() }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null // a URL, Wi-Fi code, etc.
  return { short: null, tag: text.toUpperCase() }
}
