// The Electronic Record and Signature Disclosure, as stored (esign_disclosures):
// "## " starts a heading, "- " a bullet, {company} is the account's name.
export function DisclosureText({ body, company }: { body: string; company: string }) {
  const blocks: { kind: 'h' | 'p' | 'li'; text: string }[] = []
  for (const raw of body.replaceAll('{company}', company).split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('## ')) blocks.push({ kind: 'h', text: line.slice(3) })
    else if (line.startsWith('- ')) blocks.push({ kind: 'li', text: line.slice(2) })
    else blocks.push({ kind: 'p', text: line })
  }
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink">
      {blocks.map((b, i) =>
        b.kind === 'h' ? <h4 key={i} className="mt-1 font-semibold">{b.text}</h4>
          : b.kind === 'li' ? <p key={i} className="flex gap-2 pl-1"><span aria-hidden="true">•</span><span>{b.text}</span></p>
            : <p key={i}>{b.text}</p>,
      )}
    </div>
  )
}
