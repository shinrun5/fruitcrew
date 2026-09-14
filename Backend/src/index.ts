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
import { startCron } from './cron.js';
import { alertError } from './lib/errorAlert.js';

// Crashes/rejections that happen outside any request (a bad background job, a
// truly unhandled promise somewhere) would otherwise be invisible until the
// process dies and Railway silently restarts it.
process.on('uncaughtException', (err) => alertError('uncaughtException', err));
process.on('unhandledRejection', (err) => alertError('unhandledRejection', err));

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Railway (and any PaaS) sits behind one reverse proxy — trust exactly that hop
// so req.ip / rate-limiting see the real client, not the proxy.
app.set('trust proxy', 1);

// security headers. CSP is left off for now: the SPA pulls Google Fonts and the
// landing page uses an inline <style>, so a default policy would break them —
// worth adding a tailored policy later.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.json({ limit: '100kb' }));

// everything the frontend calls lives under /api so it never collides with a
// client-side route (the Vite dev proxy forwards /api and nothing else)
const api = Router();

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

// last-resort JSON error handler so API clients never get an HTML error page
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  alertError('http', err, { method: req.method, path: req.path });
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
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
