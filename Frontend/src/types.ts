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

export type Role = 'OWNER' | 'MANAGER' | 'EMPLOYEE' | 'AMBASSADOR'

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
  /** paid add-ons this business can use (chat, notes, closing, assistant) — see lib/addons.ts */
  addons?: ('chat' | 'notes' | 'closing' | 'assistant')[]
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
  addons: { key: 'chat' | 'notes' | 'closing' | 'assistant'; on: boolean; paid: boolean; usedInTrial: boolean }[]
  /** how the current plan is billed — null until there is one */
  interval: 'month' | 'year' | null
  /** paying yearly instead: 88% of twelve months, rounded up */
  storesYearly: number
  nextStoreYearlyPrice: number
  addonYearlyPrice: number
  refundDays: number
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
  billing: { state: BillingState; trialEndsAt: string | null; exempt: boolean; monthly: number | null; yearly: number | null; addons: string[] }
  /** the student ambassador who brought them in */
  referredBy: string | null
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
  address: string | null
  website: string | null
  /** as typed or from the student's link — kept even when it matched nobody */
  referralCode: string | null
  referral: { id: number; ambassadorName: string; ambassadorCode: string; source: string; warnings: AmbassadorWarning[] } | null
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
  /** a coworker taking a shift from Market, or someone picking up an open
   * one, goes through without a manager (a section follows its parent) */
  autoApproveTrades: boolean
  /** no trades this many hours before a shift starts; 0 = no limit */
  tradeCutoffHours: number
  /** days on which nobody works more than one shift here (the generator's hard rule) */
  noBackToBackDays: DayOfWeek[]
  /** where hours worked come from (a section follows its parent): not
   * tracked, clocked on FruitCrew, or imported from the POS's time clock */
  timeClock: TimeClockMode
}

export type TimeClockMode = 'OFF' | 'APP' | 'POS'

/** One stretch on the clock. Times are "YYYY-MM-DDTHH:MM" on the stores' clock. */
export interface TimeEntry {
  id: number
  employeeId: number
  storeId: number
  clockIn: string
  /** null = still on the clock */
  clockOut: string | null
  /** unpaid break already taken */
  breakMinutes: number
  /** on a break right now, since then */
  onBreakSince: string | null
  source: 'CLOCK' | 'IMPORT' | 'MANUAL'
  approved: boolean
  /** a manager changed the times */
  edited: boolean
}

/** What the worker's clock card needs. */
export interface ClockStatus {
  /** where they can clock in */
  stores: { storeId: number; name: string }[]
  open: TimeEntry | null
  /** today's finished stretches */
  today: TimeEntry[]
  /** the stores' clock when this was read */
  now: string
}

/** One store's week of hours, next to its schedule. */
export interface Timesheet {
  storeId: number
  mode: TimeClockMode
  weekStart: string
  now: string
  people: { id: number; name: string; avatarFruit: string | null; posName: string | null }[]
  entries: TimeEntry[]
  /** on the clock right now, whatever week they started in */
  openNow: TimeEntry[]
  scheduled: { employeeId: number; day: DayOfWeek; start: string; end: string }[]
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

/** SECTION = a part of the store someone works (Front, Produce…) — set per
 * shift (Shift.sectionId); a person's own grants are just their usual one(s) */
export type ResponsibilityScope = 'OPENING' | 'CLOSING' | 'ANY' | 'SECTION'

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
  /** the SECTION-scope Responsibility they're on for this shift */
  sectionId?: number | null
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
  /** scheduled this week (Mon–Sun) across the stores you run — /employees/roster only */
  weekMinutes?: number
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
  /** pay columns below are only sent to someone who can see pay */
  canSeePay?: boolean
  rows: {
    employeeId: number
    name: string
    minutes: number
    hours: number
    overtimeMinutes: number
    payRateCents?: number | null
    /** estimated gross: their hours at their rate, overtime at 1.5× — null with no rate set */
    payCents?: number | null
  }[]
  /** set when a store has a time clock — its hours here are hours worked, not scheduled */
  timeClock?: {
    stores: string[]
    /** every store has one (so no hours here come from the schedule) */
    allStores: boolean
    /** stretches still on the clock / not yet approved, this period */
    open: number
    unapproved: number
  } | null
}

