import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import changeRequestRoutes from './routes/changeRequests.js';
import timeOffRoutes from './routes/timeOff.js';
import employeeRoutes from './routes/employees.js';
import managerRoutes from './routes/managers.js';
import overviewRoutes from './routes/overview.js';
import storeRoutes from './routes/stores.js';
import shiftRoutes from './routes/shifts.js';
import shiftRequirementRoutes from './routes/shiftRequirements.js';
import employeeStoreRoutes from './routes/employeeStores.js';
import availabilityRoutes from './routes/availability.js';
import scheduleRoutes from './routes/schedule.js';
import notificationRoutes from './routes/notifications.js';
import fixedShiftRoutes from './routes/fixedShifts.js';
import chatRoutes from './routes/chat.js';
import noteRoutes from './routes/notes.js';
import closingDutyRoutes from './routes/closingDuties.js';
import adminRoutes from './routes/admin.js';
import clientErrorRoutes from './routes/clientError.js';
import signupRequestRoutes from './routes/signupRequests.js';
import accountDeletionRequestRoutes from './routes/accountDeletionRequests.js';
import { startCron } from './cron.js';
import { alertError } from './lib/errorAlert.js';

// Crashes/rejections that happen outside any request (a bad background job, a
// truly unhandled promise somewhere) would otherwise be invisible until the
// process dies and Railway silently restarts it.
process.on('uncaughtException', (err) => alertError('uncaughtException', err));
process.on('unhandledRejection', (err) => alertError('unhandledRejection', err));

