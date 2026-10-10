// Mirrors Backend/prisma/schema.prisma. Kept hand-written (no generated client on
// this side) since the frontend only ever talks to the REST API, never Prisma directly.

export type DayOfWeek =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY'

export type Tier = 'NEW' | 'REGULAR' | 'SENIOR' | 'MANAGER'

export type Role = 'OWNER' | 'MANAGER' | 'EMPLOYEE'

/** The current account, as returned by /auth/login, /auth/register and /auth/me. */
export interface AuthUser {
  id: number
  email: string
  name: string | null
  role: Role
  employeeId: number | null
  /** platform-level, independent of role/org — read-only cross-org oversight */
  isSuperAdmin: boolean
  /** false only for an EMPLOYEE who self-registered via an invite code and
   * hasn't been reviewed by a manager/owner yet — the backend blocks almost
   * everything else until it's true (see ProtectedRoute). */
  approved: boolean
  /** Only populated by /auth/me (not the login/register/oauth responses) —
   * false for a Google/Apple-only sign-in, which never set a Supabase
   * password. Treat undefined as "assume yes" (the safer default) since it
   * just means this came from a response that doesn't carry the field yet. */
  hasPassword?: boolean
  /** Sign in with Apple is connected to this login (only /auth/me sets it) */
  appleLinked?: boolean
  /** true when this login's org has been paused or deleted by a superadmin
   * (e.g. non-payment) — every route but /auth/me and logout is blocked
   * server-side regardless of this flag; it just drives the gate screen.
   * Same "only /auth/me populates it" caveat as hasPassword. */
  orgBlocked?: boolean
  /** true when billing is on and this business's free trial ended without a
   * plan — the owner can still subscribe (see BillingLapsed), everyone else waits */
  billingLapsed?: boolean
  /** paid add-ons this business can use (chat, notes, closing) — see lib/addons.ts */
  addons?: ('chat' | 'notes' | 'closing')[]
}

export type BillingState = 'off' | 'exempt' | 'trial' | 'active' | 'past_due' | 'lapsed'

/** GET /billing — the owner's view of their plan */
export interface BillingSummary {
  enabled: boolean
  state: BillingState
  trialEndsAt: string | null
  daysLeft: number | null
  storeLimit: number | null
  storesInUse: number
  /** stores the subscription pays for — null unless subscribed */
  paidStores: number | null
  monthly: number
  nextStorePrice: number
  hasBillingAccount: boolean
  /** the stores part of the monthly total, before add-ons */
  storesMonthly: number
  addonPrice: number
  addons: { key: 'chat' | 'notes' | 'closing'; on: boolean; paid: boolean; usedInTrial: boolean }[]
}

export interface AdminOrgSummary {
  id: number
  name: string
  createdAt: string
  owners: string[]
  storeCount: number
  /** stores not counting sections — what storeLimit caps */
  locationCount: number
  /** null = no limit */
  storeLimit: number | null
  employeeCount: number
  pausedAt: string | null
  deletedAt: string | null
  billing: { state: BillingState; trialEndsAt: string | null; exempt: boolean; monthly: number | null; addons: string[] }
}

export interface AdminOrgDetail {
  id: number
  name: string
  createdAt: string
  pausedAt: string | null
  deletedAt: string | null
  stores: {
    id: number
    name: string
    parentStoreId: number | null
    employeeCount: number
    publishedAt: string | null
    weekStart: string | null
  }[]
  people: {
    id: number
    email: string
    role: 'OWNER' | 'MANAGER'
    createdAt: string
    storeIds: number[]
  }[]
  pendingOwnerInvite: { code: string; expiresAt: string | null } | null
  /** the public sign-up request this business was approved from, if any */
  signupRequest: { contactName: string; email: string; phone: string | null; message: string | null; createdAt: string } | null
}

export interface SignupRequest {
  id: number
  businessName: string
  contactName: string
  email: string
  phone: string | null
  message: string | null
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED'
  createdAt: string
  resolvedAt: string | null
  resolvedById: number | null
  orgId: number | null
}

export interface AccountDeletionRequest {
  id: number
  email: string
  reason: string | null
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED'
  createdAt: string
  resolvedAt: string | null
  resolvedById: number | null
}

