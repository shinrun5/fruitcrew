# Fruit Crew — App Store & Play Store submission package

Everything here is grounded in what the app actually does (see root `README.md`
and `src/pages/Privacy.tsx`/`Terms.tsx`) — nothing below claims a feature the
app doesn't have. Copy/paste straight into App Store Connect / Play Console
once your developer accounts are approved.

---

## 1. Build readiness checklist

| Item | Status |
|---|---|
| Bundle ID / package name (`com.fruitcrew.app`), consistent both platforms | ✅ Done |
| iOS export compliance (`ITSAppUsesNonExemptEncryption = false`) | ✅ Done |
| iOS App Icon (1024×1024) | ✅ Present |
| iOS Privacy Manifest (`PrivacyInfo.xcprivacy`) | ✅ Added this session |
| Android adaptive icons, all densities | ✅ Present |
| Android `targetSdk`/`compileSdk` 36, `minSdk` 24 | ✅ Meets current Play requirement |
| Android release signing (`.aab` actually signed, not debug-signed) | ✅ Added this session — verified with a real `bundleRelease` build |
| Apple *and* Google sign-in both offered | ✅ Done (satisfies Apple guideline 4.8: if you offer 3rd-party login, Sign in with Apple must also be offered) |
| iOS Distribution Certificate + Provisioning Profile | ⏸ Blocked — needs Apple Developer Program enrollment |
| App Store Connect app record created | ⏸ Blocked — needs enrollment |
| Play Console app record created | ⏸ Blocked — needs Play Console developer account approval |
| Screenshots for required device sizes | ✅ Captured from the demo business — `store-assets/screenshots/` (see §4) |
| Demo accounts for app reviewers | ✅ Script ready — `npm run seed:reviewer`; run it against production before submitting (see §5) |
| No purchase buttons, prices or "buy elsewhere" text inside the phone apps | ✅ Done — see §6 |
| In-app account deletion, with a confirmation popup | ✅ Done (Profile → Delete my account) |
| Support URL shows contact info | ✅ Homepage lists contact@fruitcrew.app |
| TestFlight internal test build | ⏳ Recommended before public submission, once enrolled |
| Google Play closed test (personal accounts only) | ⏳ See §7 — avoidable by enrolling as an organization |

**Where the signing material lives:** the real Android keystore is at
`~/keystores/fruitcrew/fruitcrew-release.jks` (outside the repo, on purpose —
never commit a signing key). `Frontend/android/keystore.properties` (gitignored)
points `build.gradle` at it; `keystore.properties.example` (committed) shows
the shape for a fresh checkout. **Back up the `.jks` file and the password in
`~/keystores/fruitcrew/keystore.properties.secret` somewhere durable (password
manager, encrypted backup) — losing it is recoverable via Play App Signing's
key-reset support flow, but only if you enrolled in Play App Signing on first
upload, and it's a multi-day process either way.**

---

## 2. Apple App Store Connect

| Field | Value |
|---|---|
| App name | Fruit Crew |
| Subtitle (30 char max) | Staff Scheduling, Simplified *(28 chars)* |
| Primary category | Business |
| Secondary category | Productivity |
| Copyright | © 2026 Vortyx LLC |
| Support URL | `https://fruitcrew.app` *(the homepage lists contact@fruitcrew.app, which is what Apple checks for)* |
| Marketing URL | `https://fruitcrew.app` |
| Privacy Policy URL | `https://fruitcrew.app/privacy` |
| Age rating | Expect 4+, but answer the questionnaire honestly — the in-store chat is a "user-generated content" feature even though it's private to a store's own staff, so don't skip that question |

**Promotional text** (170 char, editable anytime without re-review):
> Build the week's schedule in minutes. Workers set availability, swap shifts, and see what's posted — all from their phone.

