import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Card } from '../components/Card'
import { CopyButton } from '../components/CopyButton'
import { FruitAvatar } from '../components/FruitAvatar'
import { StarBadgeIcon } from '../components/icons'
import {
  DayRulesPanel,
  EditWorkerForm,
  FixedShiftRow,
  ResponsibilityPanel,
  TIER_LABEL_KEY,
  TIERS,
} from '../components/WorkerEditors'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { fruitFor, fruitForPerson } from '../lib/fruit'
import { useT } from '../lib/i18n'
import { hasSections } from '../lib/store-context'
import { addDaysYMD, DAY_LABEL, DAYS, thisMondayYMD, timeRange, weekRangeLabel } from '../lib/time'
import { useCopy } from '../lib/use-copy'
import type { FixedShift, Responsibility, RosterWorker, Store, Tier, TimeOffRequest } from '../types'

type Availability = Awaited<ReturnType<typeof api.getAvailabilityConfirmations>>['workers'][number]

/** Everything about one person in one place — what used to be spread over
 * the Workers card, the schedule's hidden availability table, Marketplace's
 * time-off list and Payroll. */
export function TeamMember() {
  const t = useT()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const id = Number(useParams().id)
  const { copiedKey, copy } = useCopy()
  const nextWeek = addDaysYMD(thisMondayYMD(), 7)

  const [worker, setWorker] = useState<RosterWorker | null>(null)
  const [roster, setRoster] = useState<RosterWorker[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [fixed, setFixed] = useState<FixedShift[]>([])
  const [responsibilities, setResponsibilities] = useState<Record<number, Responsibility[]>>({})
  const [hours, setHours] = useState<Awaited<ReturnType<typeof api.getWorkerHours>> | null>(null)
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [timeOff, setTimeOff] = useState<TimeOffRequest[]>([])
  const [expandedResp, setExpandedResp] = useState<number | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  const refresh = useCallback(async () => {
    const [s, r] = await Promise.all([api.getStores(), api.getRoster()])
    const w = r.find((x) => x.id === id) ?? null
    setStores(s)
    setRoster(r)
    setWorker(w)
    if (!w) return setMissing(true)
    const [fx, resp, hrs, av, off] = await Promise.all([
      Promise.all(w.stores.map((l) => api.getFixedShifts(l.storeId).catch(() => [] as FixedShift[]))),
      Promise.all(w.stores.map((l) => api.getResponsibilities(l.storeId).catch(() => [] as Responsibility[]))),
      api.getWorkerHours(id).catch(() => null),
      api.getAvailabilityConfirmations(nextWeek).catch(() => null),
      api.getTimeOff().catch(() => [] as TimeOffRequest[]),
    ])
    setFixed(fx.flat())
    setResponsibilities(Object.fromEntries(w.stores.map((l, i) => [l.storeId, resp[i]!])))
    setHours(hrs)
    setAvailability(av?.workers.find((x) => x.employeeId === id) ?? null)
    setTimeOff(off.filter((o) => o.employeeId === id))
  }, [id, nextWeek])

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : t('workers.err.loadWorkers')))
  }, [refresh, t])

  async function act(key: string, fn: () => Promise<unknown>, errKey: Parameters<typeof t>[0]) {
    setError(null)
    setSaving(key)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t(errKey))
    } finally {
      setSaving(null)
    }
  }

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
        <BackLink />
        <p className="mt-4 font-body text-sm text-muted-ink">{t('team.notFound')}</p>
      </div>
    )
  }
  if (!worker) {
    return <div className="p-6 font-body text-sm text-muted-ink">{error ?? t('common.loading')}</div>
  }

  const w = worker
  const storeName = (sid: number) => stores.find((s) => s.id === sid)?.name ?? t('workers.storeFallback', { id: sid })
  const inviteLink = (code: string) => `${window.location.origin}/register?code=${encodeURIComponent(code)}`
  const takenFruits = new Set(
    roster
      .filter((o) => o.id !== w.id && o.stores.some((s) => w.stores.some((ws) => ws.storeId === s.storeId)))
      .map((o) => o.avatarFruit ?? fruitFor(o.id)),
  )
  const fmtDate = (ymd: string) =>
    new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4 pb-8 sm:p-6">
      <BackLink />

      {/* who they are */}
      <div className="mt-3 flex items-center gap-3">
        <FruitAvatar kind={fruitForPerson({ employeeId: w.id, avatarFruit: w.avatarFruit })} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="font-heading text-xl font-extrabold text-ink">{w.name}</h1>
            {w.standby && (
              <span className="rounded-full border border-ink/25 px-1.5 py-px font-body text-[10px] font-bold text-muted-ink">
                {t('profile.onCall')}
              </span>
            )}
          </div>
          <p className="font-body text-xs text-muted-ink">
            {[w.phone, w.hireDate && t('profile.since', { date: fmtDate(w.hireDate) })].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {error && <p className="mt-3 font-body text-xs font-bold text-coral-dark">{error}</p>}

      {/* login status — first, since "waiting for your OK" is the thing most likely to need doing */}
      <Section title={t('team.section.account')}>
        {w.account ? (
          w.account.approved ? (
            <span className="font-body text-xs font-bold text-green">{t('workers.signedUp', { email: w.account.email })}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-2 font-body text-xs">
              <span className="font-bold text-coral-dark">{t('workers.pendingApproval', { email: w.account.email })}</span>
              <button
                onClick={() => void act('approve', () => api.approveWorker(w.id), 'workers.err.approve')}
                className="rounded-full border-2 border-ink bg-green px-2.5 py-0.5 font-heading text-[11px] font-bold text-white"
              >
                {t('workers.approve')}
              </button>
              <button
                onClick={async () => {
                  if (await confirm(t('workers.confirmReject', { name: w.name }), { tone: 'danger' }))
                    void act('reject', () => api.rejectWorker(w.id), 'workers.err.reject')
                }}
                className="rounded-full border-2 border-coral px-2.5 py-0.5 font-heading text-[11px] font-bold text-coral-dark"
              >
                {t('workers.reject')}
              </button>
            </span>
          )
        ) : w.inviteCode ? (
          <span className="flex flex-wrap items-center gap-2 font-body text-xs">
            <span className="text-muted-ink">{t('workers.inviteLabel')}</span>
            <code className="rounded bg-cream px-1.5 py-0.5 font-bold text-ink">{w.inviteCode}</code>
            <CopyButton
              copied={copiedKey === 'code'}
              onClick={() => copy('code', w.inviteCode!)}
              label={t('workers.copyCode')}
              copiedLabel={t('workers.copied')}
            />
            <CopyButton
              copied={copiedKey === 'link'}
              onClick={() => copy('link', inviteLink(w.inviteCode!))}
              label={t('workers.copySignupLink')}
              copiedLabel={t('workers.linkCopied')}
              tone="sky"
            />
          </span>
        ) : (
          <button
            onClick={() => void act('invite', () => api.inviteWorker(w.id), 'workers.err.createInvite')}
            className="rounded-full border-2 border-ink bg-cream px-2.5 py-0.5 font-heading text-[11px] font-bold text-ink"
          >
            {t('workers.sendInvite')}
          </button>
        )}
      </Section>

      {/* hours */}
      {hours && (
        <Section title={t('team.section.hours')}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-body text-xs">
            <span>
              <b className="text-ink">{t('overview.hoursValue', { n: hours.week })}</b>{' '}
              <span className="text-muted-ink">{t('team.hours.week')}</span>
            </span>
            <span>
              <b className="text-ink">{t('overview.hoursValue', { n: hours.period })}</b>{' '}
              <span className="text-muted-ink">
                {t('team.hours.period', {
                  range: `${fmtDate(hours.periodStart)} – ${fmtDate(addDaysYMD(hours.periodEnd, -1))}`,
                })}
              </span>
            </span>
            <span className="text-muted-ink">
              {t('workers.hoursAndDays', { hours: w.hourLimit, days: w.maxShifts })}
            </span>
            <Link to="/payroll" className="ml-auto font-bold text-sky-dark">
              {t('team.hours.payroll')}
            </Link>
          </div>
        </Section>
      )}

      {/* availability + time off */}
      <Section title={t('team.section.availability', { range: weekRangeLabel(nextWeek) })}>
        {availability ? (
          <>
            <p
              className={`font-body text-xs font-bold ${
                availability.state !== 'pending'
                  ? 'text-green-dark'
                  : availability.hasLogin
                    ? 'text-coral-dark'
                    : 'text-muted-ink'
              }`}
            >
              {availability.state === 'pending' && !availability.hasLogin
                ? t('dashboard.avail.state.noLogin')
                : t(`dashboard.avail.state.${availability.state}`)}
            </p>
            <ul className="mt-1.5 grid grid-cols-[3rem_1fr] gap-x-2 gap-y-0.5 font-body text-xs">
              {DAYS.map((d) => {
                const wins = availability.days[d] ?? []
                const off = availability.timeOff.includes(d)
                return (
                  <li key={d} className="contents">
                    <span className="font-bold text-ink">{DAY_LABEL[d]}</span>
                    <span className={off ? 'font-bold text-coral-dark' : wins.length ? 'text-ink' : 'text-muted-ink'}>
                      {off
                        ? t('dashboard.onLeave')
                        : wins.length
                          ? wins
                              .map((x) => timeRange(`1970-01-01T${x.start}:00Z`, `1970-01-01T${x.end}:00Z`))
                              .join(', ')
                          : t('team.availability.notFree')}
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <p className="font-body text-xs text-muted-ink">{t('team.availability.none')}</p>
        )}
        <p className="mt-3 font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">
          {t('team.timeOff')}
        </p>
        {timeOff.length === 0 ? (
          <p className="font-body text-xs text-muted-ink">{t('timeoff.none')}</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-0.5 font-body text-xs">
            {timeOff.map((o) => (
              <li key={o.id} className="text-ink">
                {fmtDate(o.startDate)} – {fmtDate(o.endDate)}{' '}
                <span className="text-muted-ink">· {t(`timeoff.state.${o.state}`)}</span>
                {o.note && <span className="text-muted-ink"> · “{o.note}”</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* stores, tier, responsibilities */}
      <Section title={t('team.section.stores')}>
        <div className="flex flex-wrap items-center gap-1.5">
          {w.stores.length === 0 && (
            <span className="font-body text-[11px] text-coral-dark">{t('workers.noStoreAssigned')}</span>
          )}
          {w.stores.map((s) => (
            <span
              key={s.storeId}
              className="flex items-center gap-1 rounded-full border-2 border-ink bg-cream px-2 py-0.5 font-body text-[11px] font-bold text-ink"
            >
              {storeName(s.storeId)} ·{' '}
              <select
                value={s.proficiency}
                disabled={saving === `tier:${s.storeId}`}
                onChange={(e) =>
                  void act(
                    `tier:${s.storeId}`,
                    () => api.updateWorkerStore(w.id, s.storeId, { proficiency: e.target.value as Tier }),
                    'workers.err.changeTier',
                  )
                }
                aria-label={t('workers.tierAt', { store: storeName(s.storeId) })}
                className="cursor-pointer appearance-none border-none bg-transparent p-0 font-body text-[11px] font-bold text-ink outline-none disabled:opacity-50"
              >
                {TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {t(TIER_LABEL_KEY[tier])}
                  </option>
                ))}
              </select>
              {s.canOpen && <StarBadgeIcon size={10} />}
              <button
                onClick={() => setExpandedResp((k) => (k === s.storeId ? null : s.storeId))}
                title={t('workers.responsibilities.toggleAria', { store: storeName(s.storeId) })}
                className={`rounded-full border px-1.5 py-px text-[9px] font-bold leading-none ${
                  expandedResp === s.storeId ? 'border-ink bg-ink text-white' : 'border-ink/30 text-muted-ink'
                }`}
              >
                {s.responsibilityIds.length}
              </button>
              <button
                onClick={async () => {
                  if (
                    await confirm(t('workers.confirmUnlinkStore', { name: w.name, store: storeName(s.storeId) }), {
                      tone: 'danger',
                    })
                  )
                    void act('unlink', () => api.removeWorkerFromStore(w.id, s.storeId), 'workers.err.updateStores')
                }}
                aria-label={t('workers.removeFromStore', { store: storeName(s.storeId) })}
                className="ml-0.5 font-heading text-xs leading-none text-muted-ink hover:text-coral-dark"
              >
                ×
              </button>
            </span>
          ))}
          {stores
            // a store with sections isn't scheduled itself — offer its sections instead
            .filter((st) => !w.stores.some((s) => s.storeId === st.id) && !hasSections(stores, st.id))
            .map((st) => (
              <button
                key={st.id}
                onClick={() =>
                  void act(
                    'link',
                    () => api.addWorkerToStore({ employeeId: w.id, storeId: st.id, proficiency: 'REGULAR' }),
                    'workers.err.updateStores',
                  )
                }
                className="rounded-full border-2 border-dashed border-ink/40 px-2 py-0.5 font-body text-[11px] font-bold text-muted-ink hover:border-ink hover:text-ink"
              >
                + {st.name}
              </button>
            ))}
        </div>
        {w.stores.some((s) => s.proficiency === 'NEW') && (
          <p className="mt-2 font-body text-[11px] text-muted-ink">{t('team.newTierHint')}</p>
        )}
        {w.stores.map(
          (s) =>
            expandedResp === s.storeId && (
              <ResponsibilityPanel
                key={s.storeId}
                worker={w}
                storeId={s.storeId}
                storeName={storeName(s.storeId)}
                responsibilities={responsibilities[s.storeId] ?? []}
                savingKey={saving?.startsWith('resp:') ? `${w.id}:${s.storeId}` : null}
                onToggle={(responsibilityId, granted) =>
                  void act(
                    `resp:${s.storeId}`,
                    () => api.setEmployeeResponsibility(w.id, s.storeId, responsibilityId, granted),
                    'workers.err.toggleResponsibility',
                  )
                }
              />
            ),
        )}
        {w.stores.length > 0 && (
          <FixedShiftRow
            worker={w}
            storeName={storeName}
            fixed={fixed.filter((f) => f.employeeId === w.id)}
            onChange={() => void refresh()}
            onError={setError}
          />
        )}
      </Section>

      <Section title={t('team.section.details')}>
        <EditWorkerForm
          key={`${w.id}-${w.name}-${w.hourLimit}-${w.maxShifts}-${w.hireDate}`}
          worker={w}
          takenFruits={takenFruits}
          onDone={() => void refresh()}
          onError={setError}
        />
      </Section>

      <Section title={t('team.section.dayRules')}>
        <DayRulesPanel worker={w} onChange={() => void refresh()} onError={setError} />
      </Section>

      <button
        onClick={async () => {
          if (!(await confirm(t('workers.confirmRemove', { name: w.name }), { tone: 'danger' }))) return
          try {
            await api.deleteWorker(w.id)
            navigate('/team')
          } catch (e) {
            setError(e instanceof Error ? e.message : t('workers.err.removeWorker'))
          }
        }}
        className="mt-6 w-full rounded-2xl border-[2.5px] border-coral bg-paper p-3 font-heading text-sm font-bold text-coral-dark"
      >
        {t('team.remove', { name: w.name })}
      </button>
    </div>
  )
}

function BackLink() {
  const t = useT()
  return (
    <Link to="/team" className="font-body text-xs font-bold text-sky-dark">
      ‹ {t('nav.mgr.workers')}
    </Link>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="mt-3">
      <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-wide text-muted-ink">{title}</h2>
      {children}
    </Card>
  )
}
