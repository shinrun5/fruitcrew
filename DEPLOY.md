# Deploying Fruit Crew

Three moving parts:

| Part | What runs it | Notes |
|------|--------------|-------|
| **Postgres + Auth** | Supabase | already hosted — nothing to deploy |
| **API + frontend** | one Node service | Express serves `/api/*` **and** the built React app from the same origin, so there's no CORS to configure |
| **Solver** | one Python service | FastAPI + OR-Tools, called only by the API (`SOLVER_URL`) |

The frontend calls the API at `/api` with no host (`Frontend/src/lib/api.ts`), so it
must be served from the same origin as the API. The Node service does that in
production; `npm run dev` uses the Vite proxy instead.

**Use Option B (Railway).** For a site employees open weekly, cold starts read as
"it's broken" — Railway keeps the API warm for ~$5/mo. Render's free tier sleeps;
its always-on tier is $7/service ($14 total).

---

## Option A — Render (blueprint, one file)

`render.yaml` in the repo root defines both services.

1. Push a branch with `render.yaml` on it.
2. Render dashboard → **New → Blueprint** → pick this repo → **Apply**.
3. When prompted, paste the five secrets from `Backend/.env`:
   `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`.
4. Do the [Supabase step](#supabase-auth-allow-list) below with the API's
   `https://fruitcrew-api.onrender.com` URL.

Build: frontend `npm ci` + `vite build` → backend `npm ci` (runs `prisma generate`).
Then a pre-deploy step runs `prisma migrate deploy` with the full runtime env, then
`npm start`.

**Free tier** works but the service sleeps after 15 min idle (~50 s cold start).
`plan: starter` ($7/mo/service) keeps both warm.

---

## Option B — Railway (recommended: no sleep, ~$5/mo)

Both services deploy from this repo and read their `railway.json`, so the
build/start commands are already set. Hobby plan ($5/mo, usage included) is
enough for this load.

One project, two services:

### 1. API service (also serves the frontend)
- **Add service → GitHub repo → this repo**
- **Settings → Root Directory**: `/` (default — picks up `/railway.json`)
- **Variables**: the five secrets from `Backend/.env`
  (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`), plus
  `SOLVER_URL=http://${{solver.RAILWAY_PRIVATE_DOMAIN}}:${{solver.PORT}}`
  (replace `solver` with whatever you name the service in step 2)
- **For scheduled jobs + email** (Fri availability reminder, Sat/Sun
  auto-generate): `CRON_ENABLED=1`, `APP_URL=https://<your-domain>`,
  `RESEND_API_KEY=<key>`, optionally `CRON_TZ` (default `America/New_York`)
  and `EMAIL_FROM` (needs a verified domain in Resend before it can email
  anyone other than the Resend account owner; in-app notifications work
  regardless)
- **For Schedule › Import a schedule and Ask AI** (Claude reads a photo, PDF
  or spreadsheet of a store's current schedule; a manager types what to change
  and applies Claude's suggested edits): `ANTHROPIC_API_KEY=<key>` from
  console.anthropic.com. Without it the import screen says it isn't switched
  on and the Ask AI button doesn't show; nothing else depends on it. Ask AI
  costs roughly 3–10¢ a message (Opus 5.5, medium effort; off-topic messages
  about 1¢); every request is logged with its token counts in the
  `AssistantRequest` table, off-topic ones flagged `offTopic`. Its limits:
  one message at a time and 5 a minute / 30 an hour per manager, the
  business's monthly allowance, and an app-wide backstop of
  `ASSISTANT_DAILY_LIMIT` requests per 24 hours (1,000 if unset; `0` pauses
  Ask AI everywhere)
- **Settings → Networking → Generate Domain** — this is the URL you hand out
- Build runs: frontend `npm ci` + `vite build` → backend `npm ci`
  (`prisma generate` via postinstall); a pre-deploy step then runs
  `prisma migrate deploy`, then `npm start`

### 2. Solver service
- **Add service → GitHub repo → this repo** (same repo again)
- **Settings → Root Directory**: `/Solver` (picks up its own `railway.json`)
- No variables needed
- **Do not** generate a public domain — the API reaches it on the private network
- `railway.json` sets `sleepApplication: true`, so it scales to zero and wakes
  when the owner generates a schedule (~once a week). First request after a
  sleep takes ~20–40 s while OR-Tools boots; that's fine for a weekly action.
  Flip it to `false` if you want it always warm.

---

## Supabase Auth allow-list

Supabase → **Authentication → URL Configuration**:
- **Site URL**: the API/frontend URL (e.g. `https://fruitcrew-api.onrender.com`)
- **Redirect URLs**: add the same URL

Without this, login redirects are rejected in production.

## Billing (Stripe)

Billing stays **off** until all three `STRIPE_*` variables below are set. While
it is off, nothing is charged, no trial counts down, and nobody is locked out.
Every business keeps its one-store limit, which the superadmin can raise in Admin.

Pricing is $16/month for the first store, $14 for the 2nd, $12 for the 3rd,
and $10 for each store after that. Sections don't count as stores.

Add-ons are $2/month each, per business: Chat, Shift notes, Closing
duties and More AI requests. While billing is off, during a free trial and for
a comped business, all of them are on. Once paying, a business has only the
add-ons on its subscription; the owner switches them on or off in Settings ›
Plan. Turning one off hides it but never deletes its data.

Ask AI (on the schedule) comes with every plan: 20 requests a month per
business, counted from the 1st. More AI requests adds 30 more (50 a month).

To turn billing on:

1. Create a Stripe account. Stay in **test mode** until you have run through the steps below end to end.
2. Create the prices (the per-store price and the four add-ons, each monthly and yearly). It is safe to re-run, because it finds what it made before and only creates what's missing — so run it again after updating, to add any new prices (the yearly ones, and More AI requests):
   ```bash
   STRIPE_SECRET_KEY=sk_test_... npm --prefix Backend run stripe:setup
   ```
   It prints `STRIPE_PRICE_STORES=price_...`.
3. In Stripe → **Developers → Webhooks**, add an endpoint:
   - URL: `https://<your-domain>/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, and for student ambassadors' commissions `invoice.paid`, `charge.refunded`, `charge.dispute.created`

   Copy its signing secret (`whsec_...`).
4. In Stripe → **Settings → Billing → Customer portal**, turn on:
   - updating payment methods
   - viewing invoices
   - cancelling subscriptions
5. Set these on the API service, then redeploy:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_STORES`
6. **Launch day:** in Admin, press **Start their 30-day trials**. Every existing business then gets 30 days from that moment. New businesses get 30 days automatically once billing is on.

Yearly plans are 88% of twelve months, rounded up to the dollar. Refunds: within 14 days of a payment, open the business in Admin and choose **Refund and cancel** — it refunds that payment and ends the plan.

To exempt a business from billing, open it in Admin and choose **Comp this business**. A comped business is never billed or locked out, and you set its store limit by hand.

Trial reminders go out 7 days and 1 day before a trial ends. They need `CRON_ENABLED=1` and `RESEND_API_KEY`.

When a trial ends without a subscription, workers see "ask your owner", and the owner sees a Subscribe button. No data is touched. The phone apps never show a buy button; subscribing happens on the website.

---

## Test the production build locally

```bash
# build the frontend so the API can serve it
npm --prefix Frontend run build

# run the API exactly as prod does (needs Backend/.env + the solver running)
npm --prefix Backend start
```

Then open <http://localhost:3000> — the API is now serving the SPA. `/api/health`
should return `{"status":"ok"}`.

## First accounts on a fresh deploy

**Businesses** sign up at `/request-access`; a superadmin approves them in Admin,
which creates the owner's invite.

**CLI** (the very first owner, another owner, or to promote an existing account):
run against the deployed database, from the host's shell or locally with the prod
`DATABASE_URL`:

```bash
npm --prefix Backend run create-owner -- <email> "Company name"
```

Managers and employees are then created from inside the app (Stores → Managers,
Workers → invite).

## Student ambassadors

Run from Admin → **Student ambassadors** (platform admins only).

- **Joining.** Students apply at `/ambassadors`. Approving one emails them an invite (`/ambassador/join?code=…`) to make their own login — role `AMBASSADOR`, which only ever sees the ambassador portal at `/ambassador`. They accept the program terms there; editing the terms in Settings makes a new version everyone accepts again.
- **Leads.** Import businesses (and earlier outreach) as CSV under Leads. Students claim a business before approaching it — one student per business (a partial unique index, `LeadClaim_one_open`), 5 at a time, lapsing 7 days after their last logged outreach. Customers, "do not contact" and already-contacted businesses can't be claimed without an admin's OK.
- **Referrals.** Their link is `/r/CODE` (or the code typed on `/request-access`). Verify each business under Referrals before its rewards can be approved.
- **Money** (defaults, all in Settings; a business keeps the terms it signed up under): $8 per store once it's set up (an owner, a worker, a posted schedule with shifts), approved by you; then 25% of each regular payment (15% for extra locations) for 12 paid months per store — a yearly payment counts as 12 — recorded from Stripe's `invoice.paid` and held 14 days. Refunds and disputes (`charge.refunded`, `charge.dispute.created`) take it back. Payouts are approved under Payouts, sent by hand, then marked paid; they need the student marked 18+ with a W-9 on file. Overview tracks the $1,000 pilot budget.
- **Before launch:** have the starter program terms reviewed (employment, tax and local rules).

A daily job (05:15 store time) lapses old claims and records bounties for stores that got going. The rules live in `Backend/src/lib/ambassadors.ts`.
