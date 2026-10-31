import { Router, type Request, type Response } from 'express';
import rateLimit, { type RateLimitInfo } from 'express-rate-limit';
import prisma from '../lib/prisma.js';
import { canManageStore, requireManager } from '../lib/auth.js';
import { isRunningWeek, mondayUTC } from '../lib/scheduleGen.js';
import { parseYMD } from '../lib/time.js';
import { allowance, apply, ask, AssistantError, AssistantPaused, assistantReady, OverAllowance, StaleProposal, type Turn } from '../lib/scheduleAssistant.js';

// The schedule assistant on the board (lib/scheduleAssistant.ts): a manager
// asks in plain words, gets checked changes back, and applies them.
const router = Router();
router.use(...requireManager);

const LANGUAGES: Record<string, string> = { en: 'English', zh: 'Simplified Chinese', es: 'Spanish' };

/** The store this is about — one the caller manages — and its business. */
async function storeFor(req: Request, res: Response): Promise<{ storeId: number; orgId: number } | null> {
  const storeId = Number(req.query.storeId ?? req.body?.storeId);
  if (!Number.isInteger(storeId) || !canManageStore(req.user, storeId)) {
    res.status(403).json({ error: 'You do not manage that store' });
    return null;
  }
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { orgId: true } });
  if (!store) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return { storeId, orgId: store.orgId };
}

// GET /schedule-assistant?storeId= — switched on here? and this month's allowance
router.get('/', async (req, res) => {
  const s = await storeFor(req, res);
  if (!s) return;
  res.json({ ready: assistantReady(), ...(await allowance(s.orgId)) });
});

// Per manager, on top of the business's monthly allowance: a few a minute
// (a conversation is slower than that) and 30 an hour. retryAfter is seconds.
const perUser = (name: string, windowMs: number, limit: number) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `asst-${name}:${req.user?.id}`,
    handler: (req, res, _next, options) => {
      const info = (req as unknown as Record<string, RateLimitInfo | undefined>)[options.requestPropertyName];
      const reset = info?.resetTime?.getTime() ?? Date.now() + windowMs;
      res.status(429).json({
        error: 'That’s a lot of messages — try again in a little while.',
        code: 'rate',
        retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
      });
    },
  });
const askLimits = [perUser('min', 60_000, 5), perUser('hour', 60 * 60_000, 30)];

// one question at a time per manager, so a second tab or a double tap can't spend twice
const asking = new Set<number>();

// POST /schedule-assistant/ask { storeId, weekStart: "YYYY-MM-DD", message, history?, language? }
router.post('/ask', ...askLimits, async (req, res) => {
  const s = await storeFor(req, res);
  if (!s) return;
  if (!assistantReady()) return res.status(503).json({ error: 'The schedule assistant isn’t switched on yet.' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 500) : '';
  if (!message) return res.status(400).json({ error: 'Say what you’d like changed' });
  const asked = parseYMD(req.body?.weekStart);
  if (!asked) return res.status(400).json({ error: 'weekStart must be "YYYY-MM-DD"' });
  // the same weeks the board lets you edit by hand
  const week = mondayUTC(asked);
  const schedule = await prisma.schedule.findUnique({ where: { storeId: s.storeId } });
  const boardWeek = schedule?.weekStart ?? mondayUTC();
  if (week.getTime() !== boardWeek.getTime() && !isRunningWeek(schedule, week)) {
    return res.status(409).json({ error: 'That week can’t be changed from the board.' });
  }
  const history: Turn[] = Array.isArray(req.body?.history)
    ? (req.body.history as unknown[])
        .filter((t): t is Turn => !!t && typeof t === 'object' && ((t as Turn).role === 'manager' || (t as Turn).role === 'assistant') && typeof (t as Turn).text === 'string')
        .slice(-8)
        .map((t) => ({ role: t.role, text: t.text.slice(0, 1000) }))
    : [];
  const language = LANGUAGES[String(req.body?.language)] ?? 'English';
  const userId = req.user!.id;
  if (asking.has(userId)) {
    return res.status(429).json({ error: 'Still working on your last message.', code: 'busy' });
  }
  asking.add(userId);
  try {
    const result = await ask({ orgId: s.orgId, userId, storeId: s.storeId, weekStart: week, message, history, language });
    res.json({ ...result, allowance: await allowance(s.orgId) });
  } catch (e) {
    if (e instanceof OverAllowance) {
      return res.status(429).json({ error: 'You’ve used this month’s assistant requests.', code: 'limit', ...e.allowance });
    }
    if (e instanceof AssistantPaused) return res.status(503).json({ error: e.message, code: 'paused' });
    if (e instanceof AssistantError) return res.status(502).json({ error: e.message });
    throw e;
  } finally {
    asking.delete(userId);
  }
});

// POST /schedule-assistant/:id/apply { storeId } — make the suggested changes
router.post('/:id/apply', async (req, res) => {
  const s = await storeFor(req, res);
  if (!s) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    res.json({ applied: await apply(id, s.storeId) });
  } catch (e) {
    if (e instanceof StaleProposal) return res.status(409).json({ error: e.message });
    throw e;
  }
});

export default router;
