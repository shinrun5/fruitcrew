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
| Sign-in inside the phone apps | ✅ Email + password only. Google refuses its sign-in inside app web views, and Apple 4.8 requires Sign in with Apple wherever Google is offered — so both are web-only until native sign-in is added (see §10) |
| iPhone only (no iPad), portrait, `arm64`, languages en / zh-Hans / es declared | ✅ Done — no iPad screenshots or iPad review needed for v1 |
| Privacy manifest declares the data actually collected (name, email, phone, user ID, user content, crash data; no tracking) | ✅ Done — matches the App Privacy answers below |
| Android: `allowBackup` off (no cloud copy of the signed-in session); only the INTERNET permission | ✅ Done |
| Android 15+ edge-to-edge: nothing under the status bar | ✅ Fixed — checked on an Android 17 emulator |
| Builds really run | ✅ iOS simulator build launches; Android debug APK installs and launches; both reach fruitcrew.app (CORS for `capacitor://localhost` and `https://localhost` confirmed) |
| Report button for chat messages and DMs (Apple 1.2) | ✅ Done — see §8 |
| Terms and Privacy cover billing (Stripe), the trial, cancelling, calendar links and automatic data cleanup | ✅ Updated October 1, 2026 |
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
| Age rating | Answer the questionnaire honestly: **yes** to user-generated content and to messaging/chat (store chat and DMs between coworkers). Expect a teen rating, not 4+ — that's normal for any app with chat |

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

Store chat, DMs and shift notes are user-generated content, private to one
employer's staff. What Apple asks for, and where it is:

- **Report:** a ⚑ next to anyone else's chat message or DM. A report emails
  the message to contact@fruitcrew.app (set `REPORT_EMAIL` to change) and
  notifies the business's managers (for DMs, only that a report was made).
- **Act on it / block:** an owner can remove anyone from the business; the
  operator can pause or delete a business from Admin.
- **Rules:** Terms §4 (acceptable use) — harassment means suspension.
- **Contact:** contact@fruitcrew.app on the site, in Terms and Privacy.

---

## 9. Open items before you can actually submit (yours)

1. **Apple:** enroll as an **Organization** (Vortyx LLC — needs a free D-U-N-S number first), add the account in Xcode → Settings → Accounts, then pick the team under the App target → Signing & Capabilities.
2. **App Store Connect:** create the app (iOS, "Fruit Crew", `com.fruitcrew.app`, SKU `fruitcrew-ios`), paste §2's text, upload the §4 screenshots, answer App Privacy as in §2 and the age-rating questions as above.
3. **Google Play:** enroll Play Console as an organization too, create the app, fill Data safety (§3), App access (§5), Ads (none), and Target audience (**16–17 and 18+** — student crews; never select under 13).
4. **Demo accounts in production:** run `npm run seed:reviewer` against production with your chosen password (§5) right before submitting, and paste the logins into both stores.
5. **Upload a build:** archive in Xcode (Product → Archive → Distribute) — or create an App Store Connect API key so it can be done for you — then TestFlight it on your own iPhone before submitting.

---

## 10. Later (not needed for v1)

- **Sign in with Google / Apple inside the phone apps** needs native sign-in
  plugins (Google blocks web-view sign-in), plus Sign in with Apple set up in
  the developer account. Add both together — Apple requires Apple's whenever
  Google's is offered.
- **iPad:** set `TARGETED_DEVICE_FAMILY` back to `1,2` and add 13" iPad
  screenshots.
- **Push notifications:** APNs key (Apple) and Firebase project (Android).
