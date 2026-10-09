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
| Android: `allowBackup` off (no cloud copy of the signed-in session); only the INTERNET and POST_NOTIFICATIONS permissions | ✅ Done |
| Push notifications (code, entitlement, Android icon/channel, server sending) | ✅ Built — needs your keys, see §11 |
| fruitcrew.app links open in the app (invites, email links) | ✅ Built — needs your Team ID / cert fingerprint, see §11 |
| Android 15+ edge-to-edge: nothing under the status bar | ✅ Fixed — checked on an Android 17 emulator |
| Builds really run | ✅ iOS simulator build launches; Android debug APK installs and launches; both reach fruitcrew.app (CORS for `capacitor://localhost` and `https://localhost` confirmed) |
| Report and block in chat and DMs (Apple 1.2) | ✅ Done — see §8 |
| Terms and Privacy cover billing (Stripe), the trial, cancelling, calendar links and automatic data cleanup | ✅ Updated October 1, 2026 |
| iOS Distribution Certificate + Provisioning Profile | ⏸ Blocked — needs Apple Developer Program enrollment |
| App Store Connect app record created | ⏸ Blocked — needs enrollment |
| Play Console app record created | ⏸ Blocked — needs Play Console developer account approval |
| Screenshots for required device sizes | ✅ Captured from the demo business — `store-assets/screenshots/` (see §4) |
| Demo accounts for app reviewers | ✅ Script ready — `npm run seed:reviewer`; run it against production before submitting (see §5) |
| No purchase buttons, prices or "buy elsewhere" text inside the phone apps | ✅ Done — see §6 |
| In-app account deletion, with a confirmation popup, for every account | ✅ Done — worker: More → Profile; owner/manager: More → Your account; also on the waiting-for-approval and paused screens. The only owner deleting closes the business and cancels its subscription |
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

**Description** (4000 char max) — plain text; App Store Connect shows `**` and `#` literally, so copy it from the box below:
```
Fruit Crew is staff scheduling built for how a real shift actually runs.

FOR MANAGERS
Set each store's staffing needs and let the built-in solver draft the week's schedule. Review it, tweak it by hand, and post it when it's ready. Workers only ever see the schedule you've actually posted.

FOR WORKERS
Set your standing weekly availability, or override just one week when something changes. Request time off, and it's factored into the schedule automatically. If your plans change after a shift is posted, drop it, swap it with a coworker, or pick up an open shift from the marketplace. Your manager approves the change and you're done.

ON YOUR IPHONE
• Notifications when the schedule is posted, a shift opens up, or a coworker messages you
• Managers get notified when a shift change needs their approval
• A reminder an hour before each shift starts
• A home screen and lock screen widget with your next shift
• Sign in with Apple, or with your email and password

BUILT FOR REAL TEAMS
• Standing weekly availability, one-week overrides, and time-off requests
• Fixed shifts for team members who always work the same days
• On-call workers who are never auto-scheduled but can pick up open shifts
• A shift marketplace for swaps, drops, and pickups, with manager approval
• A group chat for each store, so the whole team's on the same page
• Shift notes for the handoff: refunds, complaints, lost & found
• Payroll hours for any pay period, to the minute
• Full schedule history: every posted week is saved and restorable

Runs across multiple stores under one account, with each store's schedule, chat, and staff kept separate.
```

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

**Full description** (4000 char max) — not the Apple copy: Play rejects listings that mention
other platforms (iPhone, Sign in with Apple), and the Android app has no widget or phone
notifications yet (see Firebase in §11). Plain text:
```
Fruit Crew is staff scheduling built for how a real shift actually runs.

FOR MANAGERS
Set each store's staffing needs and let the built-in solver draft the week's schedule. Review it, tweak it by hand, and post it when it's ready. Workers only ever see the schedule you've actually posted.

FOR WORKERS
Set your standing weekly availability, or override just one week when something changes. Request time off, and it's factored into the schedule automatically. If your plans change after a shift is posted, drop it, swap it with a coworker, or pick up an open shift from the marketplace. Your manager approves the change and you're done.

BUILT FOR REAL TEAMS
• Standing weekly availability, one-week overrides, and time-off requests
• Fixed shifts for team members who always work the same days
• On-call workers who are never auto-scheduled but can pick up open shifts
• A shift marketplace for swaps, drops, and pickups, with manager approval
• A group chat for each store, so the whole team's on the same page
• Shift notes for the handoff: refunds, complaints, lost & found
• Payroll hours for any pay period, to the minute
• In-app and email notifications for what actually needs your attention
• Full schedule history: every posted week is saved and restorable

Runs across multiple stores under one account, with each store's schedule, chat, and staff kept separate.
```

