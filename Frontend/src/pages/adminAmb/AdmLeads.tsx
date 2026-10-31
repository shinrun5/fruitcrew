import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card, EmptyState } from '../../components/Card'
import { Field } from '../../components/Field'
import { Pill } from '../../components/AmbassadorBits'
import { api } from '../../lib/api'
import { LEAD_TONE, useAmbLabels } from '../../lib/ambassadorText'
import { useT } from '../../lib/i18n'
import { shortDate } from '../../lib/time'
import { parseCsv } from '../../lib/timeImport'
import type { AdminLead, LeadInput } from '../../types'

const FILTERS = ['', 'review', 'followUp', 'claimed', 'doNotContact', 'customer'] as const

/** Rows split into requests the API will take (it reads at most 100kb a request). */
function batches(rows: Record<string, string>[], maxBytes = 80_000): Record<string, string>[][] {
  const enc = new TextEncoder()
  const out: Record<string, string>[][] = [[]]
  let size = 0
  for (const r of rows) {
    const n = enc.encode(JSON.stringify(r)).length + 1
    if (out[out.length - 1]!.length > 0 && size + n > maxBytes) {
      out.push([])
      size = 0
    }
    out[out.length - 1]!.push(r)
    size += n
  }
  return out
}

// CSV headers people actually use → our fields
const HEADERS: Record<string, string> = {
  name: 'name', business: 'name', 'business name': 'name', store: 'name', company: 'name',
  address: 'address', street: 'address', 'street address': 'address',
  city: 'city', town: 'city', state: 'state', zip: 'zip', 'zip code': 'zip', postcode: 'zip', 'postal code': 'zip',
  phone: 'phone', 'phone number': 'phone', category: 'category', type: 'category',
  'place id': 'placeId', place_id: 'placeId', placeid: 'placeId', 'google place id': 'placeId',
  status: 'status', outcome: 'status', 'last contacted': 'lastContacted', last_contacted: 'lastContacted', date: 'lastContacted', notes: 'notes', note: 'notes',
}

/** Businesses (and past outreach) from a spreadsheet — headers are matched by name. */
function ImportLeads({ onDone }: { onDone: () => void }) {
  const t = useT()
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const [unknown, setUnknown] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number; customers: number; invalid: number; toReview: number } | null>(null)
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    setErr(null)
    setResult(null)
    const file = e.target.files?.[0]
    if (!file) return
    const cells = parseCsv(await file.text())
    const head = (cells[0] ?? []).map((h) => HEADERS[h.trim().toLowerCase()] ?? '')
    if (!head.includes('name')) return setErr(t('ambAdm.leads.noNameColumn'))
    setUnknown((cells[0] ?? []).filter((h, i) => !head[i] && h.trim()))
    setRows(cells.slice(1).map((r) => Object.fromEntries(head.map((k, i) => [k, (r[i] ?? '').trim()]).filter(([k]) => k))))
  }
  async function run() {
    if (!rows) return
    setBusy(true)
    setErr(null)
    try {
      const sum = { created: 0, updated: 0, customers: 0, invalid: 0, toReview: 0 }
      for (const part of batches(rows)) {
        const r = await api.importLeads(part)
        for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += r[k]
      }
      setResult(sum)
      setRows(null)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <h3 className="font-heading text-sm font-bold text-ink">{t('ambAdm.leads.importTitle')}</h3>
      <p className="font-body text-[11px] text-muted-ink">{t('ambAdm.leads.importHint')}</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e)} className="mt-2 font-body text-xs" />
      {rows && (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="font-body text-xs text-ink">{t('ambAdm.leads.importReady', { n: rows.length })}</p>
          {unknown.length > 0 && <p className="font-body text-[11px] text-muted-ink">{t('ambAdm.leads.importIgnored', { cols: unknown.join(', ') })}</p>}
          <Button size="sm" className="self-start" disabled={busy} onClick={() => void run()}>
            {busy ? t('ambAdm.leads.importing') : t('ambAdm.leads.importGo')}
          </Button>
        </div>
      )}
      {result && <p className="mt-2 font-body text-xs font-bold text-green-dark">{t('ambAdm.leads.imported', result)}</p>}
      {err && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{err}</p>}
    </Card>
  )
}