/** Supabase token pair from /auth/login and /auth/register. */
export interface Session {
  access_token: string
  refresh_token: string
  expires_at?: number
}

/** What every sign-up form asks for — the server joins them into one display
 * name (see Backend/src/lib/names.ts). */
export interface NameParts {
  firstName: string
  middleName: string
  lastName: string
}

/** The login half of a sign-up form (see components/SignupFields.tsx). */
export interface AccountParts {
  phone: string
  email: string
  password: string
}

export interface Store {
  id: number
  name: string
  /** a section (e.g. "Front of House") is an ordinary store with a parent —
   * null for a top-level store, which is every store until one gets sections */
  parentStoreId: number | null
  requiresOpenerSkill: boolean
  pairNewWorkers: boolean
  tracksClosingDuties: boolean
  /** "HH:MM" 24h — the availability editor's quick-add defaults; null = derive from shift needs */
  openTime: string | null
  closeTime: string | null
  nightStart: string | null
  /** when the weekly "check next week's availability" email goes out to this
   * store's workers, and when its next-week draft schedule auto-generates —
   * both wall-clock in the server's timezone (see Backend/src/cron.ts) */
  availabilityReminderDay: DayOfWeek
  availabilityReminderTime: string
  autoGenerateDay: DayOfWeek
  autoGenerateTime: string
  /** days on which nobody works more than one shift here (the generator's hard rule) */
  noBackToBackDays: DayOfWeek[]
}

/** Resolved store hours for one weekday. */
export interface DayHours {
  open: string
  close: string
  night: { start: string; end: string }
  closed: boolean
}

export interface StoreHoursConfig {
  default: { openTime: string | null; closeTime: string | null; nightStart: string | null }
  weekday: {
    day: DayOfWeek
    closed: boolean
    openTime: string | null
    closeTime: string | null
    nightStart: string | null
  }[]
  holidays: {
    id: number
    date: string // "YYYY-MM-DD"
    label: string | null
    closed: boolean
    openTime: string | null
    closeTime: string | null
    nightStart: string | null
  }[]
}

export interface Employee {
  id: number
  name: string
  hourLimit: number
  maxShifts: number
  standby: boolean
  avatarFruit: string | null
}

export interface EmployeeStore {
  employeeId: number
  storeId: number
  proficiency: Tier
  /** computed from the built-in Opener Responsibility grant — kept as a plain
   * boolean since the schedule board, gap warnings and candidate picker all
   * still read it that way (see Responsibility below for the full list) */
  canOpen: boolean
  /** every Responsibility id (built-in + custom) this person holds at this store */
  responsibilityIds: number[]
  primary: boolean
}

export type ResponsibilityScope = 'OPENING' | 'CLOSING' | 'ANY'

/** A store-defined capability/role — replaces the old fixed canOpen/canClose
 * booleans and the fixed 4-role Closing Duties board. `builtin` marks the one
 * auto-seeded row (Opener) that keeps powering the schedule generator; it
 * can't be renamed or removed. There's no equivalent "Closer" builtin — the
 * old canClose flag gated exactly one role (the migrated "Closing" role
 * itself), so every closing-time role just gets its own independent grant. */
export interface Responsibility {
  id: number
  storeId: number
  name: string
  scope: ResponsibilityScope
  sortOrder: number
  builtin: boolean
  archivedAt: string | null
}

export interface Shift {
  id: number
  employeeId: number | null
  storeId: number
  /** ISO datetime; which calendar week this shift belongs to (Monday, UTC midnight) */
  weekStart: string
  day: DayOfWeek
  start: string // ISO datetime string; only the wall-clock time (UTC) matters
  end: string
}

export interface RecurringAvailability {
  id: number
  employeeId: number
  day: DayOfWeek
  start: string
  end: string
}

export interface ShiftRequirement {
  id: number
  storeId: number
  day: DayOfWeek
  start: string
  end: string
  managerRequired: number
  seniorRequired: number
  regularRequired: number
  newRequired: number
  needOpen: boolean
  graceMinutes: number
}

/** Per-tier shape used by the requirements editor (POST/PUT /shiftrequirements) —
 * mirrors ShiftRequirement's own proficiency counts, just with HH:MM times. */
