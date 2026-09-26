# Fruit Crew

An employee-scheduling web app for a small multi-store business. A manager sets
each store's staffing needs, workers submit their availability, and an OR-Tools
solver builds the week's schedule. Managers review the draft, tweak it by hand,
and post it; workers then see their shifts, swap or drop them, pick up open
slots, and chat with their store.

Built for real weekly use — cute "Fruit Crew" styling, fruit-avatar identities,
email + in-app notifications, and a Thursday/Saturday cron that nudges workers
and auto-drafts next week.

---

## How it fits together

| Part | Stack | Role |
|---|---|---|
| **API + web app** | Express 5 + TypeScript + Prisma 6 | One Node service. Serves `/api/*` **and** the built React SPA from the same origin (no CORS). |
| **Solver** | Python + FastAPI + OR-Tools CP-SAT | Called only by the API over HTTP. Turns DB data into `{assignments, gaps}`. |
| **Database + auth** | Supabase (Postgres + Auth) | Hosted. Access tokens are ES256, verified against the project JWKS. |

```
Frontend/   React 19 + Vite 8 + Tailwind v4 + react-router 7
Backend/    Express + Prisma + tsx; routes/ + lib/ + prisma/migrations
Solver/     FastAPI service.py + engine.py (CP-SAT model)
DEPLOY.md   production setup (Railway / Render + Supabase)
```

The frontend calls the API at `/api` with no host, so in production the Node
service serves both; in dev the Vite proxy forwards `/api` to `localhost:3000`.

---

## Running locally

Needs **Node ≥ 22**, **Python 3**, and a Supabase project (free tier is fine).

### 1. Solver

```bash
cd Solver
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn service:app --reload --port 8000
```

### 2. Backend

```bash
cd Backend
npm install
cp .env.example .env        # fill in DATABASE_URL, DIRECT_URL, SUPABASE_URL,
                            # SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
npx prisma migrate deploy   # apply migrations to your database
npm run dev                 # tsx watch, on :3000
```

### 3. Frontend

```bash
cd Frontend
npm install
npm run dev                 # Vite on :5173, proxies /api -> :3000
```

Open <http://localhost:5173>. First run: go to `/setup` to create the owner
account and the org (the page locks itself once an owner exists). Or from the
backend: `npm run create-owner -- <email> "Company name"`.

Managers and workers are then added inside the app (Stores → Managers,
Workers → invite).

---

## Concepts

- **Roles.** `OWNER` (whole org), `MANAGER` (assigned stores), `EMPLOYEE`. An
  owner/manager can also opt in as a schedulable worker. A separate
  `isSuperAdmin` flag (platform-level, independent of role/org) grants
  read-only cross-org oversight at `/admin` — set by hand for support, not
  self-serve.
- **Invite-only accounts.** A manager issues a single-use invite code for a
  specific worker, or an invite link for a new manager/owner; a store can also
  run a reusable self-service sign-up link for anyone who has it. Every invite
  expires if unused (7 days for a personal invite, 90 for a store's standing
  link) and single-use ones are consumed on first claim.
- **New-worker approval.** Anyone who joins through an invite code or a
  store's self-service link starts **pending** — they can sign in and see
  their own status, but nothing else, until a manager or owner approves them
  from the Workers page. Rejecting instead removes the pending account.
- **Availability.** Standing weekly windows, plus one-week overrides for a
  specific week, plus time-off notices that drop days from the solver. Workers
  can cap their own weekly hours / days, forbid back-to-back days, or mark
  "one of these days only" (e.g. Sat *or* Sun).
- **Fixed shifts.** A senior member who always works the same days: placed
  verbatim, the solver fills the rest.
- **On-call workers.** No availability, never auto-scheduled — a manager drops
  them into a shift by hand, and they can pick up open slots.
- **Generate → review → post.** Generating solves the week as a *draft*.
  Employees keep seeing the last **posted** schedule (a frozen snapshot) until
  the manager posts the new one.
- **Marketplace.** Employees request swap / drop / pickup on a posted shift;
  managers approve. A "recommend a direct swap" helper finds two-way matches.
- **Chat.** One polling-based group chat per store for everyone assigned there.
- **Notifications.** In-app always; email (via Resend) for opt-in alerts —
  availability changes, chat digests, the weekly cron reminders.
- **History.** Every posted/regenerated week is snapshotted and restorable.

---

## Common tasks

```bash
# Backend
npx prisma migrate dev --name <desc>   # new migration from schema.prisma
npx prisma studio                      # inspect the DB
npm run seed:demo                      # demo data
npx tsc --noEmit                       # typecheck

# Frontend
npm run build                          # tsc -b && vite build (run this, not tsc alone)
npx oxlint

# Solver
curl -s -X POST localhost:8000/solve --data-binary @Solver/sample_payload.json | python3 -m json.tool
```

---

## Deployment

See **[DEPLOY.md](DEPLOY.md)**. Short version: Railway, two services from this
one repo — the API (root `/`, also serves the SPA) and the solver (`/Solver`,
scales to zero). `railway.json` in each sets the build/start commands;
`predeploy` runs `prisma migrate deploy`. Add the five Supabase secrets to the
API service, plus `SOLVER_URL` and the cron/email vars, and allow-list the
deployed URL in Supabase Auth.
