# Fruit Crew — WeChat Mini Program prototype

A small, functional prototype proving Fruit Crew can run natively inside
WeChat — no separate app, no leaving the chat your crew already uses. It
talks to the **real production backend**, using the exact same REST
endpoints the web app already calls (`/auth/login`, `/shifts/mine`,
`/change-requests/marketplace`, `/auth/profile`, `/time-off`).

## What's actually in here

- **Login** — plain email/password against your existing `/auth/login`.
- **My Shifts** — this week's posted schedule, with a fruit-emoji avatar per
  person (a plain-emoji stand-in for the real hand-illustrated avatars —
  see the note in `utils/fruit.js`).
- **Marketplace** — open shifts up for grabs, with a real "Claim" button
  that calls the actual backend and updates state. This is the part worth
  demoing: a genuine two-way action happening natively inside WeChat, not
  just a read-only view of the app.
- **Time Off** — see existing requests and post a new one, hitting the real
  `/time-off` endpoints (same minimum-week, one-week's-notice validation
  the web app enforces).
- **Profile** — who's logged in, which store(s) they work, and a working
  **Log out** button.

Colors match the real brand palette (`Frontend/src/index.css`'s
`--color-*` tokens), not guessed values.

## What this is *not* (be upfront about this with investors)

- **Not published, not publicly reachable.** WeChat requires an ICP filing
  tied to a Chinese legal entity to publish a Mini Program — you don't have
  that yet, and this prototype doesn't need it, because it only runs in
  WeChat's own Developer Tools / your own device preview during development.
  Nobody can find or open this by searching WeChat or scanning a public code.
- **No WeChat-native login.** A real version would use `wx.login()` to get
  a WeChat `openid` and link it to a Fruit Crew account. This prototype
  skips that and just reuses plain email/password, stored in Mini Program
  local storage with no refresh — good enough to demo, not to ship.
- **This proves the concept works, not that customers are using it.** It's
  evidence you can execute on WeChat-native distribution, not a customer
  base. Worth being precise about that distinction out loud.

## Setup to preview it

1. **Download WeChat DevTools** (微信开发者工具) — Tencent's official IDE,
   free, available for Mac/Windows: https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
2. **Get an individual Mini Program developer account** (just needs an ID/passport,
   no business entity) if you don't have one — this only gates *previewing on
   your own phone*, not opening the project in DevTools itself, which works
   with the placeholder `appid` already set in `project.config.json`.
3. **Point it at your real backend**: open `utils/api.js` and replace
   `BASE_URL` with your actual deployed API URL (e.g.
   `https://your-app.up.railway.app/api`).
4. **Open the project**: in WeChat DevTools, "Import Project" → select this
   `MiniProgram/` folder. `project.config.json`'s `appid` is already set to
   a real WeChat test-account AppID — a placeholder value of `"touristappid"`
   also works if you ever need to open it with no account at all.
5. **Log in with a real worker account** — not a bare owner/manager login.
   `/shifts/mine` and the marketplace endpoints require the account to be
   linked to an employee record (`employeeId` set), same requirement the
   web app has.
6. To preview on your own phone instead of just the simulator: click
   "Preview" in DevTools, scan the QR code with WeChat. This needs the
   individual developer account from step 2, but still doesn't require
   publishing anything.

## Natural next steps, if this validates

- Real WeChat login (`wx.login()` → openid → linked to a Fruit Crew account),
  which needs a backend change (a new `wechatOpenId` column + auth route).
- A refresh-token flow so sessions don't just die.
- Actually publishing it — which is the point where the ICP filing / Chinese
  entity requirement stops being deferrable.