**Graphics:** app icon `store-assets/play/icon-512.png` (512 × 512), feature graphic
`store-assets/play/feature-graphic.png` (1024 × 500, from `store-assets/feature.html`),
phone screenshots `store-assets/screenshots/android-0-cover.png` then `android-1` … `android-6`.

### Data safety form — answers grounded in `Privacy.tsx`

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Data types collected | Personal info (name, email, phone), Messages (in-app chat), App activity (crash logs / diagnostics), Device or other IDs (the push notification token — check Firebase's current Data safety guidance for Cloud Messaging when you fill this in) |
| Is all this data encrypted in transit? | Yes (HTTPS only) |
| Do you provide a way for users to request data deletion? | Yes — in-app account deletion, plus a web request form for anyone who can't log in |
| Is data shared with third parties (Play's definition — parties that use it for their own purposes)? | No — Supabase and Resend act strictly as service providers on the app's behalf, which Play's own definition excludes from "shared." **Double-check this against Play Console's current wording when you fill the form**, since Google periodically tightens what counts. |
| Data collection required or optional | Required (account creation needs email + password, or Google/Apple sign-in) |

---

## 4. Screenshots

Captured from the demo business (§5) in the real app, in English:

- **iOS 6.9" (1320 × 2868):** `store-assets/screenshots/ios69-*.png` — upload these to the iPhone 6.9" Display slot
- **iOS 6.3" (1206 × 2622):** `store-assets/screenshots/ios63-*.png` — for the iPhone 6.1"/6.3" slot
- **iOS 6.7" (1290 × 2796):** `store-assets/screenshots/ios67-*.png`
- **Android phone (1080 × 1920, 9:16):** `store-assets/screenshots/android-*.png`

Upload the cover first (`*-0-cover.png`): a designed image in the landing page's
style (headline, the app in a tilted phone, stickers), made from
`store-assets/cover.html` — render it at 440 × 956 with 3× scale for 1320 × 2868.
Then the app screens, in order: manager Home (what needs attention), the posted Schedule, Requests
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
- Notes: the reply text in §12 (Apple asked for it to be kept in Notes for future submissions)

**Play Console → App content → App access:** "All or some functionality is
restricted", then add both logins with the same notes.

---

## 6. Payments and the app stores

Billing (per-store subscriptions through Stripe) happens **only on the
website**. Both stores require that an app selling digital access uses their
own in-app purchase system *unless* the app sells nothing and doesn't point
people to buy elsewhere (Apple 3.1.1, with 3.1.3(c) "enterprise services"
covering subscriptions a business buys for its staff; Google Play's payments
policy). So in the iOS and Android builds:

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

- **Filter:** offensive words are starred out when a message, DM or shift
  note is posted (`Backend/src/lib/contentFilter.ts` — a short English /
  Spanish / Chinese list, chosen so ordinary café words never get caught).
- **Report:** a ⚑ next to anyone else's chat message or DM, and Report on
  anyone else's shift note. A report emails the content to
  contact@fruitcrew.app (set `REPORT_EMAIL` to change) and notifies the
  business's managers (for DMs, only that a report was made).
- **Block:** after a report the app offers to block the writer, and a DM has
  Block at the top. The blocker stops seeing that person's store-chat
  messages and DMs straight away and gets no notifications from them; the
  blocked person can't DM them and isn't told. Unblock from the DM, or find
  them under Chat → + New (marked Blocked). Each block emails
  contact@fruitcrew.app. Stored in `UserBlock`.
- **Act on it:** managers/owners can remove any message in their store's
  chat (× next to it) and any shift note; an owner can remove anyone from
  the business; the operator can pause or delete a business from Admin.
- **Rules:** Terms §4 — zero tolerance for objectionable content and abusive
  users, and reports are acted on **within 24 hours**. That's a promise to
  Apple and to users: check contact@fruitcrew.app daily.
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

- **Sign in with Google inside the phone apps** needs a native sign-in plugin
  (Google blocks web-view sign-in), e.g. Android's Credential Manager, plus an
  Android OAuth client in Google Cloud (package `com.fruitcrew.app` + the
  upload and Play app-signing SHA-1s). Sign in with Apple is already in the
  iPhone app, which Apple requires whenever Google's is offered. Until then,
  Google-only accounts use "Forgot password?" to set a password for the apps.
- **iPad:** set `TARGETED_DEVICE_FAMILY` back to `1,2` and add 13" iPad
  screenshots.
- **Push notifications / app links:** built — see §11 for the setup left.

---

## 11. Push notifications and app links — what's left once you're approved

All the code is in place and both apps build. Every in-app notification (the
bell) is also pushed to the person's phone; tapping it opens that screen. Until
the keys below exist, the server just logs "would send" and skips, and the apps
work exactly as before. Nothing needs changing in code — only these settings.

**iPhone push (Apple)**

1. developer.apple.com → Certificates, IDs & Profiles → **Keys** → `+` → name it
   "Fruit Crew push", tick **Apple Push Notifications service (APNs)** → Continue →
   Register → **Download** the `.p8` (you can only download it once — keep it in
   your password manager). Note the **Key ID** shown, and your **Team ID** (top right).
2. Identifiers → `com.fruitcrew.app` → make sure **Push Notifications** and
   **Associated Domains** are ticked (Xcode's automatic signing usually does this
   the first time you build with the team selected).
3. On Railway, API service → Variables:
   - `APNS_KEY` = the `.p8` file's contents (or base64 of it)
   - `APNS_KEY_ID` = the Key ID
   - `APNS_TEAM_ID` = the Team ID (also used for app links below)

**Android push (Firebase)**

1. console.firebase.google.com → Add project "Fruit Crew" (Analytics off is fine).
2. Add app → Android → package name `com.fruitcrew.app` → download
   `google-services.json` → put it at `Frontend/android/app/google-services.json`.
3. In `Frontend/.env.capacitor` set `VITE_FIREBASE_ENABLED=1` (without the json
   file this must stay 0 — the Android app crashes registering for push otherwise).
4. Project settings → Service accounts → **Generate new private key** → on Railway
   set `FCM_SERVICE_ACCOUNT` = that JSON file's contents (or base64 of it).
5. Rebuild: `npm run build:capacitor`, then build/upload as usual.

**Links that open the app (invites, links in emails)**

- iOS: works once `APNS_TEAM_ID` (or `APPLE_TEAM_ID`) is set — the server then
  serves `https://fruitcrew.app/.well-known/apple-app-site-association`.
- Android: after your first upload, Play Console → **Test and release → App
  integrity → App signing** → copy the **SHA-256 certificate fingerprint** of the
  app signing key (and the upload key's, if you sideload builds) → on Railway set
  `ANDROID_CERT_SHA256` = them, comma-separated. The server then serves
  `/.well-known/assetlinks.json`.
- Which screens open in the app is listed in `Backend/src/lib/appLinks.ts`
  (the Android manifest has the same list).

**Check it worked:** sign in on the phone app, allow notifications, then have
someone post a shift to the marketplace (or post a schedule) — the phone should
buzz. Railway's logs show `[push.send]` errors if a key is wrong.

**Still not built:** native Google / Apple sign-in in the phone apps (§10) —
email + password works in the apps today.

---

## 12. App Review: Guideline 2.1 information request (October 2026)

Build 1.0 (2) came back on October 8, 2026 as "Guideline 2.1 – Information
Needed": Apple wants a screen recording plus six answers, both in a reply and
in the Notes field. Build 1.0 (4) closes the gaps a reviewer would otherwise
reject next:

- **1.2 user content:** blocking, an offensive-word filter, Report on shift
  notes, managers removing any store-chat message, and Terms §4 (zero
  tolerance, 24-hour action on reports). See §8.
- **5.1.1(v) account deletion:** the only owner of a business couldn't
  delete their account ("email support"), and the reviewer's demo login is
  exactly that owner. Now it closes the business instead. Accounts waiting
  for approval, or in a paused business, can delete too.

**In this order:**

1. Deploy the backend (it runs the `user_blocks` migration), then run
   `npm run seed:reviewer` against production. The seed also adds a DM from
   the owner to the worker, clears blocks between them, and reopens the demo
   business if a reviewer deleted the owner.
2. Check iPhone push actually works in production (`APNS_KEY`, `APNS_KEY_ID`,
   `APNS_TEAM_ID` on Railway, §11). The App Store description promises
   notifications and a pre-shift reminder.
3. `npm run build:capacitor`, archive in Xcode (build 4 for the app and the
   widget), upload, and install it from TestFlight on your iPhone. Update the
   iPhone to the latest iOS first, as Apple asks.
4. Record (script below), then run `npm run seed:reviewer` again so the demo
   business is fresh.
5. In App Store Connect:
   - Select build 4 on the 1.0 version.
   - Sign-In Information: `demo.owner@fruitcrew.app` and the password.
   - Fill in `[PASSWORD]`, `[MODEL]` and `[VERSION]` below, then paste the
     text into App Review Information → Notes. It's about 3,800 characters
     once filled in; the limit is 4,000.
   - Reply to Apple's message with the same text, video attached.
   - **Resubmit to App Review.**

**Recording script** (Control Center → Screen Recording; Do Not Disturb on;
about 5 minutes; record on a real iPhone, not the simulator):

1. Start on the Home Screen and tap Fruit Crew, so the launch is visible.
2. Log in as `demo.owner@fruitcrew.app`. Show Home, Schedule (the posted
   week), Requests (approve the claimed shift), More → Payroll, and
   More → Settings → Plan ("Plan changes aren't available in the app").
3. Team → a person marked "hasn't signed up yet" → copy their invite code.
   Log out.
4. **Registration:** "Got an invite code? Set up your account" → paste the
   code, fill in name, an email you control and a password → create. The
   waiting-for-approval screen appears. Log out.
5. Log in as the owner → Team → Approve the new sign-up. Log out.
6. Log in as `demo.worker@fruitcrew.app`. Show Shifts, Market, Availability.
7. **Filter, report and block:**
   - Open Chat → Main Street and send a message with a swear word in it. It
     posts starred out.
   - Go back, open the DM from Morgan Reyes, tap ⚑ → Report → "Block Morgan
     Reyes too?" → Block. The banner says they're blocked.
   - Go back: the DM is gone from the list, and Morgan's message is gone
     from the store chat.
   - Chat → + New → Morgan Reyes (marked Blocked) → Unblock.
   - More → Notes → Report on Morgan's refund note.
   - Log out.
8. **Account deletion:** log in as the account made in step 4 → More →
   Profile → Delete my account → enter the password → confirm. It returns to
   the login screen. Stop recording.

**Reply and Notes text:**

```
Hello,

Thank you for reviewing Fruit Crew. The information you asked for is below. We also uploaded build 1.0 (4) and selected it for this version. It adds blocking users, an automatic filter for offensive words, reporting of shift notes, and account deletion for a business's only owner.

1. SCREEN RECORDING
Attached, recorded on an iPhone [MODEL] running iOS [VERSION]. It starts at launch and shows logging in, the manager's main screens, creating an account with an employer's invite code, a worker's main screens, reporting a message and blocking its sender, unblocking, and deleting an account. The app has no paid content and no purchases.

2. PURPOSE AND AUDIENCE
Fruit Crew is staff scheduling for small shift-based businesses such as cafés, restaurants and shops. A manager sets how many people each shift needs, the app drafts the week's schedule from staff availability and time off, and the manager reviews and posts it. Workers see their shifts, set availability, request time off, and swap, drop or pick up shifts with manager approval. Each store has a team chat. It replaces paper schedules, spreadsheets and group texts.
Audience: owners and managers of these businesses, and their employees. Employees never pay.

3. ACCESS
Staff accounts are created with an invite code from their employer. Please use these demo accounts:
- Owner: demo.owner@fruitcrew.app / [PASSWORD]
- Worker: demo.worker@fruitcrew.app / [PASSWORD]
Both are in the sample business "Fruit Crew Demo Café", which has a posted schedule, an open shift, a shift waiting for approval, store chat, shift notes and a direct message.
Sign-up: as the owner, open Team, tap someone marked "hasn't signed up yet" and copy their invite code. Log out, tap "Got an invite code? Set up your account", and create the account. Approve it as the owner under Team. Any business can ask for its own account from "New business? Request access" on the login screen.
Account deletion: worker, More > Profile > Delete my account. Owner, More > Your account > Delete my account (as the only owner, this also closes the sample business).
Sign in with Apple is on the login screen. An Apple ID with no Fruit Crew account is asked for an invite code, so please use the demo accounts.
On iPhone: push notifications, a Home Screen and Lock Screen widget, Sign in with Apple and haptics.

USER CONTENT (1.2)
Chat, direct messages and shift notes are visible only to coworkers at the same business. Offensive words are masked automatically. Tap the flag next to a message, or Report on a note, to report it; after reporting a message you are offered Block. A direct message also has Block at the top. Blocking hides that person's messages immediately and stops them messaging you; unblock from the same place or from Chat > + New. Reports and blocks are emailed to us, and managers can remove any message or note in their store. The Terms forbid objectionable content and abusive users; we act on reports within 24 hours. Contact: contact@fruitcrew.app.

4. EXTERNAL SERVICES
- Supabase: sign-in and database
- Railway: hosts our server and scheduling engine (Google's open-source OR-Tools library on our own server)
- Resend: email
- Apple Push Notification service: notifications
- Sign in with Apple: optional sign-in
- Stripe: business subscriptions, on our website only
No AI services, ads, analytics SDKs or tracking.

5. REGIONS
The app works the same in all regions. It is in English, Simplified Chinese or Spanish, following the device language.

6. REGULATED INDUSTRY
Not applicable. Payroll only totals hours worked; it does not calculate pay or move money.

PURCHASES
The app has no purchases, prices or links to buy. Businesses subscribe on our website for their staff (Guideline 3.1.3(c)); employees never pay.
```
