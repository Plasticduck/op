// Turns site names inside an answer into clickable tokens. Kept free of React
// so the matcher can be unit-tested on its own.

export type SiteMatcher = {
  // Split a plain string into alternating plain-text and matched-site segments.
  split: (text: string) => Segment[]
}

export type Segment = { text: string; siteId?: string }

// First run of digits in a name: "Mighty Wash 17" -> 17, "Highway 40" -> 40.
function firstNum(name: string): number | null {
  const m = name.match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Build a matcher from the sites the caller can see. Matches each location's
// full name, plus "Site N" / "#N" aliases resolved by the site number in the
// name. Returns null when there is nothing worth linking.
export function buildSiteMatcher(locations: { id: string; name: string }[]): SiteMatcher | null {
  const byToken = new Map<string, string>() // lowercased token -> location id
  const tokens: string[] = []
  const add = (token: string, id: string) => {
    const key = token.toLowerCase()
    if (!byToken.has(key)) {
      byToken.set(key, id)
      tokens.push(token)
    }
  }

  for (const l of locations) {
    const name = l.name.trim()
    // Two-char-or-shorter names are too noisy to linkify safely.
    if (name.length >= 3) add(name, l.id)
    const n = firstNum(name)
    if (n != null) {
      add(`Site ${n}`, l.id)
      add(`#${n}`, l.id)
    }
  }
  if (tokens.length === 0) return null

  // Longest first so "Mighty Wash 17" wins over the bare "#17" alias.
  tokens.sort((a, b) => b.length - a.length)
  // Word-boundary-ish guards keep "17" inside "1740" or "Site 175" from
  // matching, while still allowing a trailing period or comma.
  const re = new RegExp(`(?<![\\w#])(${tokens.map(esc).join('|')})(?![\\w])`, 'gi')

  return {
    split(text: string): Segment[] {
      const out: Segment[] = []
      let last = 0
      re.lastIndex = 0
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (m.index > last) out.push({ text: text.slice(last, m.index) })
        const id = byToken.get(m[0].toLowerCase())
        out.push(id ? { text: m[0], siteId: id } : { text: m[0] })
        last = m.index + m[0].length
      }
      if (last < text.length) out.push({ text: text.slice(last) })
      return out
    },
  }
}