function AddLead({ onDone }: { onDone: () => void }) {
  const t = useT()
  const [f, setF] = useState<LeadInput>({ name: '', address: '', city: '', state: '', zip: '', phone: '', category: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof LeadInput) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await api.createAdminLead(f)
      setF({ name: '', address: '', city: '', state: '', zip: '', phone: '', category: '' })
      onDone()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <h3 className="font-heading text-sm font-bold text-ink">{t('ambAdm.leads.addTitle')}</h3>
      <form onSubmit={(e) => void submit(e)} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="col-span-2">
          <Field label={t('ambPortal.add.name')} value={f.name} onChange={set('name')} required />
        </div>
        <div className="col-span-2">
          <Field label={t('ambPortal.add.address')} value={f.address} onChange={set('address')} />
        </div>
        <Field label={t('ambPortal.add.city')} value={f.city} onChange={set('city')} />
        <Field label={t('ambPortal.add.state')} value={f.state} onChange={set('state')} />
        <Field label={t('ambPortal.add.zip')} value={f.zip} onChange={set('zip')} />
        <Field label={t('ambPortal.add.category')} value={f.category} onChange={set('category')} />
        {err && <p className="col-span-2 font-body text-xs font-bold text-coral-dark sm:col-span-4">{err}</p>}
        <Button type="submit" size="sm" disabled={busy || !f.name.trim()} className="justify-self-start">
          {t('ambAdm.leads.addSubmit')}
        </Button>
      </form>
    </Card>
  )
}

export function AdmLeads() {
  const t = useT()
  const label = useAmbLabels()
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS as readonly string[]).includes(params.get('filter') ?? '') ? (params.get('filter') ?? '') : ''
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [data, setData] = useState<{ total: number; leads: AdminLead[] } | null>(null)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<'import' | 'add' | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(q.trim()), 300)
    return () => window.clearTimeout(id)
  }, [q])
  const search = useCallback(
    (next: number) => {
      api
        .getAdminLeads(query, filter, next)
        .then((r) => {
          setPage(next)
          setData((d) => ({ total: r.total, leads: next > 0 && d ? [...d.leads, ...r.leads] : r.leads }))
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    },
    [query, filter],
  )
  useEffect(() => search(0), [search])

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setPanel(panel === 'import' ? null : 'import')}>
          {t('ambAdm.leads.import')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setPanel(panel === 'add' ? null : 'add')}>
          + {t('ambAdm.leads.add')}
        </Button>
      </div>
      {panel && <div className="mt-2">{panel === 'import' ? <ImportLeads onDone={() => search(0)} /> : <AddLead onDone={() => search(0)} />}</div>}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('ambAdm.leads.search')}
        aria-label={t('ambAdm.leads.search')}
        className="mt-3 w-full rounded-xl border-[2.5px] border-ink bg-paper px-3 py-2 font-body text-sm text-ink outline-none"
      />
      <div className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            onClick={() => setParams(f ? { filter: f } : {})}
            className={`shrink-0 rounded-full border-2 border-ink px-2.5 py-0.5 font-heading text-[11px] font-bold ${filter === f ? 'bg-ink text-white' : 'bg-paper text-ink'}`}
          >
            {t(`ambAdm.leads.filter.${f || 'all'}`)}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 font-body text-xs font-bold text-coral-dark">{error}</p>}
      {!data ? (
        <p className="mt-3 font-body text-sm text-muted-ink">{t('common.loading')}</p>
      ) : data.leads.length === 0 ? (
        <EmptyState className="mt-3" title={t('ambAdm.leads.none')} />
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <p className="font-body text-[11px] text-muted-ink">{t('ambPortal.find.count', { n: data.total })}</p>
          {data.leads.map((l) => (
            <Card key={l.id} as={Link} to={`/admin/ambassadors/leads/${l.id}`} clickable padded={false} className="flex flex-col gap-1 p-3 text-left">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-heading text-sm font-bold text-ink">{l.name}</span>
                  <span className="block truncate font-body text-xs text-muted-ink">{[l.address, l.city, l.zip].filter(Boolean).join(', ') || '—'}</span>
                </div>
                <Pill tone={LEAD_TONE[l.status]}>{label.lead(l.status)}</Pill>
              </div>
              <div className="flex flex-wrap gap-x-3 font-body text-[11px] text-muted-ink">
                {l.heldBy && <span className="text-sky-dark">{t('ambAdm.leads.heldBy', { name: l.heldBy.name, date: shortDate(l.heldBy.expiresAt) })}</span>}
                {l.contacts > 0 && <span>{t('ambAdm.leads.contacts', { n: l.contacts })}</span>}
                {l.customer && <span>{t('ambAdm.leads.customer', { name: l.customer })}</span>}
                {l.followUpAskBy && <span className="font-bold text-ink">{t('ambAdm.leads.askedBy', { name: l.followUpAskBy })}</span>}
              </div>
              {l.reviewNote && <span className="font-body text-[11px] font-bold text-coral-dark">⚠ {l.reviewNote}</span>}
            </Card>
          ))}
          {data.leads.length < data.total && (
            <Button size="sm" variant="secondary" className="self-center" onClick={() => search(page + 1)}>
              {t('ambPortal.find.more')}
            </Button>
          )}
        </div>
      )}
    </>
  )
}
