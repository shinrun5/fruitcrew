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
| Screenshots for required device sizes | ⏳ Not yet captured — see §4 |
| TestFlight internal test build | ⏳ Recommended before public submission, once enrolled |

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
| Support URL | `https://fruitcrew.app` *(no dedicated `/support` page exists yet — see note below)* |
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

Not captured yet — need a running build with realistic (not obviously fake)
sample data. Required sizes:

- **iOS:** 6.7" (iPhone 15/16 Pro Max class) and 6.5" or 5.5" as a fallback set — App Store Connect will tell you exactly which are mandatory based on what you upload first.
- **Android:** phone screenshots (min 2, up to 8), 16:9 or 9:16.

Once you're ready, I can help capture these from the iOS Simulator / an Android emulator running the actual app — just ask when you want to do that pass.

---

## 5. Open items before you can actually submit

1. **Support URL** — there's no dedicated `/support` page; using the marketing homepage as a stopgap. Say the word and I'll add a minimal `/support` route (mirrors the existing `/privacy` and `/terms` pages) with the contact email and a short FAQ.
2. **Screenshots** (§4).
3. Apple Developer Program + Play Console accounts need to actually clear before the app records can be created — everything else here is ready to paste in the moment they do.