**Description** (4000 char max):
> Fruit Crew is staff scheduling built for how a real shift actually runs.
>
> **For managers:** set each store's staffing needs and let the built-in solver draft the week's schedule. Review it, tweak it by hand, and post it when it's ready — workers only ever see the schedule you've actually published.
>
> **For workers:** set your standing weekly availability, or override just one week when something changes. Request time off, and it's factored into the schedule automatically. If your plans change after a shift is posted, drop it, swap it with a coworker, or pick up an open shift from the marketplace — your manager approves the change and you're done.
>
> **Built for real teams, not slide decks:**
> - Standing weekly availability, one-week overrides, and time-off notices
> - Fixed shifts for team members who always work the same days
> - On-call workers who are never auto-scheduled but can pick up open shifts
> - A shift marketplace for swaps, drops, and pickups, with manager approval
> - A group chat for each store, so the whole team's on the same page
> - Shift notes for the handoff: refunds, complaints, lost & found
> - Payroll hours for any pay period, to the minute
> - In-app and email notifications for what actually needs your attention
> - Full schedule history — every posted week is saved and restorable
>
> Runs across multiple stores under one account, with each store's schedule, chat, and staff kept separate.

**Keywords** (100 char max, comma-separated, no spaces after commas):
> `staff scheduling,shift schedule,employee scheduling,shift swap,time off,team chat,restaurant staff`
*(98 chars — fits with 2 to spare.)*

**What's New (v1.0):**
> Initial release.

### App Privacy ("nutrition label") — answers grounded in `Privacy.tsx`

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Contact Info (email, phone, name) | Yes | Yes | No | App Functionality (account, communication) |
| User Content (chat messages, shift notes) | Yes | Yes | No | App Functionality |
| Identifiers (user ID) | Yes | Yes | No | App Functionality |
| Diagnostics (crash data) | Yes | No* | No | App Functionality (bug fixing) |
| Location, Financial Info, Health, Browsing/Search History, Contacts, Photos | No | — | — | — |
| Data used for Advertising or 3rd-party tracking | No | — | — | — |

\* Crash reports are tied to whatever page/action triggered them, not to a specific user identity, per `routes/clientError.ts` — reasonable to mark "not linked."

No ad SDKs, no analytics-for-advertising SDKs, nothing sold or shared with data brokers. Supabase (auth/database) and Resend (transactional email) process data strictly on the app's behalf as service providers, not for their own purposes.

---

## 3. Google Play Console

| Field | Value |
|---|---|
| App name | Fruit Crew |
| Short description (80 char max) | Schedule shifts, swap with coworkers, and chat — all in one app. *(64 chars)* |
| Category | Business |
| Contact email | `contact@fruitcrew.app` |
| Website | `https://fruitcrew.app` |
| Privacy Policy URL | `https://fruitcrew.app/privacy` |

**Full description** (4000 char max) — same copy as the Apple description in §2 works as-is for Play.

### Data safety form — answers grounded in `Privacy.tsx`

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Data types collected | Personal info (name, email, phone), Messages (in-app chat), App activity (crash logs / diagnostics) |
| Is all this data encrypted in transit? | Yes (HTTPS only) |
| Do you provide a way for users to request data deletion? | Yes — in-app account deletion, plus a web request form for anyone who can't log in |
| Is data shared with third parties (Play's definition — parties that use it for their own purposes)? | No — Supabase and Resend act strictly as service providers on the app's behalf, which Play's own definition excludes from "shared." **Double-check this against Play Console's current wording when you fill the form**, since Google periodically tightens what counts. |
| Data collection required or optional | Required (account creation needs email + password, or Google/Apple sign-in) |

---

## 4. Screenshots

Captured from the demo business (§5) in the real app, in English:

- **iOS 6.7" (1290 × 2796):** `store-assets/screenshots/ios67-*.png`
- **Android phone (1080 × 1920, 9:16):** `store-assets/screenshots/android-*.png`

In order: manager Home (what needs attention), the posted Schedule, Requests
(a claimed shift waiting for approval, time off), a worker's My Shifts (next
shift and the week), the shift Marketplace, and Payroll. App Store Connect
scales the 6.7" set down for smaller iPhones. To refresh them after UI changes,
ask me to re-run the capture.

