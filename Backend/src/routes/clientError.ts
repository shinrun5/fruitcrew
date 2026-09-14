import { Router } from 'express';
import { alertError } from '../lib/errorAlert.js';

const router = Router();

// POST /client-error  { message, stack?, url? } — no auth: a crash can happen
// before login, and whoever hit it shouldn't need to be signed in to report it.
router.post('/', (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.slice(0, 500) : 'Unknown client error';
  const url = typeof req.body?.url === 'string' ? req.body.url.slice(0, 300) : undefined;
  const err = new Error(message);
  if (typeof req.body?.stack === 'string') err.stack = req.body.stack.slice(0, 4000);
  alertError('client', err, { url, userAgent: req.header('user-agent') });
  res.status(204).end();
});

export default router;
