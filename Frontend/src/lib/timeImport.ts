// Reading a POS's time-entries export (Toast's "Time entries", Square's
// timecards, or any CSV with a name and clock-in/out columns) into stretches
// on the clock, and matching its names to the store's people. Pure — the
// import panel (components/TimeImport.tsx) does the asking.

/** CSV text → rows of cells (quoted cells, doubled quotes, CRLF, a BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

export type Field = 'name' | 'first' | 'last' | 'in' | 'out' | 'date' | 'break' | 'payable' | 'location'
export type ColumnMap = Partial<Record<Field, number>>

// header spellings seen in POS exports, most specific first
const HEADERS: Record<Field, string[]> = {
  name: ['employee', 'employeename', 'name', 'teammember', 'teammembername', 'staff', 'staffname', 'fullname', 'worker'],
  first: ['firstname', 'first', 'employeefirstname'],
  last: ['lastname', 'last', 'employeelastname'],
  in: ['indate', 'clockin', 'clockintime', 'clockindatetime', 'timein', 'punchin', 'clockedin', 'starttime', 'start', 'in'],
  out: ['outdate', 'clockout', 'clockouttime', 'clockoutdatetime', 'timeout', 'punchout', 'clockedout', 'endtime', 'end', 'out'],
  date: ['date', 'clockindate', 'shiftdate', 'workdate', 'businessdate'],
  break: ['unpaidbreaktime', 'unpaidbreak', 'unpaidbreaks', 'unpaidbreakminutes', 'unpaidbreakhours', 'breaktime', 'breakminutes', 'break', 'breaks'],
  payable: ['payablehours', 'paidhours'],
  location: ['location', 'locationname', 'restaurant', 'store'],
}
const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Which row is the header and which columns hold what. */
export function detectColumns(rows: string[][]): { headerRow: number; headers: string[]; map: ColumnMap } {
  let best = { headerRow: 0, headers: rows[0] ?? [], map: {} as ColumnMap, score: -1 }
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const keys = rows[r]!.map(key)
    const map: ColumnMap = {}
    for (const field of Object.keys(HEADERS) as Field[]) {
      for (const want of HEADERS[field]) {
        const i = keys.indexOf(want)
        if (i >= 0 && !Object.values(map).includes(i)) {
          map[field] = i
          break
        }
      }
    }
    const score = Object.keys(map).length
    if (score > best.score) best = { headerRow: r, headers: rows[r]!, map, score }
  }
  return { headerRow: best.headerRow, headers: best.headers, map: best.map }
}

/** Enough to read stretches: a name (or first + last) and clock-in and -out. */
export const mapComplete = (m: ColumnMap) =>
  (m.name !== undefined || m.first !== undefined) && m.in !== undefined && m.out !== undefined

const pad = (n: number) => String(n).padStart(2, '0')

/** "YYYY-MM-DD" from a date on its own — 2026-10-26, 10/26/2026, 10/26/26. */
function readDate(v: string): string | null {
  const s = v.trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad(+m[2]!)}-${pad(+m[3]!)}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/)
  if (m) return `${m[3]!.length === 2 ? `20${m[3]}` : m[3]}-${pad(+m[1]!)}-${pad(+m[2]!)}`
  return null
}