export interface RequirementInput {
  storeId?: number
  day: DayOfWeek
  start: string // "HH:MM"
  end: string
  managerRequired: number
  seniorRequired: number
  regularRequired: number
  newRequired: number
  needOpen: boolean
  graceMinutes: number
}

export interface ScheduleGap {
  requirementId: number
  kind: 'head' | 'senior' | 'open'
  shortBy: number
}

export interface RosterStoreLink {
  storeId: number
  proficiency: Tier
  canOpen: boolean
  responsibilityIds: number[]
  primary: boolean
}

/** A worker as shown on the manager's Workers screen (GET /employees/roster). */
export interface RosterWorker {
  id: number
  name: string
  phone: string | null
  hourLimit: number
  maxShifts: number
  standby: boolean
  avatarFruit: string | null
  inviteCode: string | null
  /** "YYYY-MM-DD" | null — manager-set, when this worker started */
  hireDate: string | null
  /** "one of these days only" groups, e.g. [["SATURDAY","SUNDAY"]] */
  eitherOrDays: DayOfWeek[][]
  /** never two back-to-back days in a week */
  noConsecutiveDays: boolean
  /** never a partial/split day — every requirement window a store has that day, or none */
  fullDayOnly: boolean
  /** weekly hours to aim for — a soft goal for the generator (hourLimit is the hard cap); null = none */
  targetHours: number | null
  account: { email: string; approved: boolean } | null
  stores: RosterStoreLink[]
}

/** What a person can switch off for phone pushes (Backend/src/lib/notify.ts PUSH_TOPICS). */
export type PushTopic = 'schedule' | 'reminders' | 'openShifts' | 'chat' | 'approvals'

export interface Profile {
  id: number
  email: string
  name: string | null
  phone: string | null
  role: Role
  /** notification opt-ins */
  alerts: { availabilityUpdates: boolean; chatMessages: boolean; marketplacePosts: boolean; mentions: boolean }
  /** phone-push categories switched off — see PushTopic */
  pushMuted: PushTopic[]
  employee: {
    id: number
    name: string
    hourLimit: number
    maxShifts: number
    /** "one of these days only" groups, e.g. [["SATURDAY","SUNDAY"]] */
    eitherOrDays: DayOfWeek[][]
    /** never schedule this person on two back-to-back days */
    noConsecutiveDays: boolean
    standby: boolean
    /** "YYYY-MM-DD" | null — manager-set, when this worker started */
    hireDate: string | null
    /** total hours worked so far in the org's current pay period */
    hoursThisPeriod: number
    /** exact — show with durationLabel */
    minutesThisPeriod: number
    /** "YYYY-MM-DD" | null — the current pay period's bounds (periodEnd is exclusive) */
    periodStart: string | null
    periodEnd: string | null
    stores: { storeId: number; storeName: string; proficiency: Tier; canOpen: boolean }[]
  } | null
}

export type PayPeriodType = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'

export interface HoursSummary {
  periodStart: string
  periodEnd: string // exclusive
  payPeriodType: PayPeriodType
  /** minutes are exact — show with durationLabel; hours is the old rounded figure */
  rows: { employeeId: number; name: string; minutes: number; hours: number }[]
}

export type ChangeType = 'DROP' | 'SWAP' | 'PICKUP'
export type RequestStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED'

export type TimeOffState = 'upcoming' | 'active' | 'past' | 'cancelled'

export interface TimeOffRequest {
  id: number
  employeeId: number
  employeeName: string | null
  startDate: string // "YYYY-MM-DD"
  endDate: string
  note: string | null
  createdAt: string
  /** derived: cancelled, or where it sits relative to today */
  state: TimeOffState
  /** a manager marked this notice seen */
  acknowledged: boolean
}

