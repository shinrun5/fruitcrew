import type {
  AccountDeletionRequest,
  AdminOrgDetail,
  AdminOrgSummary,
  AuthUser,
  ChangeRequest,
  ChangeType,
  ChatMember,
  ChatMessage,
  ClosingDuty,
  ClosingDutyDay,
  ClosingDutyWeek,
  Conversation,
  DmPeer,
  DayHours,
  DayOfWeek,
  Employee,
  FixedShift,
  EmployeeStore,
  GenerateScheduleResult,
  ManagerInvite,
  ManagerInviteInfo,
  ManagerRow,
  NotificationItem,
  MyShiftsResponse,
  OverviewStore,
  Profile,
  RecurringAvailability,
  RequirementInput,
  RosterWorker,
  Session,
  Shift,
  ShiftRequirement,
  SnapshotDetail,
  TimeOffRequest,
  ShiftNote,
  ShiftNoteCategory,
  SignupRequest,
  Store,
  StoreHoursConfig,
  StoreInvite,
  StoreInviteInfo,
  Tier,
} from '../types'
import { getSession, isSessionIdle, setSession, touchSessionActivity } from './session'

// Every backend route is under /api (see Backend/src/index.ts). In dev the Vite
// proxy forwards /api to localhost:3000; in the web prod build it's the same
// origin, so the relative path is enough either way. The Capacitor native
// build runs from capacitor://localhost / https://localhost, not the real
// domain, so it needs an absolute URL instead — set via VITE_API_BASE (see
// Frontend/.env.capacitor.example).
const BASE = import.meta.env.VITE_API_BASE ?? '/api'

/** Thrown when a request needs a valid session and refreshing it failed. The
 * router listens for this to bounce the user to /login. */
export class AuthError extends Error {
  constructor(message = 'Your session has expired') {
    super(message)
    this.name = 'AuthError'
  }
}