---

## 5. App review access (demo accounts)

Nobody can sign up without an invite code, so reviewers need logins or the
app is rejected under Guideline 2.1 (Apple) / "App access" (Play).

**Create them** (run from `Backend/` with the production env — pick your own
12+ character password and keep it in your password manager):

```
REVIEWER_DEMO_PASSWORD='…' npm run seed:reviewer
```

This makes **Fruit Crew Demo Café** (comped, so never billed or locked out)
with a realistic week: 7 staff, next week's schedule posted, a shift up for
grabs, a claimed shift waiting for approval, a time-off notice, store chat and
a shift note. **Re-run it right before every submission** — it rebuilds the
schedule around the current date and restores the accounts if a reviewer
tried Delete my account. It only ever touches the demo business.

**App Store Connect → App Review Information** (Sign-in required: yes):

- User name: `demo.owner@fruitcrew.app`
- Password: *(the one you chose)*
- Notes:
  > Fruit Crew is staff scheduling for small businesses; accounts are created by invitation from an employer, so there is no public sign-up. Two demo logins share the password above: demo.owner@fruitcrew.app (the owner: Home, Schedule, Team, Requests, Payroll, Settings) and demo.worker@fruitcrew.app (a worker: My Shifts, Market, Availability, Chat). Tap "Work view" as the owner to see the worker side too. Subscriptions are purchased on our website by the business owner; the app does not sell anything.

**Play Console → App content → App access:** "All or some functionality is
restricted", then add both logins with the same notes.

---

## 6. Payments and the app stores

Billing (per-store subscriptions through Stripe) happens **only on the
website**. Both stores require that an app selling digital access uses their
own in-app purchase system *unless* the app sells nothing and doesn't point
people to buy elsewhere (Apple 3.1.1 / 3.1.3(b) "multiplatform services";
Google Play's payments policy). So in the iOS and Android builds:

- no Subscribe / Manage billing / Add a store to your plan buttons
- no prices (the Plan panel says "Free trial" or "2 stores on your plan")
- no "email us to add a store" — the store-limit note just says every store
  on the plan is in use
- a business whose trial has ended sees "Plan changes aren't available in the
  app", with no subscribe prompt

The web app is unchanged. Detection is `isNativeApp()` in `src/lib/pricing.ts`.
**Don't add pricing or "upgrade on our website" wording to the phone apps
later** without re-checking these rules (the US storefront has since relaxed
link-outs; other countries haven't).

**App Privacy / Data safety:** unchanged — purchases happen on the web, not in
the app, so there's no "Purchases" data type to declare for the app itself.

---

## 7. Google Play: testing requirement

A **personal** Play Console account created after November 2023 must run a
closed test with at least 12 testers opted in for 14 days in a row before it
can publish to production. **Organization accounts are exempt.** Since the app
belongs to Vortyx LLC, enroll Play Console (and the Apple Developer Program)
**as an organization** — both need a free D-U-N-S number for the LLC, which
takes a few days to issue, so request it first.

---

## 8. Chat and user content (Apple 1.2)

Store chat and shift notes are user-generated content, but private to one
employer's staff. Terms.tsx has an acceptable-use clause, owners can remove
anyone from their business, and the operator can pause or delete a business —
the same posture closed workplace chat apps are approved with. If a reviewer
asks for a report/block feature, that's the answer; it's low risk.

---

## 9. Open items before you can actually submit

1. Enroll Apple Developer Program and Play Console **as Vortyx LLC** (D-U-N-S first) — everything else here is ready to paste in once they clear.
2. Run `npm run seed:reviewer` against production and put the password in App Store Connect / Play Console (§5).
3. TestFlight build for a quick check on a real iPhone before submitting.
