import { Router, type Request } from 'express';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth } from '../lib/auth.js';
import { notify } from '../lib/notify.js';

const router = Router();

const MAX_LEN = 2000;
const PAGE = 50;
// don't email a given person about chat more than once per this window
const EMAIL_COOLDOWN_MS = 15 * 60 * 1000;

interface WireMessage {
  id: number;
  storeId: number;
  body: string;
  createdAt: string;
  authorName: string;
  /** stable per-person key for the deterministic default avatar (employeeId, else userId) */
  authorKey: number;
  authorFruit: string | null;
  mine: boolean;
  /** true when the viewer is one of the message's @-mentions */
  mentionsMe: boolean;
}

function toWire(
  m: {
    id: number;
    storeId: number;
    body: string;
    createdAt: Date;
    authorName: string;
    userId: number | null;
    mentions?: number[];
  },
  meUserId: number,
  keyFruit: Map<number, { key: number; fruit: string | null }>,
): WireMessage {
  const kf = m.userId != null ? keyFruit.get(m.userId) : undefined;
  return {
    id: m.id,
    storeId: m.storeId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    authorName: m.authorName,
    authorKey: kf?.key ?? m.userId ?? 0,
    authorFruit: kf?.fruit ?? null,
    mine: m.userId === meUserId,
    mentionsMe: (m.mentions ?? []).includes(meUserId),
  };
}

/** employeeId (for the deterministic fruit) + chosen avatarFruit, keyed by userId. */
async function avatarLookup(userIds: number[]): Promise<Map<number, { key: number; fruit: string | null }>> {
  const ids = [...new Set(userIds.filter((n) => n > 0))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, employeeId: true, employee: { select: { avatarFruit: true } } },
  });
  return new Map(
    users.map((u) => [u.id, { key: u.employeeId ?? u.id, fruit: u.employee?.avatarFruit ?? null }]),
  );
}

// Group chat is staff-only: a pure OWNER/MANAGER with no Employee link at this
// store can't see or post here, even though they can manage the store itself.
// An owner/manager who's ALSO linked as staff (works shifts there) keeps access.
const canSee = (req: Request, storeId: number) =>
  Number.isInteger(storeId) && !!req.user?.employeeStoreIds.includes(storeId);