export interface ChangeRequest {
  id: number
  type: ChangeType
  status: RequestStatus
  /** true = posted to the marketplace (a SWAP or DROP) — no target until someone claims it or a counteroffer is accepted */
  openOffer: boolean
  note: string | null
  createdAt: string
  resolvedAt: string | null
  shift: {
    id: number
    storeId: number
    day: DayOfWeek
    start: string
    end: string
    employeeId: number | null
  }
  requestedBy: { id: number; name: string }
  targetEmployee: { id: number; name: string } | null
  /** set when only part of the shift is being handed off (ISO like shift.start/end) */
  handoffStart: string | null
  handoffEnd: string | null
  /** only ever populated on the caller's own posts — pending proposals to cover part of the offered window */
  counterOffers?: CounterOffer[]
  /** manager list only, pending requests: the receiver's week if this is approved */
  receiverLoad?: { hours: number; minutes: number; hourLimit: number; days: number; maxShifts: number } | null
}

export interface CounterOffer {
  id: number
  employeeId: number
  employeeName: string
  /** proposed coverage window (ISO, like Shift.start/end) */
  start: string
  end: string
  note: string | null
  status: RequestStatus
  createdAt: string
}

export interface ShiftCoworker {
  name: string
  /** employeeId — feeds the deterministic default fruit */
  avatarKey: number
  avatarFruit: string | null
}

export interface MyShift extends Shift {
  /** everyone else on at the same store whose hours overlap this shift */
  coworkers: ShiftCoworker[]
}

export interface TeamShift {
  storeId: number
  day: DayOfWeek
  start: string
  end: string
  /** null = an open (unassigned) slot */
  employeeId: number | null
  name: string
  avatarKey: number
  avatarFruit: string | null
}

export interface MyShiftsResponse {
  /** set once next week is posted: this calendar week's own shifts, read-only,
   * so the rest of the current week doesn't disappear */
  thisWeek?: { weekStart: string; shifts: MyShift[] } | null
  /** weeks after this one but before the posted week (a manager posted two
   * weeks ahead) — read-only, oldest first */
  upcomingWeeks?: { weekStart: string; shifts: MyShift[] }[]
  published: boolean
  /** false while a new week is being drafted — shifts are shown read-only, no swaps */
  live: boolean
  publishedAt: string | null
  weekStart: string | null
  shifts: MyShift[]
  /** every shift at the shown store(s) — the whole team's week */
  team: TeamShift[]
  stores: {
    storeId: number
    storeName: string
    publishedAt: string | null
    weekStart: string | null
    live: boolean
  }[]
}

export interface SnapshotMeta {
  id: number
  weekStart: string
  label: string | null
  savedAt: string
}

export interface SnapshotShift {
  employeeId: number | null
  employeeName: string | null
  storeId: number
  storeName: string
  day: DayOfWeek
  start: string // "HH:MM"
  end: string
}

export interface SnapshotDetail extends SnapshotMeta {
  savedById: number | null
  shifts: SnapshotShift[]
}

/** One retroactive edit to a past week — see getScheduleEditLog */
export interface EditLogEntry {
  id: number
  weekStart: string
  editedAt: string
  editedBy: { id: number; name: string | null; email: string } | null
}

export interface ClosingCrewMember {
  employeeId: number
  name: string
  tier: Tier
  /** ids of this store's CLOSING-scope Responsibility rows this person holds */
  responsibilityIds: number[]
  avatarFruit: string | null
}

export interface ClosingDutyRoleAssignment {
  responsibilityId: number
  employeeIds: number[]
}

export interface ClosingDuty {
  assignments: ClosingDutyRoleAssignment[]
}

export interface ClosingDutyDay {
  day: DayOfWeek
  crew: ClosingCrewMember[]
  duty: ClosingDuty | null
}

export interface ClosingDutyWeek {
  /** false = this store doesn't use the Closing Duties feature (Store.tracksClosingDuties) */
  enabled: boolean
  weekStart: string
  /** this store's CLOSING-scope responsibilities, in display/assignment order */
  responsibilities: Responsibility[]
  days: ClosingDutyDay[]
}

export interface FixedShift {
  id: number
  employeeId: number
  employeeName: string | null
  storeId: number
  day: DayOfWeek
  start: string // "HH:MM"
  end: string
}

export interface NotificationItem {
  id: number
  kind: 'AVAILABILITY_REMINDER' | 'SCHEDULE_DRAFTED' | 'GENERIC'
  title: string
  body: string | null
  link: string | null
  createdAt: string
  readAt: string | null
}

