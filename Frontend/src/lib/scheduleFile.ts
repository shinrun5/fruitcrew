/** Getting a schedule file ready to be read: photos are shrunk to a sensible
 * size (phone cameras take 12MP+), PDFs go as they are, and spreadsheets are
 * turned into plain text right here — the reader takes text, not .xlsx. */

export type PreparedFile =
  | { kind: 'file'; name: string; type: string; data: string }
  | { kind: 'text'; name: string; text: string }

/** Thrown with a message to show as is. */
export class FileProblem extends Error {}

const MAX_EDGE = 2400
const MAX_PDF = 5.5 * 1024 * 1024
const MAX_SHEET_ROWS = 300
const MAX_SHEET_COLS = 60

export async function prepareScheduleFile(file: File): Promise<PreparedFile> {
  const name = file.name || 'schedule'
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (file.type === 'application/pdf' || ext === 'pdf') {
    if (file.size > MAX_PDF) throw new FileProblem('too-big')
    return { kind: 'file', name, type: 'application/pdf', data: await base64(file) }
  }
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif'].includes(ext)) {
    return { kind: 'file', name, type: 'image/jpeg', data: await shrinkImage(file) }
  }
  if (ext === 'xlsx' || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return { kind: 'text', name, text: await xlsxToText(await file.arrayBuffer()) }
  }
  if (['csv', 'tsv', 'txt'].includes(ext) || file.type.startsWith('text/')) {
    const text = await file.text()
    if (!text.trim()) throw new FileProblem('empty')
    return { kind: 'text', name, text }
  }
  // .xls, .numbers, Word… — a format we can't open here
  throw new FileProblem('type')
}

async function base64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new FileProblem('unreadable'))
    r.readAsDataURL(blob)
  })
  return url.slice(url.indexOf(',') + 1)
}

/** A JPEG no bigger than MAX_EDGE on its long side — plenty to read handwriting,
 * a fraction of the upload. Goes through an <img>, which also opens iPhone
 * HEIC photos in Safari. */
async function shrinkImage(file: File): Promise<string> {
  const src = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new FileProblem('unreadable'))
      el.src = src
    })
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new FileProblem('unreadable')
    ctx.fillStyle = '#fff' // a transparent PNG would otherwise come out black
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new FileProblem('unreadable')
    return base64(blob)
  } finally {
    URL.revokeObjectURL(src)
  }
}

// ---- .xlsx: a zip of XML files. Just enough of both to get the cells out.

async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const v = new DataView(buf)
  const u8 = new Uint8Array(buf)
  let end = -1
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new FileProblem('unreadable')
  const count = v.getUint16(end + 10, true)
  let p = v.getUint32(end + 16, true)
  const out = new Map<string, string>()
  const dec = new TextDecoder()
  for (let n = 0; n < count && v.getUint32(p, true) === 0x02014b50; n++) {
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const skip = nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen))
    p += 46 + skip
    if (!want(name)) continue
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const raw = u8.slice(start, start + size)
    if (method === 0) out.set(name, dec.decode(raw))
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      out.set(name, await new Response(stream).text())
    }
  }
  return out
}

const colIndex = (ref: string) => {
  let n = 0
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Excel keeps times as fractions of a day and dates as days since 1899-12-30. */
function excelNumber(v: number): string {
  if (v >= 0 && v < 1) {
    const mins = Math.round(v * 1440)
    const h = Math.floor(mins / 60) % 24
    return `${((h + 11) % 12) + 1}:${pad(mins % 60)} ${h < 12 ? 'AM' : 'PM'}`
  }
  if (v >= 30_000 && v < 80_000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000)
    const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    return v % 1 ? `${day} ${excelNumber(v % 1)}` : day
  }
  return String(Math.round(v * 100) / 100)
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export async function xlsxToText(buf: ArrayBuffer): Promise<string> {
  const files = await unzip(
    buf,
    (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n),
  )
  const parse = (name: string) => {
    const xml = files.get(name)
    return xml ? new DOMParser().parseFromString(xml, 'application/xml') : null
  }
  const all = (doc: Document | Element, tag: string) => Array.from(doc.getElementsByTagNameNS('*', tag))
  const strings = (() => {
    const doc = parse('xl/sharedStrings.xml')
    return doc ? all(doc, 'si').map((si) => all(si, 't').map((t) => t.textContent ?? '').join('')) : []
  })()
  // sheets in the workbook's own order, by name
  const rels = new Map(
    (() => {
      const doc = parse('xl/_rels/workbook.xml.rels')
      return doc ? all(doc, 'Relationship').map((r) => [r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? ''] as const) : []
    })(),
  )
  const book = parse('xl/workbook.xml')
  const sheets = (book ? all(book, 'sheet') : []).map((s, i) => {
    const rid = s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? ''
    const target = rels.get(rid)?.replace(/^\/?(xl\/)?/, '') ?? `worksheets/sheet${i + 1}.xml`
    return { name: s.getAttribute('name') ?? `Sheet ${i + 1}`, file: `xl/${target}` }
  })

  const parts: string[] = []
  for (const sheet of sheets.slice(0, 6)) {
    const doc = parse(sheet.file)
    if (!doc) continue
    const grid: string[][] = []
    for (const row of all(doc, 'row').slice(0, MAX_SHEET_ROWS)) {
      const cells: string[] = []
      for (const c of all(row, 'c')) {
        const col = colIndex(c.getAttribute('r') ?? 'A')
        if (col < 0 || col >= MAX_SHEET_COLS) continue
        const type = c.getAttribute('t')
        const v = all(c, 'v')[0]?.textContent ?? ''
        let value = ''
        if (type === 's') value = strings[Number(v)] ?? ''
        else if (type === 'inlineStr') value = all(c, 't').map((t) => t.textContent ?? '').join('')
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
        else if (type === 'str' || type === 'e') value = v
        else if (v !== '') value = excelNumber(Number(v))
        cells[col] = value.trim()
      }
      grid.push(Array.from(cells, (x) => x ?? ''))
    }
    const lines = grid.map((r) => r.map(csvCell).join(',').replace(/,+$/, '')).filter((l) => l !== '')
    if (lines.length) parts.push(`## Sheet: ${sheet.name}\n${lines.join('\n')}`)
  }
  if (!parts.length) throw new FileProblem('empty')
  return parts.join('\n\n')
}
