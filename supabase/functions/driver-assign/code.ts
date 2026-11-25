// A vehicle sticker's QR is https://operator.washlyfe.com/v/<code> (fleet_vehicle_codes,
// 0208); a code typed or read on its own works too. Returns the code, or null when
// what was scanned isn't a vehicle sticker.
const CODE_RE = /^[2-9A-HJ-NP-Z]{6}$/

export function stickerCode(scanned: unknown): string | null {
  const raw = String(scanned ?? '').trim()
  const fromLink = raw.match(/\/v\/([A-Za-z0-9]{6})(?:[/?#]|$)/)
  const code = (fromLink ? fromLink[1] : raw).toUpperCase()
  return CODE_RE.test(code) ? code : null
}