export interface ManagerRow {
  id: number
  email: string
  role: Role
  storeIds: number[]
  /** which stores they're also staffed/schedulable at as an Employee —
   * distinct from storeIds, which is about managing, not working */
  employeeStoreIds: number[]
  isSelf: boolean
}

/** A pending, unclaimed sign-up link for a co-owner or manager. */
export interface ManagerInvite {
  id: number
  code: string
  role: 'OWNER' | 'MANAGER'
  storeIds: number[]
  createdAt: string
}

/** What GET /auth/manager-invite/:code shows before someone registers. */
export interface ManagerInviteInfo {
  role: 'OWNER' | 'MANAGER'
  orgName: string
  storeNames: string[]
}

/** A store's reusable sign-up link — unlike ManagerInvite, not single-use. */
export interface StoreInvite {
  code: string
  createdAt: string
}

/** What GET /auth/store-invite/:code shows before someone registers. */
export interface StoreInviteInfo {
  storeName: string
  orgName: string
  /** this store's own sections (e.g. Front of House / Back of House), if any —
   * empty for an ordinary store. When non-empty, the worker picks one or more
   * to join instead of joining the store itself (see RegisterStore.tsx). */
  sections: { id: number; name: string }[]
}

/** One schedulable store (or section) on the manager Home screen. */
export interface HomeStore {
  storeId: number
  name: string
  publishedAt: string | null
  weekStart: string | null
  /** the week being edited has shifts but workers can't see it yet */
  draftReady: boolean
  shiftCount: number
  openShifts: number
  staffHours: number
  staffMinutes: number
  requirementCount: number
  /** people short this week — same number as the schedule board's gap chip */
  gapCount: number
  pendingRequests: number
}

export interface HomeData {
  attention: {
    approvals: number
    timeOff: number
    signups: number
    availability: { weekStart: string; answered: number; total: number }
    gaps: number
    draftsReady: { storeId: number; name: string }[]
    openNotes: number
    needsSetup: { storeId: number; name: string }[]
  }
  stores: HomeStore[]
  setup: {
    hasStore: boolean
    hasShiftNeeds: boolean
    hasTeam: boolean
    teamOnApp: boolean
    generated: boolean
    posted: boolean
  }
}

export interface GenerateScheduleResult {
  created: number
  optimal: boolean
  objective: number | null
  unfilled: number
  spread: number | null
  shiftsPerEmployee: Record<string, number>
  gaps: ScheduleGap[]
}

export interface ChatMessage {
  id: number
  storeId: number
  body: string
  createdAt: string
  authorName: string
  /** the author's login (null once their account is removed) — what blocking acts on */
  authorId: number | null
  /** stable per-person key for the deterministic default avatar */
  authorKey: number
  authorFruit: string | null
  mine: boolean
  /** true when you're one of this message's @-mentions */
  mentionsMe: boolean
}

export interface ChatMember {
  userId: number
  name: string
  avatarKey: number
  avatarFruit: string | null
}

export interface DmPeer {
  userId: number
  name: string
  avatarKey: number
  avatarFruit: string | null
  /** names of the store(s) you and this person both work */
  sharedStores: string[]
  unread: number
  lastMessageAt: string | null
}

export type ShiftNoteCategory =
  | 'GENERAL'
  | 'REFUND'
  | 'COMPLAINT'
  | 'REMAKE'
  | 'LOST_FOUND'
  | 'STOCK'
  | 'MAINTENANCE'

export interface ShiftNote {
  id: number
  storeId: number
  category: ShiftNoteCategory
  body: string
  /** optional — only ever set for REFUND / COMPLAINT / REMAKE */
  issueAt: string | null
  customerName: string | null
  customerPhone: string | null
  orderDetails: string | null
  createdAt: string
  authorName: string
  authorKey: number
  authorFruit: string | null
  mine: boolean
  resolvedAt: string | null
  resolvedName: string | null
}

export type Conversation =
  | {
      kind: 'store'
      storeId: number
      name: string
      lastMessage: string | null
      lastAt: string | null
      unread: number
    }
  | {
      kind: 'dm'
      userId: number
      name: string
      avatarKey: number
      avatarFruit: string | null
      lastMessage: string
      lastAt: string
      unread: number
    }
