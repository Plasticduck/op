// Lesson bodies are HTML written by Admins. Before showing or saving one, keep only
// the tags, classes and links lessons use, so nothing else can run on the page.

const TAGS = new Set([
  'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'br', 'hr', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'a', 'small', 'sup', 'sub', 'code',
])
// Tags dropped along with everything inside them.
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math', 'noscript', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'title', 'head'])
export const PROSE_CLASSES = new Set([
  'lead', 'callout', 'blue', 'red', 'eyebrow', 'tablewrap', 'k', 'v', 'steps', 'wash', 'w', 'L', 'loop', 'st', 'note',
])

function cleanNode(node: Node, doc: Document): Node | DocumentFragment | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  if (DROP.has(tag)) return null
  const kids = () => {
    const frag = doc.createDocumentFragment()
    el.childNodes.forEach((c) => {
      const k = cleanNode(c, doc)
      if (k) frag.appendChild(k)
    })
    return frag
  }
  // Unknown tags keep their text.
  if (!TAGS.has(tag)) return kids()
  const out = doc.createElement(tag)
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => PROSE_CLASSES.has(c))
  if (cls.length) out.setAttribute('class', cls.join(' '))
  if (tag === 'td' || tag === 'th') {
    for (const a of ['colspan', 'rowspan']) {
      const v = el.getAttribute(a)
      if (v && /^\d{1,2}$/.test(v)) out.setAttribute(a, v)
    }
  }
  if (tag === 'a') {
    const href = (el.getAttribute('href') ?? '').trim()
    if (/^(https?:\/\/|\/(?!\/)|mailto:|tel:)/i.test(href)) {
      out.setAttribute('href', href)
      if (/^https?:/i.test(href)) {
        out.setAttribute('target', '_blank')
        out.setAttribute('rel', 'noopener noreferrer')
      }
    }
  }
  out.appendChild(kids())
  return out
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out = document.implementation.createHTMLDocument('')
  const box = out.createElement('div')
  doc.body.childNodes.forEach((c) => {
    const k = cleanNode(c, out)
    if (k) box.appendChild(k)
  })
  // Wide tables scroll sideways on phones.
  box.querySelectorAll('table').forEach((t) => {
    if (t.parentElement?.classList.contains('tablewrap')) return
    const wrap = out.createElement('div')
    wrap.className = 'tablewrap'
    t.replaceWith(wrap)
    wrap.appendChild(t)
  })
  return box.innerHTML
}

// The lesson's "why" note goes right after its opening paragraph.
export function splitAfterFirstParagraph(html: string): [string, string] {
  const i = html.indexOf('</p>')
  if (i < 0) return ['', html]
  return [html.slice(0, i + 4), html.slice(i + 4)]
}

export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}