/** SWAP = give a shift away (to one coworker, or posted for anyone when
 * openOffer); PICKUP = claim an open shift. */
export type ChangeType = 'SWAP' | 'PICKUP'
export type RequestStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED'

export type TimeOffState = 'upcoming' | 'active' | 'past' | 'cancelled' | 'declined'

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
  /** why a manager turned it down (state 'declined'), if they said */
  declineNote: string | null
}

export interface ChangeRequest {
  id: number
  type: ChangeType
  status: RequestStatus
  /** true = posted to the marketplace (a SWAP with nobody named) — no target until someone claims it or a counteroffer is accepted */
  openOffer: boolean
  note: string | null
  createdAt: string
  resolvedAt: string | null
  shift: {
    id: number
    storeId: number
    /** the Monday of the shift's own week (ISO) */
    weekStart: string
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
  /** the part of the store they're on for that shift */
  section?: string | null
}

export interface MyShift extends Shift {
  /** the part of the store this shift is on (Front, Produce…) */
  section?: string | null
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
  section?: string | null
}

/** A week before the posted one that's still on people's phones. */
export interface MyShiftsWeek {
  weekStart: string
  shifts: MyShift[]
  team: TeamShift[]
  /** still running live: swaps, drops and pickups work, like the posted week.
   * false = an archived copy, read-only */
  live: boolean
}

export interface MyShiftsResponse {
  /** set once next week is posted: this calendar week, so the rest of it
   * doesn't disappear (and its shifts can still be traded) */
  thisWeek?: MyShiftsWeek | null
  /** weeks after this one but before the posted week (a manager posted two
   * weeks ahead), oldest first */
  upcomingWeeks?: MyShiftsWeek[]
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
    /** no trades this many hours before a shift there; 0 = no limit */
    tradeCutoffHours?: number
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
  /** absent on copies saved before shifts had sections */
  sectionId?: number | null
  sectionName?: string | null
}

export interface SnapshotDetail extends SnapshotMeta {
  savedById: number | null
  shifts: SnapshotShift[]
  /** the posted week while next week's draft is on the board, shown from its
   * live rows (swaps approved since posting included), not the saved copy */
  live?: boolean
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
  /** a worker asked for a week that isn't posted yet — days are all empty */
  unposted?: boolean
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
  /** estimated labor for the week (overtime at 1.5×) — only for someone who can see pay */
  laborCents?: number
  /** people on the week with no pay rate set, so left out of laborCents */
  unratedCount?: number
}

export interface HomeData {
  /** who's on the floor today across the manager's stores, back-to-back rows as one */
  today: {
    date: string
    /** minutes since midnight on the stores' clock */
    nowMinute: number
    shifts: {
      storeId: number
      storeName: string
      employeeId: number
      name: string
      avatarFruit: string | null
      start: string // "HH:MM"
      end: string
      section: string | null
    }[]
    /** stores with the FruitCrew clock on, and who's clocked in at them now */
    clockStoreIds?: number[]
    clockedIn?: { employeeId: number; storeId: number; since: string; onBreak: boolean }[]
  }
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

/** Schedule › Import: the store and week an imported schedule goes into. */
export interface ImportContext {
  /** false until the server has the Anthropic key */
  ready: boolean
  /** "YYYY-MM-DD" — the week being planned on the board */
  weekStart: string
  /** that week is already posted (import into next week instead) */
  posted: boolean
  existingShifts: number
  hasNeeds: boolean
  people: { id: number; name: string; posName: string | null }[]
  sections: { id: number; name: string }[]
}

/** What was read off a schedule file — nothing saved yet. */
export interface ReadSchedule {
  /** "YYYY-MM-DD" Monday of the week the file shows, "" if it shows no dates */
  weekOf: string
  people: { name: string; role: string }[]
  /** person "" = an open shift; role "" = none */
  shifts: { person: string; day: DayOfWeek; start: string; end: string; role: string; unsure: boolean }[]
  notes: string[]
}

/** The schedule assistant's allowance: requests used this month, out of how many. */
export interface AssistantAllowance {
  used: number
  limit: number
  /** the business has the "More AI requests" add-on */
  extra: boolean
  /** "YYYY-MM-DD" — the 1st of next month */
  resetsOn: string
}

/** A shift as the assistant saw it, or as it would leave it. employeeId null = open. */
export interface AssistantShift {
  day: DayOfWeek
  start: string
  end: string
  employeeId: number | null
}

/** Rules a suggested change bends — it still goes through, the manager just sees why. */
export type AssistantWarning = 'closed' | 'timeOff' | 'availability' | 'noAvailability' | 'standby' | 'hours' | 'days'

export interface AssistantChange {
  op: 'assign' | 'retime' | 'add' | 'remove'
  shiftId: number | null
  before: AssistantShift | null
  after: AssistantShift | null
  why: string
  warnings: AssistantWarning[]
}

/** One answer from the assistant: what it says and the changes it suggests — nothing made yet. */
export interface AssistantAnswer {
  id: number
  reply: string
  /** the message wasn't about the schedule — no reply or changes, the app says why */
  offTopic: boolean
  changes: AssistantChange[]
  /** changes it suggested that couldn't be made (left out) */
  problems: string[]
  /** people whose week changes, in minutes */
  hours: { employeeId: number; name: string; before: number; after: number }[]
  /** employeeId → name, for showing the changes */
  names: Record<string, string>
  allowance: AssistantAllowance
}

export interface ImportResult {
  weekStart: string
  shifts: number
  leftOff: number
  added: number
  sections: number
  needs: number
}

// ---- Student ambassadors

export type AmbassadorWarning =
  | { code: 'selfEmail' | 'selfPhone' | 'selfName' | 'sameDomain' | 'noAddress' }
  | { code: 'duplicate'; name: string; since: string }
  | { code: 'otherClaim'; name: string }

export type AmbassadorStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'
/** A lesson in the ambassador portal's Learn tab (AMB_LESSONS in lib/ambassadorText). */
export type AmbLesson = 'pitch' | 'start' | 'weekly' | 'pricing' | 'questions' | 'dosDonts' | 'pay'
export type BusinessStage = 'requested' | 'declined' | 'notCredited' | 'closed' | 'trial' | 'paying' | 'canceled'
export type CommissionKind = 'BOUNTY' | 'RECURRING' | 'ADJUSTMENT'
export type CommissionStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' | 'REVERSED'
/** where a reward stands: waiting on a check, in the refund window, owed, going out, paid… */
export type CommissionState = 'pending' | 'held' | 'payable' | 'sending' | 'paid' | 'rejected' | 'reversed'
export type LeadStatus =
  | 'available'
  | 'claimedByYou'
  | 'claimed'
  | 'contacted'
  | 'interested'
  | 'followUp'
  | 'trial'
  | 'customer'
  | 'declined'
  | 'doNotContact'
export type ContactMethod = 'IN_PERSON' | 'PHONE' | 'EMAIL' | 'SOCIAL' | 'OTHER'
export type ContactOutcome = 'NO_ANSWER' | 'LEFT_INFO' | 'SPOKE' | 'INTERESTED' | 'FOLLOW_UP' | 'DECLINED' | 'DO_NOT_CONTACT'
export type LeadContactStatus = 'NEW' | 'CONTACTED' | 'INTERESTED' | 'FOLLOW_UP' | 'DECLINED'

/** The public /ambassadors page's numbers. */
export interface AmbassadorProgramPublic {
  enrollmentOpen: boolean
  bountyCents: number
  rateBps: number
  extraStoreRateBps: number
  maxPaidPeriods: number
  storePriceCents: number
  perMonthCents: number
  maxPerStoreCents: number
}

export interface AmbassadorTotals {
  pendingBounties: number
  pendingCommissions: number
  approvedUnpaid: number
  paid: number
  lifetime: number
}

export interface AmbassadorMe {
  ambassador: { name: string; email: string; code: string; status: AmbassadorStatus; school: string | null; area: string | null; isAdult: boolean; w9Received: boolean }
  program: {
    bountyCents: number
    rateBps: number
    extraStoreRateBps: number
    maxPaidPeriods: number
    holdDays: number
    claimDays: number
    maxActiveClaims: number
    referralsOpen: boolean
    perMonthCents: number
    termsVersion: number
  }
  termsAccepted: boolean
  /** the Learn lessons they've marked done (AMB_LESSONS) */
  trainingDone: AmbLesson[]
  totals: AmbassadorTotals
  estimate: { monthlyCents: number; upcomingCents: number }
  counts: { openClaims: number; businesses: number; stores: number; activated: number; paying: number }
}

export interface AmbassadorStoreRow {
  storeId: number
  name: string
  position: number
  hasWorkers: boolean
  posted: boolean
  activated: boolean
  bounty: CommissionState | null
  paidMonths: number
  monthsLeft: number
  maxMonths: number
  earnedCents: number
  perMonthCents: number
  estimateLeftCents: number
}

export interface AmbassadorBusiness {
  id: number
  name: string
  stage: BusinessStage
  since: string
  stores: AmbassadorStoreRow[]
}

export interface AmbassadorEarning {
  id: number
  kind: CommissionKind
  state: CommissionState
  amountCents: number
  business: string | null
  store: string | null
  memo: string
  periods: number
  periodStart: string | null
  periodEnd: string | null
  createdAt: string
  availableAt: string
}

export interface AmbassadorPayout {
  id: number
  amountCents: number
  status: 'APPROVED' | 'PAID' | 'CANCELED'
  approvedAt: string
  paidAt: string | null
  method: string | null
}

export interface LeadCard {
  id: number
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  category: string | null
  status: LeadStatus
  canClaim: boolean
  blockedBy: string | null
  claimExpiresAt: string | null
  lastContactAt: string | null
  followUpAt: string | null
  followUpAsked: boolean
  reopenedForYou: boolean
  lastOutcome?: ContactOutcome | null
}

export interface LeadDetail extends LeadCard {
  phone: string | null
  history: { id: number; who: 'you' | 'ambassador' | 'fruitcrew'; contactedAt: string; method: ContactMethod; outcome: ContactOutcome; followUpAt: string | null; notes: string | null }[]
}

export interface LeadInput {
  name: string
  address?: string
  city?: string
  state?: string
  zip?: string
  phone?: string
  category?: string
}

// admin

export interface AmbassadorBudget {
  budgetCents: number
  paidCents: number
  approvedUnpaidCents: number
  pendingCents: number
  estimatedFutureCents: number
  ifTrialsConvertCents: number
  remainingCents: number
  perNewStoreCents: number
  overBudget: boolean
  nearLimit: boolean
}

export interface AmbassadorOverview {
  ambassadors: number
  activeAmbassadors: number
  pendingApplications: number
  businessesReferred: number
  storesReferred: number
  storesActivated: number
  payingStores: number
  revenueCents: number
  bountiesPaidCents: number
  pendingCents: number
  pendingCount: number
  acquisitionCostCents: number | null
  followUpRequests: number
  leadsToReview: number
  budget: AmbassadorBudget
}

export interface AmbassadorApplication {
  id: number
  name: string
  email: string
  school: string | null
  area: string
  experience: string | null
  why: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
  decidedAt: string | null
  decisionNote: string | null
  ambassadorId: number | null
}

export interface AmbassadorRow {
  id: number
  name: string
  email: string
  school: string | null
  code: string
  status: AmbassadorStatus
  hasLogin: boolean
  businesses: number
  stores: number
  activated: number
  paying: number
  storeList: { storeId: number; name: string; business: string; stage: BusinessStage; activated: boolean }[]
  /** what their stores have paid FruitCrew */
  revenueCents: number
  openClaims: number
  contacts30d: number
  lastContactAt: string | null
  trainingDone: number
  trainingTotal: number
  earnedCents: number
  pendingCents: number
  paidCents: number
  payableCents: number
}

export interface AdminCommission {
  id: number
  kind: CommissionKind
  status: CommissionStatus
  state: CommissionState
  amountCents: number
  grossCents?: number | null
  ambassador?: { id: number; name: string }
  business: string | null
  verified?: boolean
  store: string | null
  memo: string
  flags: string | null
  periods: number
  periodStart?: string | null
  periodEnd?: string | null
  createdAt: string
  availableAt: string
  decisionNote?: string | null
  payoutId: number | null
}

export interface AdminStoreProgress {
  storeId: number
  name: string
  position: number
  workers: number
  postedWeeks: number
  activated: boolean
  paidMonths: number
  monthsLeft: number
  earnedCents: number
  bounty: CommissionState | null
  perMonthCents: number
  estimateLeftCents: number
}

export interface AdminPayout {
  id: number
  ambassadorId: number
  amountCents: number
  status: 'APPROVED' | 'PAID' | 'CANCELED'
  approvedAt: string
  paidAt: string | null
  method: string | null
  reference: string | null
  canceledAt: string | null
  rows?: number
  ambassador?: { id: number; name: string; email: string }
}

export interface AuditEntry {
  id: number
  at: string
  actorUserId: number | null
  actor?: string | null
  action: string
  ambassadorId: number | null
  referralId: number | null
  leadId: number | null
  commissionId: number | null
  payoutId: number | null
  detail: unknown
}

export interface AmbassadorDetail {
  ambassador: {
    id: number
    name: string
    email: string
    phone: string | null
    school: string | null
    area: string | null
    code: string
    status: AmbassadorStatus
    isAdult: boolean
    w9Received: boolean
    notes: string | null
    createdAt: string
    hasLogin: boolean
    inviteUrl: string | null
    termsCurrent: boolean
    termsAcceptances: { version: number; acceptedAt: string }[]
    application: AmbassadorApplication | null
  }
  totals: AmbassadorTotals
  payableCents: number
  /** paid out this calendar year — a 1099-NEC is due at form1099Cents or more */
  paidThisYearCents: number
  form1099Cents: number
  businesses: { id: number; name: string; stage: BusinessStage; verified: boolean; rejected: boolean; since: string; stores: AdminStoreProgress[] }[]
  commissions: AdminCommission[]
  payouts: AdminPayout[]
  claims: { id: number; lead: { id: number; name: string; city: string | null }; claimedAt: string; expiresAt: string; endedAt: string | null; endReason: string | null; open: boolean }[]
  contacts: { id: number; lead: { id: number; name: string }; contactedAt: string; method: ContactMethod; outcome: ContactOutcome; notes: string | null }[]
  audit: AuditEntry[]
}

export interface AdminLead {
  id: number
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  category: string | null
  placeId: string | null
  source: 'IMPORT' | 'AMBASSADOR' | 'HISTORY'
  contactStatus: LeadContactStatus
  lastContactAt: string | null
  followUpAt: string | null
  doNotContact: boolean
  dncReason: string | null
  orgId: number | null
  followUpAskNote: string | null
  followUpAskAt: string | null
  reviewNote: string | null
  createdAt: string
  status: LeadStatus
  heldBy: { id: number; name: string; expiresAt: string } | null
  customer: string | null
  contacts: number
  followUpAskBy: string | null
  reopenedFor: string | null
}

export interface AdminLeadDetail {
  lead: Omit<AdminLead, 'status' | 'heldBy' | 'customer' | 'contacts' | 'followUpAskBy' | 'reopenedFor'> & {
    claims: { id: number; ambassador: { id: number; name: string }; claimedAt: string; expiresAt: string; endedAt: string | null; endReason: string | null }[]
    contacts: { id: number; ambassador: { id: number; name: string } | null; contactedAt: string; method: ContactMethod; outcome: ContactOutcome; notes: string | null; followUpAt: string | null }[]
    followUpAskById: number | null
  }
  customer: string | null
  matches: { id: number; name: string; address: string | null; city: string | null; how: 'same' | 'possible' }[]
  audit: AuditEntry[]
}

export interface AdminReferral {
  id: number
  name: string
  stage: BusinessStage
  ambassador: { id: number; name: string; code: string }
  source: string
  since: string
  orgId: number | null
  checks: { foundOnline: boolean; phoneChecked: boolean; ownerConfirmed: boolean }
  verifiedAt: string | null
  rejectedAt: string | null
  rejectNote: string | null
  terms: { bountyCents: number; rateBps: number; extraStoreRateBps: number; maxPaidPeriods: number }
  signup: { contactName: string; email: string; phone: string | null; address: string | null; website: string | null } | null
  lead: { id: number; name: string; city: string | null } | null
  warnings: AmbassadorWarning[]
  stores: AdminStoreProgress[]
}

export interface AmbassadorSettings {
  bountyCents: number
  rateBps: number
  extraStoreRateBps: number
  maxPaidPeriods: number
  holdDays: number
  claimDays: number
  maxActiveClaims: number
  budgetCents: number
  enrollmentOpen: boolean
  referralsOpen: boolean
  termsVersion: number
  termsText: string
  termsUpdatedAt: string
  starterTerms: boolean
}