// GET /chat/:storeId/messages?after=<id>&before=<id>
// no cursor -> the latest page; `after` -> everything newer (polling);
// `before` -> the page just older (scroll-back). Always returned oldest-first.
router.get('/:storeId/messages', requireAuth, async (req, res) => {
  const storeId = Number(req.params.storeId);
  if (!canSee(req, storeId)) return res.status(403).json({ error: 'Not your store' });

  const after = req.query.after !== undefined ? Number(req.query.after) : null;
  const before = req.query.before !== undefined ? Number(req.query.before) : null;

  let rows;
  if (after != null && Number.isFinite(after)) {
    rows = await prisma.message.findMany({
      where: { storeId, deletedAt: null, id: { gt: after } },
      orderBy: { id: 'asc' },
      take: 200,
    });
  } else {
    rows = await prisma.message.findMany({
      where: { storeId, deletedAt: null, ...(before != null && Number.isFinite(before) ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: PAGE,
    });
    rows.reverse();
  }

  const keyFruit = await avatarLookup(rows.map((r) => r.userId ?? 0));
  res.json({
    messages: rows.map((r) => toWire(r, req.user!.id, keyFruit)),
    hasMore: after == null && rows.length === PAGE,
  });
});

// GET /chat/:storeId/members — everyone in this store's channel (for the @-picker
// and for highlighting @-names in the transcript)
router.get('/:storeId/members', requireAuth, async (req, res) => {
  const storeId = Number(req.params.storeId);
  if (!canSee(req, storeId)) return res.status(403).json({ error: 'Not your store' });

  const ids = await storeMemberUserIds(storeId);
  if (ids.length === 0) return res.json({ members: [] });
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      email: true,
      employeeId: true,
      employee: { select: { name: true, avatarFruit: true } },
    },
  });
  res.json({
    members: users
      .map((u) => ({
        userId: u.id,
        name: u.employee?.name ?? u.name ?? u.email,
        avatarKey: u.employeeId ?? u.id,
        avatarFruit: u.employee?.avatarFruit ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});

// POST /chat/:storeId/messages  { body, mentions?: number[] }
router.post('/:storeId/messages', requireAuth, async (req, res) => {
  const storeId = Number(req.params.storeId);
  if (!canSee(req, storeId)) return res.status(403).json({ error: 'Not your store' });

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'Message is empty' });
  if (body.length > MAX_LEN) return res.status(400).json({ error: `Message is too long (max ${MAX_LEN})` });

  const me = req.user!;
  const authorName = me.name ?? me.email;

  // @all — only a manager/owner of this store can ping the whole channel;
  // silently ignored from anyone else (their message still sends normally)
  const wantsAll = req.body?.mentionAll === true && canManageStore(me, storeId);

  // keep only real channel members, drop the sender and dups
  const claimed: number[] = Array.isArray(req.body?.mentions)
    ? req.body.mentions.filter((n: unknown): n is number => Number.isInteger(n))
    : [];
  let mentions: number[] = [];
  if (wantsAll) {
    mentions = (await storeMemberUserIds(storeId)).filter((id) => id !== me.id);
  } else if (claimed.length > 0) {
    const memberIds = new Set(await storeMemberUserIds(storeId));
    mentions = [...new Set(claimed)].filter((id) => id !== me.id && memberIds.has(id));
  }

  const msg = await prisma.message.create({
    data: { storeId, userId: me.id, authorName, body, mentions },
  });
  // the sender has now "seen" everything up to their own message
  await prisma.messageRead.upsert({
    where: { userId_storeId: { userId: me.id, storeId } },
    create: { userId: me.id, storeId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });

  if (mentions.length > 0) {
    void notifyMentions(storeId, authorName, body, mentions).catch((e) =>
      console.error('[chat] mention notify failed', e),
    );
  }
  // the plain "new messages" nudge — skip anyone we just @-pinged
  void emailChatRecipients(storeId, me.id, authorName, body, mentions).catch((e) =>
    console.error('[chat] recipient email failed', e),
  );

  const keyFruit = await avatarLookup([me.id]);
  res.status(201).json({ message: toWire(msg, me.id, keyFruit) });
});

// POST /chat/:storeId/read — mark the whole channel read up to now
router.post('/:storeId/read', requireAuth, async (req, res) => {
  const storeId = Number(req.params.storeId);
  if (!canSee(req, storeId)) return res.status(403).json({ error: 'Not your store' });
  const now = new Date();
  await prisma.messageRead.upsert({
    where: { userId_storeId: { userId: req.user!.id, storeId } },
    create: { userId: req.user!.id, storeId, lastReadAt: now },
    update: { lastReadAt: now },
  });
  res.json({ ok: true });
});

// GET /chat/unread — unread counts for the caller: per store + direct messages
router.get('/unread', requireAuth, async (req, res) => {
  const me = req.user!.id;
  const storeIds = req.user!.employeeStoreIds;

  const dm = await prisma.directMessage.count({ where: { recipientId: me, readAt: null } });

  const byStore: Record<number, number> = {};
  let storeTotal = 0;
  if (storeIds.length > 0) {
    const reads = await prisma.messageRead.findMany({
      where: { userId: me, storeId: { in: storeIds } },
    });
    const readAt = new Map(reads.map((r) => [r.storeId, r.lastReadAt]));
    for (const storeId of storeIds) {
      const since = readAt.get(storeId);
      const n = await prisma.message.count({
        where: {
          storeId,
          deletedAt: null,
          userId: { not: me },
          ...(since ? { createdAt: { gt: since } } : {}),
        },
      });
      if (n > 0) byStore[storeId] = n;
      storeTotal += n;
    }
  }
  res.json({ total: storeTotal + dm, byStore, dm });
});

// GET /chat/conversations — the caller's chat list: every store channel + every
// DM thread that has messages, each with a last-message preview + unread count,
// newest activity first.
router.get('/conversations', requireAuth, async (req, res) => {
  const me = req.user!.id;
  const storeIds = req.user!.employeeStoreIds;
  const firstName = (n: string) => n.split(' ')[0] || n;

  // --- store channels ---
  type Row =
    | { kind: 'store'; storeId: number; name: string; lastMessage: string | null; lastAt: string | null; unread: number }
    | {
        kind: 'dm';
        userId: number;
        name: string;
        avatarKey: number;
        avatarFruit: string | null;
        lastMessage: string;
        lastAt: string;
        unread: number;
      };
  const rows: Row[] = [];

  if (storeIds.length > 0) {
    const [stores, reads] = await Promise.all([
      prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } }),
      prisma.messageRead.findMany({ where: { userId: me, storeId: { in: storeIds } } }),
    ]);
    const readAt = new Map(reads.map((r) => [r.storeId, r.lastReadAt]));
    for (const s of stores) {
      const [last, unread] = await Promise.all([
        prisma.message.findFirst({
          where: { storeId: s.id, deletedAt: null },
          orderBy: { id: 'desc' },
          select: { body: true, createdAt: true, authorName: true, userId: true },
        }),
        prisma.message.count({
          where: {
            storeId: s.id,
            deletedAt: null,
            userId: { not: me },
            ...(readAt.get(s.id) ? { createdAt: { gt: readAt.get(s.id)! } } : {}),
          },
        }),
      ]);
      rows.push({
        kind: 'store',
        storeId: s.id,
        name: s.name,
        lastMessage: last
          ? `${last.userId === me ? 'You' : firstName(last.authorName)}: ${last.body}`
          : null,
        lastAt: last?.createdAt.toISOString() ?? null,
        unread,
      });
    }
  }

  // --- DM threads (those with at least one message) ---
  const dmMsgs = await prisma.directMessage.findMany({
    where: { OR: [{ senderId: me }, { recipientId: me }] },
    orderBy: { id: 'desc' },
    take: 1000,
    select: { senderId: true, recipientId: true, body: true, createdAt: true, readAt: true },
  });
  const byPeer = new Map<number, { body: string; at: Date; mine: boolean }>();
  const unreadByPeer = new Map<number, number>();
  for (const m of dmMsgs) {
    const peer = m.senderId === me ? m.recipientId : m.senderId;
    if (!byPeer.has(peer)) byPeer.set(peer, { body: m.body, at: m.createdAt, mine: m.senderId === me });
    if (m.recipientId === me && m.readAt == null) {
      unreadByPeer.set(peer, (unreadByPeer.get(peer) ?? 0) + 1);
    }
  }
  const peerIds = [...byPeer.keys()];
  if (peerIds.length > 0) {
    const peerUsers = await prisma.user.findMany({
      where: { id: { in: peerIds } },
      select: { id: true, name: true, email: true, employee: { select: { id: true, name: true, avatarFruit: true } } },
    });
    for (const u of peerUsers) {
      const l = byPeer.get(u.id)!;
      rows.push({
        kind: 'dm',
        userId: u.id,
        name: u.employee?.name ?? u.name ?? u.email,
        avatarKey: u.employee?.id ?? u.id,
        avatarFruit: u.employee?.avatarFruit ?? null,
        lastMessage: `${l.mine ? 'You: ' : ''}${l.body}`,
        lastAt: l.at.toISOString(),
        unread: unreadByPeer.get(u.id) ?? 0,
      });
    }
  }

  rows.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  res.json({ conversations: rows });
});