// one in-flight refresh at a time; concurrent 401s all await the same promise
let refreshing: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  const session = getSession()
  if (!session?.refresh_token) return false
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refresh_token }),
    })
      .then(async (res) => {
        if (!res.ok) return false
        const data = await res.json()
        if (!data?.session) return false
        setSession(data.session as Session)
        return true
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

async function request<T>(path: string, init: RequestInit = {}, allowRetry = true): Promise<T> {
  const session = getSession()
  const hadToken = Boolean(session?.access_token)

  if (hadToken && isSessionIdle()) {
    setSession(null)
    window.dispatchEvent(new Event('auth:expired'))
    throw new AuthError('Your session has expired — please sign in again')
  }

  const headers = new Headers(init.headers)
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)

  const res = await fetch(`${BASE}${path}`, { ...init, headers })

  if (res.status === 401 && hadToken) {
    if (allowRetry && (await tryRefresh())) return request<T>(path, init, false)
    setSession(null)
    // let the app (AuthProvider) drop the user so the router bounces to /login
    window.dispatchEvent(new Event('auth:expired'))
    throw new AuthError()
  }

  if (hadToken) touchSessionActivity()

  const isJSON = res.headers.get('content-type')?.includes('application/json')
  const data = isJSON ? await res.json() : null
  if (!res.ok) throw new Error(data?.error ?? `${init.method ?? 'GET'} ${path} -> ${res.status}`)
  return data as T
}

function getJSON<T>(path: string): Promise<T> {
  return request<T>(path)
}

function sendJSON<T>(path: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  // --- auth ---
  login: async (email: string, password: string): Promise<AuthUser> => {
    setSession(null)
    const data = await sendJSON<{ user: AuthUser; session: Session }>('/auth/login', 'POST', { email, password })
    setSession(data.session)
    return data.user
  },
  register: async (
    input: { email: string; password: string; inviteCode: string; name: string; phone: string },
  ): Promise<AuthUser> => {
    setSession(null)
    const data = await sendJSON<{ user: AuthUser; session: Session }>('/auth/register', 'POST', input)
    setSession(data.session)
    return data.user
  },
  /** Google/Apple sign-in via an ID token from that provider's own SDK — see
   * Backend/src/routes/auth.ts's /oauth for why (keeps the client only ever
   * talking to our own API, no redirect round-trip). `needsInvite: true`
   * means this identity has never signed into FruitCrew before; call again
   * with the invite code once the user has one to finish linking it. */
  oauthSignIn: async (input: {
    provider: 'google' | 'apple'
    idToken: string
    inviteCode?: string
  }): Promise<{ status: 'linked'; user: AuthUser } | { status: 'needsInvite' }> => {
    setSession(null)
    const data = await sendJSON<{ user: AuthUser; session: Session } | { needsInvite: true }>(
      '/auth/oauth',
      'POST',
      input,
    )
    if ('needsInvite' in data) return { status: 'needsInvite' }
    setSession(data.session)
    return { status: 'linked', user: data.user }
  },
  getSetupStatus: () => getJSON<{ needsSetup: boolean }>('/auth/setup-status'),
  getManagerInviteInfo: (code: string) => getJSON<ManagerInviteInfo>(`/auth/manager-invite/${encodeURIComponent(code)}`),
  registerManager: async (
    input: { email: string; password: string; code: string; name: string },
  ): Promise<AuthUser> => {
    setSession(null)
    const data = await sendJSON<{ user: AuthUser; session: Session }>('/auth/register-manager', 'POST', input)
    setSession(data.session)
    return data.user
  },
  getStoreInviteInfo: (code: string) => getJSON<StoreInviteInfo>(`/auth/store-invite/${encodeURIComponent(code)}`),
  registerStore: async (
    input: { email: string; password: string; code: string; name: string; phone?: string },
  ): Promise<AuthUser> => {
    setSession(null)
    const data = await sendJSON<{ user: AuthUser; session: Session }>('/auth/register-store', 'POST', input)
    setSession(data.session)
    return data.user
  },
  registerOwner: async (
    input: { email: string; password: string; companyName: string; name: string; phone: string },
  ): Promise<AuthUser> => {
    setSession(null)
    const data = await sendJSON<{ user: AuthUser; session: Session }>('/auth/register-owner', 'POST', input)
    setSession(data.session)
    return data.user
  },
  me: () => getJSON<{ user: AuthUser }>('/auth/me').then((d) => d.user),
  getProfile: () => getJSON<Profile>('/auth/profile'),
  updateProfile: (patch: { name?: string; phone?: string }) =>
    sendJSON<{ ok: true }>('/auth/profile', 'PUT', patch),
  changePassword: (currentPassword: string, newPassword: string) =>
    sendJSON<{ ok: true }>('/auth/change-password', 'POST', { currentPassword, newPassword }),
  /** Toggle notification opt-ins (availability changes / new chat messages / mentions). */
  setAlerts: (patch: {
    availabilityUpdates?: boolean
    chatMessages?: boolean
    marketplacePosts?: boolean
    mentions?: boolean
  }) =>
    sendJSON<{
      alerts: { availabilityUpdates: boolean; chatMessages: boolean; marketplacePosts: boolean; mentions: boolean }
    }>('/auth/alerts', 'PUT', patch),

  // --- notifications ---
  getNotifications: () =>
    getJSON<{ unread: number; items: NotificationItem[] }>('/notifications'),
  markNotificationRead: (id: number) =>
    sendJSON<{ ok: true }>(`/notifications/${id}/read`, 'POST', {}),
  markAllNotificationsRead: () => sendJSON<{ ok: true }>('/notifications/read-all', 'POST', {}),
  sendTestEmail: () =>
    sendJSON<{ ok: boolean; sentTo: string; error?: string }>('/notifications/test-email', 'POST', {}),

  // --- shift-change requests ---
  getOpenShifts: () => getJSON<Shift[]>('/shifts/open'),
  getSwapTargets: (shiftId: number) =>
    getJSON<{ id: number; name: string }[]>(`/change-requests/swap-targets?shiftId=${shiftId}`),
  getMyChangeRequests: () => getJSON<ChangeRequest[]>('/change-requests/mine'),
  createChangeRequest: (input: {
    type: ChangeType
    shiftId: number
    targetEmployeeId?: number
    note?: string
    /** hand off only this slice ("HH:MM") of the shift — omit for the whole shift */
    handoffStart?: string
    handoffEnd?: string
  }) => sendJSON<ChangeRequest>('/change-requests', 'POST', input),
  cancelChangeRequest: (id: number) => sendJSON<ChangeRequest>(`/change-requests/${id}/cancel`, 'POST', {}),

  // --- marketplace ---
  getMarketplace: () =>
    getJSON<{ available: ChangeRequest[]; claimed: ChangeRequest[]; posted: ChangeRequest[] }>(
      '/change-requests/marketplace',
    ),
  claimOffer: (id: number) => sendJSON<ChangeRequest>(`/change-requests/${id}/claim`, 'POST', {}),
  unclaimOffer: (id: number) => sendJSON<ChangeRequest>(`/change-requests/${id}/unclaim`, 'POST', {}),
  getChangeRequests: (status?: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED') =>
    getJSON<ChangeRequest[]>(`/change-requests${status ? `?status=${status}` : ''}`),
  approveChangeRequest: (id: number) => sendJSON<ChangeRequest>(`/change-requests/${id}/approve`, 'POST', {}),
  denyChangeRequest: (id: number) => sendJSON<ChangeRequest>(`/change-requests/${id}/deny`, 'POST', {}),
  renotifyOffer: (id: number) =>
    sendJSON<{ ok: true }>(`/change-requests/${id}/renotify`, 'POST', {}),
  getAssignable: (id: number) =>
    getJSON<{ id: number; name: string }[]>(`/change-requests/${id}/assignable`),
  assignOffer: (id: number, employeeId: number) =>
    sendJSON<ChangeRequest>(`/change-requests/${id}/assign`, 'POST', { employeeId }),

  // --- time off / vacation (a notice, not an approval) ---
  getMyTimeOff: () => getJSON<TimeOffRequest[]>('/time-off/mine'),
  requestTimeOff: (input: { startDate: string; endDate: string; note?: string }) =>
    sendJSON<TimeOffRequest>('/time-off', 'POST', input),
  cancelTimeOff: (id: number) => request<{ ok: true }>(`/time-off/${id}`, { method: 'DELETE' }),
  /** Manager: current + upcoming notices. `unacked` limits to ones not yet marked seen. */
  getTimeOff: (unacked?: boolean) =>
    getJSON<TimeOffRequest[]>(`/time-off${unacked ? '?unacked=1' : ''}`),
  ackTimeOff: (id: number) => sendJSON<TimeOffRequest>(`/time-off/${id}/ack`, 'POST', {}),
  logout: async () => {
    try {
      await sendJSON('/auth/logout', 'POST', {})
    } catch {
      // best-effort; we clear locally regardless
    }
    setSession(null)
  },
  deleteAccount: async (password: string) => {
    const data = await request<{ ok: true }>('/auth/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    setSession(null)
    return data
  },

  // --- schedule board ---
  getStores: () => getJSON<Store[]>('/stores'),
  getOverview: () => getJSON<{ stores: OverviewStore[] }>('/overview'),

  // --- owner: team (owners + managers) ---
  getTeam: () => getJSON<{ people: ManagerRow[] }>('/managers').then((d) => d.people),
  getOrg: () => getJSON<{ id: number; name: string }>('/managers/org'),
  updateOrgName: (name: string) => sendJSON<{ id: number; name: string }>('/managers/org', 'PUT', { name }),
  getManagerInvites: () => getJSON<ManagerInvite[]>('/managers/invites'),
  createManagerInvite: (input: { role: 'OWNER' | 'MANAGER'; storeIds?: number[] }) =>
    sendJSON<ManagerInvite>('/managers/invites', 'POST', input),
  cancelManagerInvite: (id: number) => request<{ message: string }>(`/managers/invites/${id}`, { method: 'DELETE' }),
  setManagerStores: (id: number, storeIds: number[]) =>
    sendJSON<{ id: number; storeIds: number[] }>(`/managers/${id}/stores`, 'PUT', { storeIds }),
  setPersonRole: (id: number, role: 'OWNER' | 'MANAGER') =>
    sendJSON<{ id: number; role: string }>(`/managers/${id}/role`, 'POST', { role }),
  removePerson: (id: number) => request<{ message: string }>(`/managers/${id}`, { method: 'DELETE' }),
  createStore: (input: {
    name: string
    requiresOpenerSkill?: boolean
    pairNewWorkers?: boolean
    tracksClosingDuties?: boolean
  }) => sendJSON<Store>('/stores', 'POST', input),
  updateStore: (
    id: number,
    patch: {
      name: string
      requiresOpenerSkill?: boolean
      pairNewWorkers?: boolean
      tracksClosingDuties?: boolean
      openTime?: string | null
      closeTime?: string | null
      nightStart?: string | null
    },
  ) => sendJSON<Store>(`/stores/${id}`, 'PUT', patch),
  /** Weekday-exception hours + holiday dates for a store. */
  getStoreHours: (storeId: number) =>
    getJSON<StoreHoursConfig>(`/stores/${storeId}/hours`),
  /** Replace the whole set of weekday exceptions (send only the days that differ). */
  putStoreWeekdayHours: (storeId: number, weekday: StoreHoursConfig['weekday']) =>
    sendJSON<{ ok: true }>(`/stores/${storeId}/hours`, 'PUT', { weekday }),
  addStoreHoliday: (
    storeId: number,
    input: { date: string; label?: string; closed?: boolean; openTime?: string | null; closeTime?: string | null; nightStart?: string | null },
  ) => sendJSON<{ id: number; date: string; label: string | null; closed: boolean }>(`/stores/${storeId}/holidays`, 'POST', input),
  deleteStoreHoliday: (storeId: number, hid: number) =>
    request<{ ok: true }>(`/stores/${storeId}/holidays/${hid}`, { method: 'DELETE' }),
  deleteStore: (id: number) => request<{ message: string }>(`/stores/${id}`, { method: 'DELETE' }),
  getStoreInvite: (storeId: number) => getJSON<StoreInvite | null>(`/stores/${storeId}/invite`),
  createStoreInvite: (storeId: number) => sendJSON<StoreInvite>(`/stores/${storeId}/invite`, 'POST', {}),
  deleteStoreInvite: (storeId: number) =>
    request<{ ok: true }>(`/stores/${storeId}/invite`, { method: 'DELETE' }),
  getEmployees: () => getJSON<Employee[]>('/employees'),
  getEmployeeStores: () => getJSON<EmployeeStore[]>('/employeeStores'),
  addWorkerToStore: (input: {
    employeeId: number
    storeId: number
    proficiency: Tier
    canOpen?: boolean
    canClose?: boolean
  }) => sendJSON<EmployeeStore>('/employeeStores', 'POST', input),
  /** Change a worker's tier (or opener/closer flag) at a store they're already linked to. */
  updateWorkerStore: (
    employeeId: number,
    storeId: number,
    patch: { proficiency?: Tier; canOpen?: boolean; canClose?: boolean },
  ) => sendJSON<EmployeeStore>(`/employeeStores/${employeeId}/${storeId}`, 'PUT', patch),
  removeWorkerFromStore: (employeeId: number, storeId: number) =>
    request<{ message: string }>(`/employeeStores/${employeeId}/${storeId}`, { method: 'DELETE' }),
  getShifts: () => getJSON<Shift[]>('/shifts'),
  getShiftRequirements: () => getJSON<ShiftRequirement[]>('/shiftrequirements'),
  getStoreRequirements: (storeId: number) =>
    getJSON<ShiftRequirement[]>(`/shiftrequirements?storeId=${storeId}`),
  createRequirement: (input: RequirementInput) =>
    sendJSON<ShiftRequirement>('/shiftrequirements', 'POST', input),
  updateRequirementFull: (id: number, input: Omit<RequirementInput, 'storeId'>) =>
    sendJSON<ShiftRequirement>(`/shiftrequirements/${id}`, 'PUT', input),
  deleteRequirement: (id: number) =>
    request<{ message: string }>(`/shiftrequirements/${id}`, { method: 'DELETE' }),
  getAvailability: () => getJSON<RecurringAvailability[]>('/availability'),

  // --- manager: workers ---
  getRoster: () => getJSON<RosterWorker[]>('/employees/roster'),
  createWorker: (input: {
    name: string
    hourLimit: number
    maxShifts: number
    standby?: boolean
    store?: { storeId: number; proficiency: Tier; canOpen?: boolean; canClose?: boolean; primary?: boolean }
  }) => sendJSON<RosterWorker>('/employees', 'POST', input),
  updateWorker: (
    id: number,
    patch: {
      name: string
      hourLimit: number
      maxShifts: number
      standby?: boolean
      phone?: string | null
      avatarFruit?: string | null
    },
  ) => sendJSON<RosterWorker>(`/employees/${id}`, 'PUT', patch),
  deleteWorker: (id: number) =>
    request<{ message: string; accountLeftUnlinked: string | null }>(`/employees/${id}`, { method: 'DELETE' }),
  inviteWorker: (id: number) =>
    sendJSON<{ employeeId: number; inviteCode: string }>(`/employees/${id}/invite`, 'POST', {}),

  // --- fixed (standing) shifts: an employee always works this store/day/window ---
  getFixedShifts: (storeId: number) =>
    getJSON<FixedShift[]>(`/fixed-shifts?storeId=${storeId}`),
  addFixedShift: (input: { employeeId: number; storeId: number; day: DayOfWeek; start: string; end: string }) =>
    sendJSON<FixedShift>('/fixed-shifts', 'POST', input),
  removeFixedShift: (id: number) => request<{ ok: true }>(`/fixed-shifts/${id}`, { method: 'DELETE' }),
  /** Manager/owner adds themselves as a schedulable worker at every store they run. */
  becomeWorker: () =>
    sendJSON<{ employeeId: number; created: boolean; stores: number }>('/employees/me', 'POST', {}),
  /** The caller's chosen fruit avatar + the fruits already taken at their store(s). */
  getMyFruit: () => getJSON<{ mine: string | null; taken: string[] }>('/employees/mine/fruit'),
  setMyFruit: (fruit: string | null) =>
    sendJSON<{ fruit: string | null }>('/employees/mine/fruit', 'PUT', { fruit }),
  /** The signed-in employee sets their own weekly caps. */
  updateMyLimits: (patch: { hourLimit?: number; maxShifts?: number }) =>
    sendJSON<{ hourLimit: number; maxShifts: number }>('/employees/mine/limits', 'PUT', patch),
  /** Replace the caller's "one of these days only" groups (e.g. [["SATURDAY","SUNDAY"]]). */
  setMyEitherOr: (groups: DayOfWeek[][]) =>
    sendJSON<{ groups: DayOfWeek[][] }>('/employees/mine/either-or', 'PUT', { groups }),
  /** Toggle "never schedule me on two back-to-back days". */
  setMyNoConsecutive: (on: boolean) =>
    sendJSON<{ noConsecutiveDays: boolean }>('/employees/mine/no-consecutive', 'PUT', { on }),

  // --- employee self-service ---
  getMyAvailability: () => getJSON<RecurringAvailability[]>('/availability/mine'),
  /** Opening / closing / night-shift window for the caller's store(s), per weekday. */
  getMyStoreHours: () =>
    getJSON<{
      open: string
      close: string
      night: { start: string; end: string }
      byDay: Record<DayOfWeek, DayHours>
    }>('/availability/mine/hours'),
  /** Replace the signed-in employee's whole week. start/end are "HH:MM". */
  saveMyAvailability: (windows: { day: DayOfWeek; start: string; end: string }[]) =>
    sendJSON<RecurringAvailability[]>('/availability/mine', 'PUT', { windows }),
  /** One-week override of the caller's standing availability. `weekStart` is "YYYY-MM-DD".
   * When no override exists yet, `windows` echoes the standing set (hasOverride:false). */
  getMyWeekAvailability: (weekStart: string) =>
    getJSON<{
      weekStart: string
      hasOverride: boolean
      confirmed: boolean
      windows: { day: DayOfWeek; start: string; end: string }[]
    }>(`/availability/mine/week?weekStart=${weekStart}`),
  saveMyWeekAvailability: (weekStart: string, windows: { day: DayOfWeek; start: string; end: string }[]) =>
    sendJSON<{ weekStart: string; hasOverride: boolean; windows: { day: DayOfWeek; start: string; end: string }[] }>(
      '/availability/mine/week',
      'PUT',
      { weekStart, windows },
    ),
  clearMyWeekAvailability: (weekStart: string) =>
    request<{ ok: true }>(`/availability/mine/week?weekStart=${weekStart}`, { method: 'DELETE' }),
  /** "My hours are right for this week" — no override needed. */
  confirmMyWeekAvailability: (weekStart: string) =>
    sendJSON<{ weekStart: string; confirmed: true }>('/availability/mine/confirm', 'POST', { weekStart }),
  /** Every week currently on the board across the stores the caller works, and
   * whether they've confirmed/overridden it — one entry per store usually, but
   * split when stores' schedules aren't on the same week. */
  getMyPendingWeeks: () =>
    getJSON<{ weeks: { weekStart: string; stores: string[]; confirmed: boolean }[] }>(
      '/availability/mine/pending-weeks',
    ),
  /** Manager: every one-week override for `weekStart`, for employees at their stores. */
  getWeekAvailability: (weekStart: string) =>
    getJSON<{
      overriddenEmployeeIds: number[]
      windows: { employeeId: number; day: DayOfWeek; start: string; end: string }[]
    }>(`/availability/week?weekStart=${weekStart}`),
  /** Manager: each worker's effective availability for `weekStart` + whether
   * they've checked it. `days` is keyed by DayOfWeek → windows ("HH:MM"). */
  getAvailabilityConfirmations: (weekStart: string) =>
    getJSON<{
      weekStart: string
      workers: {
        employeeId: number
        name: string
        storeIds: number[]
        state: 'changed' | 'confirmed' | 'pending'
        at: string | null
        source: 'override' | 'standing'
        days: Partial<Record<DayOfWeek, { start: string; end: string }[]>>
        timeOff: DayOfWeek[]
      }[]
    }>(`/availability/confirmations?weekStart=${weekStart}`),

  generateSchedule: (storeId: number, opts?: { saveFirst?: boolean; saveLabel?: string }) =>
    sendJSON<GenerateScheduleResult>('/schedule/generate', 'POST', { storeId, solveSeconds: 5, ...opts }),

  // --- publish state + calendar week (per store) ---
  getScheduleStatus: (storeId: number) =>
    getJSON<{
      publishedAt: string | null
      weekStart: string
      postedWeekStart: string | null
      /** every week with a frozen roster to look back at (any past week, not just
       * the ones before the board's current pointer) */
      pastWeeks: string[]
      /** the board's own week has already ended, calendar-wise, but nobody's
       * advanced past it yet */
      liveWeekStale: boolean
    }>(`/schedule/status?storeId=${storeId}`),
  /** frozen roster for a past week (posted, archived, or frozen on first view) — read-only */
  getScheduleWeekView: (storeId: number, weekStart: string) =>
    getJSON<SnapshotDetail>(`/schedule/week-view?storeId=${storeId}&weekStart=${weekStart}`),
  /** Bring a saved week back onto the live board — allowed as long as that
   * week's own calendar dates haven't passed yet, even if the board has since
   * moved on to (or published) a later week. */
  restoreSnapshot: (storeId: number, id: number) =>
    sendJSON<{ restored: number; weekStart: string }>(`/schedule/snapshots/${id}/restore`, 'POST', { storeId }),
  publishSchedule: (storeId: number) =>
    sendJSON<{ publishedAt: string | null }>('/schedule/publish', 'POST', { storeId }),
  unpublishSchedule: (storeId: number) =>
    sendJSON<{ publishedAt: string | null }>('/schedule/unpublish', 'POST', { storeId }),
  setScheduleWeek: (storeId: number, weekStart: string) =>
    sendJSON<{ weekStart: string }>('/schedule/week', 'PUT', { storeId, weekStart }),
  getMyShifts: () => getJSON<MyShiftsResponse>('/shifts/mine'),

  // --- closing duties (who does closing/bathroom/sweep/mop each day) ---
  getClosingDuties: (storeId: number, weekStart: string) =>
    getJSON<ClosingDutyWeek>(`/closing-duties?storeId=${storeId}&weekStart=${weekStart}`),
  regenerateClosingDuties: (storeId: number, weekStart: string) =>
    sendJSON<ClosingDutyWeek>('/closing-duties/generate', 'POST', { storeId, weekStart }),
  setClosingDuty: (storeId: number, weekStart: string, day: DayOfWeek, duty: ClosingDuty) =>
    sendJSON<ClosingDutyDay>('/closing-duties', 'PUT', { storeId, weekStart, day, ...duty }),

  /** Reassign and/or shorten/extend an existing shift row (undefined fields are left alone). */
  updateShift: (shiftId: number, patch: { employeeId?: number; start?: string; end?: string }) =>
    sendJSON<Shift>(`/shifts/${shiftId}`, 'PUT', patch),

  /** Manually fill an open slot, or hand off the tail of a split shift, with a new row. */
  createShift: (input: { employeeId: number; storeId: number; day: DayOfWeek; start: string; end: string }) =>
    sendJSON<Shift>('/shifts', 'POST', input),

  /** Take someone off a shift entirely (may leave the slot short). */
  deleteShift: (shiftId: number) => request<void>(`/shifts/${shiftId}`, { method: 'DELETE' }),

  /** Change how many people a slot needs (holidays, etc.). */
  updateRequirement: (
    id: number,
    patch: Partial<{
      managerRequired: number
      seniorRequired: number
      regularRequired: number
      newRequired: number
      needOpen: boolean
    }>,
  ) => sendJSON<ShiftRequirement>(`/shiftrequirements/${id}`, 'PUT', patch),

  // --- per-store group chat ---
  /** Latest page, or (with `after`) everything newer, or (with `before`) the page just older. */
  getChatMessages: (storeId: number, opts?: { after?: number; before?: number }) => {
    const q = opts?.after != null ? `?after=${opts.after}` : opts?.before != null ? `?before=${opts.before}` : ''
    return getJSON<{ messages: ChatMessage[]; hasMore: boolean }>(`/chat/${storeId}/messages${q}`)
  },
  sendChatMessage: (storeId: number, body: string, mentions: number[] = [], mentionAll = false) =>
    sendJSON<{ message: ChatMessage }>(`/chat/${storeId}/messages`, 'POST', { body, mentions, mentionAll }),
  getChatMembers: (storeId: number) =>
    getJSON<{ members: ChatMember[] }>(`/chat/${storeId}/members`),
  markChatRead: (storeId: number) =>
    sendJSON<{ ok: true }>(`/chat/${storeId}/read`, 'POST', {}),
  getChatUnread: () =>
    getJSON<{ total: number; byStore: Record<number, number>; dm: number }>('/chat/unread'),

  // --- direct messages ---
  getChatConversations: () => getJSON<{ conversations: Conversation[] }>('/chat/conversations'),
  getDmPeers: () => getJSON<{ peers: DmPeer[]; noAccount: string[] }>('/chat/dm/peers'),
  getDmMessages: (peerId: number, opts?: { after?: number; before?: number }) => {
    const q = opts?.after != null ? `?after=${opts.after}` : opts?.before != null ? `?before=${opts.before}` : ''
    return getJSON<{ messages: ChatMessage[]; hasMore: boolean }>(`/chat/dm/${peerId}/messages${q}`)
  },
  sendDm: (peerId: number, body: string) =>
    sendJSON<{ message: ChatMessage }>(`/chat/dm/${peerId}/messages`, 'POST', { body }),
  markDmRead: (peerId: number) => sendJSON<{ ok: true }>(`/chat/dm/${peerId}/read`, 'POST', {}),

  // --- shift pass-down notes ---
  getNotes: (storeId: number) =>
    getJSON<{ open: ShiftNote[]; recentlyDone: ShiftNote[] }>(`/notes?storeId=${storeId}`),
  getNoteCounts: () =>
    getJSON<{ total: number; byStore: Record<number, number> }>('/notes/counts'),
  addNote: (input: {
    storeId: number
    body: string
    category?: ShiftNoteCategory
    issueAt?: string
    customerName?: string
    customerPhone?: string
    orderDetails?: string
  }) => sendJSON<{ note: ShiftNote }>('/notes', 'POST', input),
  resolveNote: (id: number, resolved: boolean) =>
    sendJSON<{ note: ShiftNote }>(`/notes/${id}/resolve`, 'POST', { resolved }),
  deleteNote: (id: number) => request<{ ok: true }>(`/notes/${id}`, { method: 'DELETE' }),

  // --- superadmin: read-only cross-org oversight (platform operator only) ---
  getAdminOrgs: () => getJSON<AdminOrgSummary[]>('/admin/orgs'),
  getAdminOrg: (id: number) => getJSON<AdminOrgDetail>(`/admin/orgs/${id}`),

  // --- public: request access, and the superadmin queue that approves it ---
  requestAccess: (input: { businessName: string; contactName: string; email: string; phone?: string; message?: string }) =>
    sendJSON<{ ok: true }>('/signup-requests', 'POST', input),
  getSignupRequests: (status?: SignupRequest['status']) =>
    getJSON<SignupRequest[]>(`/admin/signup-requests${status ? `?status=${status}` : ''}`),
  approveSignupRequest: (id: number) =>
    sendJSON<{ ok: true; orgId: number }>(`/admin/signup-requests/${id}/approve`, 'POST', {}),
  declineSignupRequest: (id: number) =>
    sendJSON<{ ok: true }>(`/admin/signup-requests/${id}/decline`, 'POST', {}),

  // --- public: request account deletion, and the superadmin queue that fulfills it ---
  requestAccountDeletion: (input: { email: string; reason?: string }) =>
    sendJSON<{ ok: true }>('/account-deletion-requests', 'POST', input),
  getDeletionRequests: (status?: AccountDeletionRequest['status']) =>
    getJSON<AccountDeletionRequest[]>(`/admin/deletion-requests${status ? `?status=${status}` : ''}`),
  fulfillDeletionRequest: (id: number) =>
    sendJSON<{ ok: true }>(`/admin/deletion-requests/${id}/fulfill`, 'POST', {}),
  declineDeletionRequest: (id: number) =>
    sendJSON<{ ok: true }>(`/admin/deletion-requests/${id}/decline`, 'POST', {}),
}
