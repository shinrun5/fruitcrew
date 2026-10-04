# Fruit Crew — repo map for Claude

Employee-scheduling app for small multi-store businesses. `README.md` (concepts,
local setup) and `DEPLOY.md` (hosting, Stripe) cover the product side; this file
is the map of **where things live and what bites**. Keep it short and fix it
when it's wrong.

## Layout

| Dir | What | Notes |
|---|---|---|
| `Backend/` | Express 5 + TypeScript + Prisma 6, run with `tsx` (no build step) | `Backend/src/index.ts` mounts everything under `/api`; also serves the built SPA |
| `Frontend/` | React 19 + Vite 8 + Tailwind v4 + react-router 7 | Same-origin `/api` in prod; Vite proxy → `:3000` in dev. `android/` + `ios/` are Capacitor shells |
| `Solver/` | Python FastAPI + OR-Tools CP-SAT | `service.py` (HTTP schema) → `engine.py` (the model + objective weights). Only the API calls it |
| `MiniProgram/` | WeChat mini-program prototype | Plain JS; hits the same REST API as the web app |
| `design/` | Design canvas HTML | Not part of the app |

Ignore `Backend/.agents/`, `.claude/`, `.windsurf/` — vendored Prisma skill docs.
Prod = Railway (`railway.json` at root for the API, `Solver/railway.json` for the
solver); `render.yaml` is the alternative. Postgres + Auth = Supabase.

## Commands

```bash
# Backend (cd Backend)
npm run dev                   # tsx watch on :3000
npx tsc --noEmit              # typecheck — the main correctness check
npx prisma migrate dev --name <desc>   # schema change → new migration in prisma/migrations
npm run seed:demo | create-owner -- <email> "Org" | create-manager | delete-user

# Frontend (cd Frontend)
npm run dev                   # Vite on :5173
npm run build                 # check-i18n + tsc -b + vite build — run this, not tsc alone
npm run lint                  # oxlint

# Solver (cd Solver): uvicorn service:app --reload --port 8000
```

There are **no automated tests and no CI**. Typecheck + `npm run build` + trying it
in the app is the verification.

## Backend conventions

- **Routes**: one file per area in `Backend/src/routes/`, mounted in `index.ts`.
  Mount paths don't always match file names (`/shiftrequirements`,
  `/employeeStores`, but `/change-requests`, `/time-off`, `/fixed-shifts`).
- **Shared logic** is in `Backend/src/lib/` (`scheduleGen`, `notify`, `billing`,
  `addons`, `payPeriod`, `closingDuties`, `email`, `calendarFeed`, …).
  Imports use the `.js` extension (ESM/nodenext). `tsconfig` is strict incl.
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Auth** (`lib/auth.ts`): Supabase ES256 JWT in a `Bearer` header (no cookies) →
  `requireAuth` loads the `User` and sets `req.user` (`AuthUser`). Helpers:
  `requireRole(...)`, `requireOwner`, `requireSuperAdmin`, `canManageStore(user, storeId)`,
  `requireManagerFor(pick)` (403s unless the caller manages that store).
  **`req.user.storeIds` is the authorization scope**: every store for a super
  admin, the org's stores for an OWNER, assigned stores for a MANAGER, linked
  stores for an EMPLOYEE. Scope queries with it.
- `requireAuth` also blocks (403) paused/deleted orgs (`orgBlocked`), lapsed
  trials (`billingLapsed`) and unapproved employees (`pendingApproval`), except
  the `SELF_SERVICE_ALLOWED` routes.
- **Paid add-ons** `chat`, `notes`, `closing` gate whole routers via
  `requireAddon` in `index.ts` (`/chat`, `/notes`, `/closing-duties`).
- **Errors**: Express 5 forwards rejected async handlers to the last-resort
  handler in `index.ts`, which returns the generic `{error:'Internal server error'}`
  and emails the real error via `alertError`. A route that wants a specific
  message must catch inside a `try`. `alertError(source, err, ctx)` for anything
  unexpected. Use `notify`/`notifyMany`/`inBackground` (`lib/notify.ts`) for
  notifications; email only sends if `RESEND_API_KEY` is set.
- **Gotcha — `User.orgId` is nullable.** It is set for owners/managers created via
  invites, setup or `create-owner`, but **not** for users from the `create-manager`
  script, super admins or employees. Don't pass `req.user.orgId` into a Prisma
  filter (null on a required Int throws → generic 500; this was the
  "add worker to another store" bug). Derive the org from the target store
  instead. `routes/managers.ts` and `routes/billing.ts` do use `orgId!` — they're
  owner-only, so it's set there.
- Rate limits and CSP/helmet are configured in `index.ts`. Native Capacitor apps
  call the API cross-origin; allowed origins are listed there.

## Data model (`Backend/prisma/schema.prisma`)

- `Org` → `Store`. A **section** (e.g. Front/Back of House) is a `Store` with
  `parentStoreId`; one level only (enforced in `routes/stores.ts`). A store that
  has sections is not scheduled itself — its sections are.
- `User` (login; `role` OWNER/MANAGER/EMPLOYEE, `isSuperAdmin`, optional
  `employeeId`, `orgId`) ↔ `Employee` (a schedulable person; a user may or may
  not have one). Managers' stores: `ManagerStore`.
- `EmployeeStore` = Employee ↔ Store link: `proficiency` (`Experience`: NEW /
  REGULAR / SENIOR / MANAGER) and `primary` (false → solver only sends them
  there to fill a gap). "Can open" is now the built-in **Opener**
  `Responsibility` granted via `EmployeeResponsibility` (`lib/responsibilities.ts`),
  not a column.
