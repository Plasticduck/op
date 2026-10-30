// CSV in and out. Parsing follows RFC 4180 (quoted fields, doubled quotes,
// commas and line breaks inside quotes) and skips a leading byte-order mark,
// which Excel adds. Spreadsheets (.xlsx / .xls) are read with the xlsx package,
// loaded only when one is opened.

export type Cell = string | number | null | undefined

export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  // Drop fully blank lines (trailing newline, empty rows between records).
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const quote = (v: Cell) => {
  const t = v == null ? '' : String(v)
  return /[",\r\n]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(quote).join(',')).join('\r\n')
}

// Downloads with a byte-order mark so Excel reads accents and symbols right.
export function downloadCsv(filename: string, rows: Cell[][]) {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// The first sheet of a .csv, .xlsx or .xls file as rows of text.
export async function readSpreadsheet(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(await file.text())
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' })
  return rows.map((r) => r.map((c) => (c == null ? '' : String(c)))).filter((r) => r.some((c) => c.trim() !== ''))
}