/** "HH:MM" 24h from a time on its own — 9:58 AM, 21:05, 10:44:00 PM. */
function readTime(v: string): string | null {
  const m = v.trim().match(/(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?\s*([ap])\.?m?\.?/i) ?? v.trim().match(/(\d{1,2}):(\d{2})/)
  if (!m) return null
  let h = +m[1]!
  const min = +m[2]!
  const ap = m[3]?.toLowerCase()
  if (ap === 'p' && h < 12) h += 12
  if (ap === 'a' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return `${pad(h)}:${pad(min)}`
}

/** A clock-in or -out as "YYYY-MM-DDTHH:MM": a full date and time in one
 * cell, or a time with the date from another column. */
export function readWhen(v: string | undefined, dateCell?: string): string | null {
  if (!v || !v.trim()) return null
  const time = readTime(v)
  if (!time) return null
  const date = readDate(v) ?? (dateCell ? readDate(dateCell) : null)
  return date ? `${date}T${time}` : null
}

/** An unpaid break as minutes: "0.50" (hours, as Toast and most POSes
 * export), "30" (minutes), "0:30". `header` settles which when it says so. */
export function readBreak(v: string | undefined, header = ''): number {
  const s = (v ?? '').trim()
  if (!s) return 0
  const hm = s.match(/^(\d+):(\d{2})$/)
  if (hm) return +hm[1]! * 60 + +hm[2]!
  const n = Number(s.replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return 0
  const h = key(header)
  if (h.includes('minute')) return Math.round(n)
  if (h.includes('hour')) return Math.round(n * 60)
  return Math.round(n <= 12 ? n * 60 : n)
}

export interface ImportRow {
  name: string
  location: string | null
  clockIn: string | null
  clockOut: string | null
  breakMinutes: number
}

const minutesOf = (stamp: string) => Date.parse(`${stamp}:00Z`) / 60_000

/** The stretches in an export, given which columns hold what. */
export function readRows(rows: string[][], headerRow: number, headers: string[], map: ColumnMap): ImportRow[] {
  const cell = (r: string[], f: Field) => (map[f] === undefined ? undefined : r[map[f]!]?.trim())
  const out: ImportRow[] = []
  for (const r of rows.slice(headerRow + 1)) {
    const name =
      cell(r, 'name') || [cell(r, 'first'), cell(r, 'last')].filter(Boolean).join(' ')
    if (!name) continue
    const date = cell(r, 'date')
    const clockIn = readWhen(cell(r, 'in'), date)
    let clockOut = readWhen(cell(r, 'out'), date)
    // a time-only clock-out before its clock-in ran past midnight
    if (clockIn && clockOut && clockOut <= clockIn && !readDate(cell(r, 'out') ?? '')) {
      const next = new Date(Date.parse(`${clockIn.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
      clockOut = `${next}T${clockOut.slice(11)}`
    }
    let breakMinutes = readBreak(cell(r, 'break'), map.break !== undefined ? headers[map.break] : '')
    // paid hours settle the break exactly, whatever unit the break column is in
    const payable = Number(cell(r, 'payable'))
    if (clockIn && clockOut && map.payable !== undefined && Number.isFinite(payable) && cell(r, 'payable') !== '') {
      breakMinutes = Math.max(0, Math.round(minutesOf(clockOut) - minutesOf(clockIn) - payable * 60))
    }
    out.push({ name, location: cell(r, 'location') || null, clockIn, clockOut, breakMinutes })
  }
  return out
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
/** "Lee, Ava" → "Ava Lee" */
const flip = (s: string) => (s.includes(',') ? s.split(',').map((x) => x.trim()).reverse().join(' ') : s)

/** Who an export's name is: their name here, the POS spelling remembered from
 * last time, or a first name (+ last initial) only one person has. */
export function matchPerson(
  raw: string,
  people: { id: number; name: string; posName: string | null }[],
): number | null {
  const n = norm(flip(raw))
  const exact = people.filter((p) => norm(p.name) === n || (p.posName != null && norm(p.posName) === norm(raw)))
  if (exact.length === 1) return exact[0]!.id
  const [first, ...rest] = n.split(' ')
  const lastInitial = rest.length ? rest[rest.length - 1]![0] : undefined
  const loose = people.filter((p) => {
    const [pf, ...pr] = norm(p.name).split(' ')
    if (pf !== first) return false
    return !lastInitial || !pr.length || pr[pr.length - 1]![0] === lastInitial
  })
  return loose.length === 1 ? loose[0]!.id : null
}