- `ShiftRequirement` (per store/day/window: headcount, senior min, needs opener…)
  drives the solver. `Shift` = live assigned rows for a week.
- `Schedule` (one row per store): `weekStart` = the **draft** week being edited,
  `postedWeekStart` = the **posted** week employees see. They can differ.
  `ScheduleSnapshot` = frozen history; `ScheduleEditLog` = retroactive edits.
- Availability: `RecurringAvailability` (standing), `WeekAvailability`
  (one-week override that fully replaces standing), `TimeOffRequest`,
  `AvailabilityConfirmation`. `FixedShift` = pinned shifts.
- Marketplace: `ShiftChangeRequest` (swap/drop/pickup) + `ShiftCounterOffer`.
- Other: `Message`/`DirectMessage`/`MessageRead` (chat), `ShiftNote`, `ClosingDuty*`,
  `Notification`, `JobRun` (cron de-dupe), `ManagerInvite`/`StoreInvite`/
  `SignupRequest`/`AccountDeletionRequest`.

## Schedule generation flow

`POST /schedule/generate` (`routes/schedule.ts`) → `generateScheduleForStore`
(`lib/scheduleGen.ts`: loads employees, requirements, availability overrides,
time off, fixed shifts) → `callSolver` (`lib/solverClient.ts`, `SOLVER_URL`) →
`Solver/service.py` `POST /solve` → `engine.solve` → `{assignments, gaps}` →
written as a **draft** (never auto-posted). `POST /schedule/publish` snapshots
and sets `postedWeekStart`. Regenerating the posted week is refused
(`PostedWeekError`). If you change the solver payload, change **both**
`scheduleGen.ts` and the pydantic models in `Solver/service.py`.

Cron (`Backend/src/cron.ts`, only when `CRON_ENABLED=1`): per-store availability
reminder and auto-generate at the day/time each store configures, daily confirm
reminders, pruning/retention, trial reminders. `claim()` + `JobRun` stop
double-sends.

## Frontend conventions

- **Routes** are all in `src/App.tsx`, in three areas: manager/owner
  (`ManagerLayout`: `/home /schedule /team /requests /settings /payroll`),
  super-admin (`AdminLayout`: `/admin`), and employee (`EmployeeLayout`:
  `/my-shifts`, availability, marketplace, plus `/chat /notes /more`).
  `lib/roles.ts` decides the landing page.
- **All backend calls go through `src/lib/api.ts`** (typed, handles token refresh);
  response/request types are in `src/types.ts`. A new endpoint = add it to
  `api.ts` (+ types), not a raw `fetch`.
- **i18n**: `src/lib/i18n.tsx` holds `en` / `zh` / `es`. Every English key needs
  zh and es entries, and pages must use `t()` instead of hard-coded text —
  `npm run build` runs `scripts/check-i18n.mjs` and **fails** otherwise.
- Selected store lives in `lib/store-context.tsx` (persisted in localStorage;
  `hasSections()` for sectioned stores). Auth state in `lib/auth.tsx`.
- Scheduling-math helpers used by the board live in `lib/` (`gaps.ts`,
  `candidates.ts`, `swaps.ts`, `openers.ts`). `pages/Dashboard.tsx` is the large
  schedule board; `pages/Stores.tsx` is the Settings page.
- Public marketing pages are static: `Frontend/public/landing{,-zh,-es}.html`,
  served by Express at `/`, `/zh`, `/es`.
- Phone apps: Capacitor (`npm run build:capacitor`). Native apps are
  email+password only; Google/Apple sign-in and subscribing are web-only.
  App-store copy lives in `Frontend/STORE_SUBMISSION.md`.

## Where to look (feature → files)

| Feature | Backend | Frontend |
|---|---|---|
| Login/register/invites/OAuth | `routes/auth.ts`, `managers.ts`, `signupRequests.ts` | `pages/Login, Register*, RequestAccess` |
| Stores, hours, holidays, sections | `routes/stores.ts` | `pages/Stores.tsx`, `components/SpecialHoursEditor.tsx` |
| Workers, tiers, store links | `routes/employees.ts`, `employeeStores.ts`, `responsibilities.ts` | `pages/Workers.tsx`, `TeamMember.tsx`, `components/WorkerEditors.tsx` |
| Shift requirements | `routes/shiftRequirements.ts` | `components/RequirementsEditor.tsx` |
| Schedule board, generate, post, history | `routes/schedule.ts`, `shifts.ts`, `lib/scheduleGen.ts` | `pages/Dashboard.tsx`, `components/DayDeck.tsx` |
| Availability, time off | `routes/availability.ts`, `timeOff.ts` | `pages/Availability.tsx`, `components/Availability*.tsx`, `TimeOffPanel.tsx` |
| Swaps / marketplace | `routes/changeRequests.ts` | `pages/Marketplace.tsx`, `Requests.tsx`, `lib/swaps.ts` |
| Chat / DMs | `routes/chat.ts` | `pages/Chat.tsx`, `components/ChatThread.tsx` |
| Shift notes, closing duties | `routes/notes.ts`, `closingDuties.ts` | `pages/Notes.tsx`, `Closing.tsx` |
| Payroll hours | `lib/payPeriod.ts`, `routes/employees.ts` (`/hours-summary`, `/:id/hours`), `routes/managers.ts` (`/org/pay-period`) | `pages/Payroll.tsx` |
| Billing / add-ons / admin console | `routes/billing.ts`, `lib/billing.ts`, `addons.ts`, `routes/admin.ts` | `components/Billing.tsx`, `pages/Admin.tsx` |
| Notifications, email, calendar sync | `lib/notify.ts`, `email.ts`, `routes/notifications.ts`, `calendar.ts` | `components/NotificationBell.tsx`, `CalendarSync.tsx` |
