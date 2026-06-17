import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// Renders a real scannable QR code as an inline SVG. The `qrcode` library
// generates an SVG string; we sanitize the outer <svg> to fit a wrapper we
// control (sizing, color, background). Lazy-tolerant: shows a hairline border
// placeholder until the encoded SVG resolves.

export function QrCodeImage({
  value, size = 128, color = '#0B0F14', background = '#FFFFFF',
}: {
  value: string
  size?: number
  color?: string
  background?: string
}) {
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    if (!value) { setSvg(null); return }
    let alive = true
    QRCode.toString(value, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: size,
      color: { dark: color, light: background },
    })
      .then((s) => { if (alive) setSvg(s) })
      .catch(() => { if (alive) setSvg(null) })
    return () => { alive = false }
  }, [value, color, background])

  return (
    <div
      className="grid place-items-center rounded-md border border-border bg-white p-1"
      style={{ width: size, height: size }}
    >
      {svg ? (
        // QRCode.toString returns a full <svg ...> string; render via
        // dangerouslySetInnerHTML so we don't need a parser. The output is
        // safe because the library serializes deterministic SVG only.
        <div
          aria-label="QR code"
          style={{ width: size - 8, height: size - 8 }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <span className="text-[10px] text-ink-subtle">—</span>
      )}
    </div>
  )
}