// Fail fast on boot instead of a confusing 500 on whichever request first
// touches the missing var (see lib/supabase.ts's own `need()` for the same
// idea, scoped to just those two clients).
const REQUIRED_ENV = ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  console.error(`Missing required env var${missingEnv.length > 1 ? 's' : ''}: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Railway (and any PaaS) sits behind one reverse proxy — trust exactly that hop
// so req.ip / rate-limiting see the real client, not the proxy.
app.set('trust proxy', 1);

// security headers, including a tailored CSP: the SPA's build has no inline
// scripts (Vite emits hashed external files) and calls only same-origin /api,
// so script-src/connect-src stay locked to 'self' — plus Google Identity
// Services (the Google sign-in button on /login), which needs its script,
// its iframe-rendered button/prompt UI, its own network calls, and its
// button-icon assets (served from gstatic.com, not accounts.google.com —
// the "black circle, no G logo" bug was this img-src gap) — and Apple's
// "Sign in with Apple JS" (our own button, their script + popup). style-src
// needs 'unsafe-inline' for three runtime-computed style={{}} usages
// (popover positioning, a data-driven grid) plus the static landing page's
// inline <style> block — none are hash/nonce-friendly since two change every
// render.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client', 'https://appleid.cdn-apple.com'],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'https://accounts.google.com', 'https://www.gstatic.com'],
        connectSrc: ["'self'", 'https://accounts.google.com', 'https://appleid.apple.com'],
        frameSrc: ['https://accounts.google.com', 'https://appleid.apple.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // helmet's default (same-origin) severs window.opener communication with
    // a sign-in popup once the user grants consent there — the popup can no
    // longer hand the result back to this page (the "accept, then the screen
    // just turns white" symptom, first hit with Google, same risk for Apple's
    // popup). *-allow-popups keeps the isolation for everything else, just
    // not against a popup we ourselves opened.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  }),
);

// helmet 8 has no Permissions-Policy middleware of its own. The app uses none
// of these browser features except clipboard-write (copy invite link buttons).
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), ' +
      'magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), ' +
      'fullscreen=(self), clipboard-write=(self)',
  );
  next();
});

app.use(express.json({ limit: '100kb' }));

// everything the frontend calls lives under /api so it never collides with a
// client-side route (the Vite dev proxy forwards /api and nothing else)
const api = Router();

// The web app is same-origin (no CORS needed there), but the Capacitor native
// shells load their bundle from a fixed local scheme and call this API
// cross-origin — https://localhost on Android, capacitor://localhost on iOS
// (see Frontend/capacitor.config.ts). Auth is a Bearer token in JS, not a
// cookie, so no Access-Control-Allow-Credentials is needed here.
const NATIVE_APP_ORIGINS = new Set(['capacitor://localhost', 'https://localhost']);
api.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && NATIVE_APP_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// blanket ceiling so a runaway client (or crude abuse) can't hammer the API
api.use(
  rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }),
);
// brute-force guard for auth: only FAILED attempts count, so a normal user who
// logs in fine is never throttled
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 50,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

api.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));
api.use('/auth', authLimiter, authRoutes);
api.use('/employees', employeeRoutes);
api.use('/stores', storeRoutes);
api.use('/shifts', shiftRoutes);
api.use('/shiftrequirements', shiftRequirementRoutes);
api.use('/employeeStores', employeeStoreRoutes);
api.use('/availability', availabilityRoutes);
api.use('/schedule', scheduleRoutes);
api.use('/change-requests', changeRequestRoutes);
api.use('/time-off', timeOffRoutes);
api.use('/managers', managerRoutes);
api.use('/overview', overviewRoutes);
api.use('/notifications', notificationRoutes);
api.use('/fixed-shifts', fixedShiftRoutes);
api.use('/chat', chatRoutes);
api.use('/notes', noteRoutes);
api.use('/closing-duties', closingDutyRoutes);
api.use('/admin', adminRoutes);
// public (can happen before login); its own tight limit since it takes free-text
api.use('/client-error', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), clientErrorRoutes);
// public; a handful of legitimate submissions per hour is plenty — everything
// past this still needs a superadmin's manual approval, so a flooded queue is
// the worst case, not an account
api.use(
  '/signup-requests',
  rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }),
  signupRequestRoutes,
);
api.use(
  '/account-deletion-requests',
  rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }),
  accountDeletionRequestRoutes,
);
app.use('/api', api);

// In production the built frontend is served from this same origin (the app
// calls /api with no host, see Frontend/src/lib/api.ts). In dev the Vite server
// serves the SPA and proxies /api here, so this block is simply skipped.
const distDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  process.env.FRONTEND_DIST ?? '../../Frontend/dist',
);
if (existsSync(distDir)) {
  const indexHtml = join(distDir, 'index.html');
  const landingHtml = join(distDir, 'landing.html');

  // A fresh visit to the root shows the public landing page (crawlable, no JS).
  // The SPA still owns "/" internally — a logged-in user routing there client-side
  // is bounced to their dashboard.
  if (existsSync(landingHtml)) {
    app.get('/', (_req: Request, res: Response) => res.sendFile(landingHtml));
  }

  app.use(express.static(distDir));
  // SPA fallback: any non-/api GET that didn't match a file returns index.html
  // so client-side routes (/schedule, /my-shifts, …) work on a hard refresh.
  app.get(/^\/(?!api\/).*/, (_req: Request, res: Response) => {
    res.sendFile(indexHtml);
  });
  console.log('Serving frontend from', distDir);
} else {
  console.log('No frontend build at', distDir, '— API only (expected in dev)');
}

// last-resort JSON error handler so API clients never get an HTML error page.
// The real message/stack goes to the alert email only — an uncaught error here
// is by definition one no route anticipated, so its text is as likely to be a
// raw Prisma/driver message as anything meant for an end user.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  alertError('http', err, { method: req.method, path: req.path });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log('Server listening on port', PORT);
  console.log(
    process.env.RESEND_API_KEY
      ? `[email] Resend key set · from "${process.env.EMAIL_FROM || 'Fruit Crew <onboarding@resend.dev>'}"`
      : '[email] no RESEND_API_KEY — emails are logged and skipped',
  );
  console.log(
    process.env.APP_URL
      ? `[email] links point at ${process.env.APP_URL}`
      : '[email] no APP_URL set — email buttons/links are omitted',
  );
  startCron();
});