/** Everyone who belongs to a store's chat: actual staff there, regardless of
 * login role — an owner/manager who also works shifts there is included via
 * their own Employee link, same as any other employee. */
async function storeMemberUserIds(storeId: number): Promise<number[]> {
  const users = await prisma.user.findMany({
    where: { employee: { is: { employeeStores: { some: { storeId } } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** In-app + email each @-mentioned member. Being tagged is directed at you
 * specifically, so it's opt-OUT (notifyOnMention, default on) — separate from the
 * opt-in "new chat messages" nudge — and it ignores that nudge's cooldown. */
async function notifyMentions(
  storeId: number,
  senderName: string,
  body: string,
  mentionedUserIds: number[],
): Promise<void> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { name: true } });
  const optedIn = new Set(
    (
      await prisma.user.findMany({
        where: { id: { in: mentionedUserIds }, notifyOnMention: true },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;
  for (const id of mentionedUserIds) {
    await notify(id, {
      kind: 'GENERIC',
      title: `${senderName} mentioned you in ${store?.name ?? 'store'} chat`,
      body: preview,
      link: '/chat',
      email: optedIn.has(id),
    });
  }
}

/** Email opted-in members (except the sender + anyone `skip`ped) that the chat has
 * new activity, at most once per EMAIL_COOLDOWN_MS each. A nudge, not a relay. */
async function emailChatRecipients(
  storeId: number,
  senderUserId: number,
  senderName: string,
  body: string,
  skip: number[] = [],
): Promise<void> {
  const drop = new Set([senderUserId, ...skip]);
  const memberIds = (await storeMemberUserIds(storeId)).filter((id) => !drop.has(id));
  if (memberIds.length === 0) return;

  const cutoff = new Date(Date.now() - EMAIL_COOLDOWN_MS);
  const recipients = await prisma.user.findMany({
    where: {
      id: { in: memberIds },
      notifyOnChatMessage: true,
      OR: [{ lastChatEmailAt: null }, { lastChatEmailAt: { lt: cutoff } }],
    },
    select: { id: true },
  });
  if (recipients.length === 0) return;

  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { name: true } });
  const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;
  await prisma.user.updateMany({
    where: { id: { in: recipients.map((r) => r.id) } },
    data: { lastChatEmailAt: new Date() },
  });
  for (const r of recipients) {
    await notify(r.id, {
      kind: 'GENERIC',
      title: `New messages in ${store?.name ?? 'store'} chat`,
      body: `${senderName}: ${preview}`,
      link: '/chat',
      email: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Direct messages — private 1-to-1 between two logins who share a store.
// ---------------------------------------------------------------------------

const dmPeerWhere = (myStoreIds: number[]) => ({
  OR: [
    { role: 'OWNER' as const, org: { stores: { some: { id: { in: myStoreIds } } } } },
    { managerStores: { some: { storeId: { in: myStoreIds } } } },
    { employee: { is: { employeeStores: { some: { storeId: { in: myStoreIds } } } } } },
  ],
});

/** true if `peerId` is a login sharing at least one store with the caller. */
async function canDm(myStoreIds: number[], peerId: number): Promise<boolean> {
  if (myStoreIds.length === 0 || !Number.isInteger(peerId)) return false;
  const hit = await prisma.user.findFirst({
    where: { id: peerId, ...dmPeerWhere(myStoreIds) },
    select: { id: true },
  });
  return !!hit;
}

function dmWire(
  r: { id: number; senderId: number; body: string; createdAt: Date },
  meUserId: number,
  keyFruit: Map<number, { key: number; fruit: string | null }>,
): WireMessage {
  const kf = keyFruit.get(r.senderId);
  return {
    id: r.id,
    storeId: 0,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    authorName: '',
    authorKey: kf?.key ?? r.senderId,
    authorFruit: kf?.fruit ?? null,
    mine: r.senderId === meUserId,
    mentionsMe: false,
  };
}

// GET /chat/dm/peers — logins you can DM (with the store(s) you share), plus the
// names of coworkers who don't have an account yet.
router.get('/dm/peers', requireAuth, async (req, res) => {
  const me = req.user!;
  if (me.storeIds.length === 0) return res.json({ peers: [], noAccount: [] });

  const myStores = new Set(me.storeIds);
  const storeNames = new Map(
    (await prisma.store.findMany({ where: { id: { in: me.storeIds } }, select: { id: true, name: true } })).map(
      (s) => [s.id, s.name],
    ),
  );

  const [people, noAccountRows] = await Promise.all([
    prisma.user.findMany({
      where: { id: { not: me.id }, ...dmPeerWhere(me.storeIds) },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        orgId: true,
        managerStores: { select: { storeId: true } },
        employee: {
          select: {
            id: true,
            name: true,
            avatarFruit: true,
            employeeStores: { select: { storeId: true } },
          },
        },
      },
    }),
    prisma.employee.findMany({
      where: { user: null, standby: false, employeeStores: { some: { storeId: { in: me.storeIds } } } },
      select: { name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const unreadRows = await prisma.directMessage.groupBy({
    by: ['senderId'],
    where: { recipientId: me.id, readAt: null },
    _count: { _all: true },
  });
  const unreadBy = new Map(unreadRows.map((r) => [r.senderId, r._count._all]));

  const recent = await prisma.directMessage.findMany({
    where: { OR: [{ senderId: me.id }, { recipientId: me.id }] },
    orderBy: { id: 'desc' },
    take: 500,
    select: { senderId: true, recipientId: true, createdAt: true },
  });
  const lastBy = new Map<number, Date>();
  for (const r of recent) {
    const other = r.senderId === me.id ? r.recipientId : r.senderId;
    if (!lastBy.has(other)) lastBy.set(other, r.createdAt);
  }

  const sharedStoreNames = (p: (typeof people)[number]): string[] => {
    const ids =
      p.role === 'OWNER' && p.orgId === me.orgId
        ? me.storeIds // same org owner -> shares every store I'm on
        : [...p.managerStores.map((m) => m.storeId), ...(p.employee?.employeeStores.map((e) => e.storeId) ?? [])];
    return [...new Set(ids.filter((id) => myStores.has(id)))]
      .map((id) => storeNames.get(id))
      .filter((n): n is string => !!n);
  };

  const peers = people
    .map((p) => ({
      userId: p.id,
      name: p.employee?.name ?? p.name ?? p.email,
      avatarKey: p.employee?.id ?? p.id,
      avatarFruit: p.employee?.avatarFruit ?? null,
      sharedStores: sharedStoreNames(p),
      unread: unreadBy.get(p.id) ?? 0,
      lastMessageAt: lastBy.get(p.id)?.toISOString() ?? null,
    }))
    .sort(
      (a, b) =>
        (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') ||
        a.name.localeCompare(b.name),
    );
  res.json({ peers, noAccount: noAccountRows.map((r) => r.name) });
});

// GET /chat/dm/:peerId/messages?after=<id>&before=<id>
router.get('/dm/:peerId/messages', requireAuth, async (req, res) => {
  const me = req.user!;
  const peerId = Number(req.params.peerId);
  if (!(await canDm(me.storeIds, peerId))) {
    return res.status(403).json({ error: 'You have no shared store with them' });
  }

  const pair = {
    OR: [
      { senderId: me.id, recipientId: peerId },
      { senderId: peerId, recipientId: me.id },
    ],
  };
  const after = req.query.after !== undefined ? Number(req.query.after) : null;
  const before = req.query.before !== undefined ? Number(req.query.before) : null;

  let rows;
  if (after != null && Number.isFinite(after)) {
    rows = await prisma.directMessage.findMany({
      where: { AND: [pair, { id: { gt: after } }] },
      orderBy: { id: 'asc' },
      take: 200,
    });
  } else {
    rows = await prisma.directMessage.findMany({
      where: before != null && Number.isFinite(before) ? { AND: [pair, { id: { lt: before } }] } : pair,
      orderBy: { id: 'desc' },
      take: PAGE,
    });
    rows.reverse();
  }

  const keyFruit = await avatarLookup([me.id, peerId]);
  res.json({
    messages: rows.map((r) => dmWire(r, me.id, keyFruit)),
    hasMore: after == null && rows.length === PAGE,
  });
});

// POST /chat/dm/:peerId/messages  { body }
router.post('/dm/:peerId/messages', requireAuth, async (req, res) => {
  const me = req.user!;
  const peerId = Number(req.params.peerId);
  if (!(await canDm(me.storeIds, peerId))) {
    return res.status(403).json({ error: 'You have no shared store with them' });
  }
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'Message is empty' });
  if (body.length > MAX_LEN) return res.status(400).json({ error: `Message is too long (max ${MAX_LEN})` });

  const msg = await prisma.directMessage.create({
    data: { senderId: me.id, recipientId: peerId, body },
  });
  void emailDmRecipient(peerId, me.name ?? me.email, body).catch((e) =>
    console.error('[chat] dm email failed', e),
  );

  const keyFruit = await avatarLookup([me.id]);
  res.status(201).json({ message: dmWire(msg, me.id, keyFruit) });
});

// POST /chat/dm/:peerId/read — mark everything from this peer as read
router.post('/dm/:peerId/read', requireAuth, async (req, res) => {
  const me = req.user!;
  const peerId = Number(req.params.peerId);
  await prisma.directMessage.updateMany({
    where: { senderId: peerId, recipientId: me.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});

/** Email a DM recipient (opt-in, rate-limited — shares the chat cooldown). */
async function emailDmRecipient(recipientId: number, senderName: string, body: string): Promise<void> {
  const cutoff = new Date(Date.now() - EMAIL_COOLDOWN_MS);
  const r = await prisma.user.findFirst({
    where: {
      id: recipientId,
      notifyOnChatMessage: true,
      OR: [{ lastChatEmailAt: null }, { lastChatEmailAt: { lt: cutoff } }],
    },
    select: { id: true },
  });
  if (!r) return;
  await prisma.user.updateMany({ where: { id: recipientId }, data: { lastChatEmailAt: new Date() } });
  const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;
  await notify(recipientId, {
    kind: 'GENERIC',
    title: `${senderName} messaged you`,
    body: preview,
    link: '/chat',
    email: true,
  });
}

export default router;
