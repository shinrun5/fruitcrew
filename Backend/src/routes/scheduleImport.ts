import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { DayOfWeek } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { requireManagerFor, storeIdFrom } from '../lib/auth.js';
import { firstFreeFruit } from '../lib/fruits.js';
import { freezeShifts, mondayUTC } from '../lib/scheduleGen.js';
import { readerReady, readSchedule, type ScheduleFile, ScheduleReadError } from '../lib/scheduleImport.js';
import { HHMM, hhmmToMinutes, toClock, todayUTC, WEEK_DAYS } from '../lib/time.js';
import { alertError } from '../lib/errorAlert.js';

/**
 * Bringing a store's current schedule into FruitCrew: read a photo, PDF or
 * spreadsheet of it (Claude), let the manager check every name and shift,
 * then save it into the week being planned — with new people added and,
 * if asked, shift needs and new people's usual hours taken from it.
 */
const router = Router();
const manageStore = requireManagerFor(storeIdFrom);

// each read is a paid model call — a handful an hour is plenty for setting up
const readLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  keyGenerator: (req: Request) => `import:${req.user!.id}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: "That's a lot of schedules in an hour — try again a bit later." },
});

const LANGUAGES = { en: 'English', zh: 'Simplified Chinese', es: 'Spanish' } as const;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
const MAX_TEXT = 200_000;

/** The week an import lands in: the one being planned on the board. */
async function targetWeek(storeId: number) {
  const schedule = await prisma.schedule.findUnique({ where: { storeId } });
  const weekStart = schedule?.weekStart ?? mondayUTC();
  const posted = !!schedule?.postedWeekStart && schedule.postedWeekStart.getTime() === weekStart.getTime();
  return { weekStart, posted };
}

async function storePeople(storeId: number) {
  return prisma.employee.findMany({
    where: { employeeStores: { some: { storeId } } },
    select: { id: true, name: true, posName: true, avatarFruit: true },
    orderBy: { name: 'asc' },
  });
}

const sectionsOf = (storeId: number) =>
  prisma.responsibility.findMany({
    where: { storeId, scope: 'SECTION', archivedAt: null },
    select: { id: true, name: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });

/** GET /schedule-import/context?storeId — what the import screen needs up front. */
router.get('/context', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const { weekStart, posted } = await targetWeek(storeId);
  const [people, sections, existing, needs] = await Promise.all([
    storePeople(storeId),
    sectionsOf(storeId),
    prisma.shift.count({ where: { storeId, weekStart } }),
    prisma.shiftRequirement.count({ where: { storeId } }),
  ]);
  res.json({
    ready: readerReady(),
    weekStart: weekStart.toISOString().slice(0, 10),
    posted,
    existingShifts: existing,
    hasNeeds: needs > 0,
    people: people.map((p) => ({ id: p.id, name: p.name, posName: p.posName })),
    sections: sections.map((s) => ({ id: s.id, name: s.name })),
  });
});

/**
 * POST /schedule-import/read  { storeId, fileName, file: { type, data } | text }
 * Reads the schedule and sends back what it found. Saves nothing.
 */
router.post('/read', ...manageStore, readLimit, async (req, res) => {
  const storeId = storeIdFrom(req);
  if (!readerReady()) return res.status(503).json({ error: "Importing a schedule isn't switched on yet." });
  const b = req.body ?? {};
  let file: ScheduleFile;
  if (typeof b.text === 'string') {
    if (!b.text.trim()) return res.status(400).json({ error: 'That file is empty.' });
    if (b.text.length > MAX_TEXT) return res.status(413).json({ error: 'That spreadsheet is too big — import one week at a time.' });
    file = { kind: 'text', text: b.text };
  } else if (b.file && typeof b.file.data === 'string' && typeof b.file.type === 'string') {
    if (b.file.type === 'application/pdf') file = { kind: 'pdf', data: b.file.data };
    else if ((IMAGE_TYPES as readonly string[]).includes(b.file.type)) {
      file = { kind: 'image', mediaType: b.file.type as (typeof IMAGE_TYPES)[number], data: b.file.data };
    } else return res.status(400).json({ error: 'Use a photo, a PDF, or an Excel or CSV file.' });
  } else return res.status(400).json({ error: 'Pick a file to import.' });

  const [store, people, sections] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    storePeople(storeId),
    sectionsOf(storeId),
  ]);
  try {
    const read = await readSchedule(file, {
      fileName: typeof b.fileName === 'string' ? b.fileName.slice(0, 120) : 'schedule',
      storeName: store?.name ?? '',
      people: people.map((p) => p.name),
      sections: sections.map((s) => s.name),
      language: LANGUAGES[b.lang as keyof typeof LANGUAGES] ?? 'English',
    });
    res.json(read);
  } catch (err) {
    if (err instanceof ScheduleReadError) return res.status(422).json({ error: err.message });
    alertError('scheduleImport.read', err, { storeId });
    res.status(502).json({ error: "The schedule couldn't be read just now — try again." });
  }
});

type InShift = { person: string; day: DayOfWeek; start: string; end: string; section: string };

/** One requirement window per distinct stretch of the day, needing as many
 * people as the schedule had on it — the schedule's own shape. */
export function needsFrom(shifts: { day: DayOfWeek; start: string; end: string }[]) {
  const count = new Map<string, number>();
  for (const s of shifts) {
    const k = `${s.day}|${s.start}|${s.end}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return [...count].map(([k, n]) => {
    const [day, start, end] = k.split('|') as [DayOfWeek, string, string];
    return { day, start, end, regularRequired: n };
  });
}

/** A person's shifts as their usual hours: one window per day, earliest start to latest end. */
export function usualHoursFrom(shifts: { day: DayOfWeek; start: string; end: string }[]) {
  const byDay = new Map<DayOfWeek, { start: string; end: string }>();
  for (const s of shifts) {
    const cur = byDay.get(s.day);
    byDay.set(s.day, cur ? { start: s.start < cur.start ? s.start : cur.start, end: s.end > cur.end ? s.end : cur.end } : { start: s.start, end: s.end });
  }
  return [...byDay].map(([day, w]) => ({ day, ...w }));
}

/**
 * POST /schedule-import/apply
 * { storeId,
 *   people: [{ name, employeeId?: number, add?: boolean }],  — who each name is
 *   shifts: [{ person, day, start, end, section }],           — person "" = open shift
 *   setUpNeeds?, usualHours?, addSections? }
 * Saves the checked schedule into the week being planned. Whatever was on it
 * is kept as a saved version first; names left unmatched are left off.
 */
router.post('/apply', ...manageStore, async (req, res) => {
  const storeId = storeIdFrom(req);
  const b = req.body ?? {};
  if (!Array.isArray(b.people) || !Array.isArray(b.shifts)) return res.status(400).json({ error: 'Nothing to import.' });
  if (b.people.length > 300 || b.shifts.length > 1500) return res.status(413).json({ error: 'That is more than one week — import one week at a time.' });

  const { weekStart, posted } = await targetWeek(storeId);
  if (posted) {
    return res.status(409).json({ error: 'This week is already posted — start next week on the Schedule, then import into it.' });
  }

  const shifts: InShift[] = [];
  for (const s of b.shifts) {
    const day = WEEK_DAYS.find((d) => d === s?.day);
    if (!day || !HHMM.test(s?.start) || !HHMM.test(s?.end) || s.start >= s.end) {
      return res.status(400).json({ error: 'Every shift needs a day and a start before its end.' });
    }
    shifts.push({
      person: typeof s.person === 'string' ? s.person.trim() : '',
      day,
      start: s.start,
      end: s.end,
      section: typeof s.section === 'string' ? s.section.trim() : '',
    });
  }

  const team = await storePeople(storeId);
  const teamIds = new Set(team.map((p) => p.id));
  const who = new Map<string, number | 'add'>();
  for (const p of b.people) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!name) continue;
    if (Number.isInteger(p.employeeId)) {
      if (!teamIds.has(p.employeeId)) return res.status(400).json({ error: `${name} isn't on this store's team.` });
      who.set(name, p.employeeId);
    } else if (p.add === true) who.set(name, 'add');
  }

  const sections = await sectionsOf(storeId);
  const sectionId = new Map(sections.map((s) => [s.name.trim().toLowerCase(), s.id]));
  // new sections by lower-case name, so "Kitchen" and "kitchen" are one
  const missingSections = new Map<string, string>();
  if (b.addSections) {
    for (const sh of shifts) {
      const key = sh.section.toLowerCase();
      if (sh.section && !sectionId.has(key) && !missingSections.has(key)) missingSections.set(key, sh.section);
    }
  }
  // names the store already uses for something else (a closing job, the Opener,
  // a removed section) — a role isn't a section, and a removed one comes back
  const named = await prisma.responsibility.findMany({ where: { storeId }, select: { id: true, name: true, scope: true } });

  const kept = shifts.filter((s) => s.person === '' || who.has(s.person));
  const existing = await freezeShifts(storeId, weekStart);
  const hasNeeds = (await prisma.shiftRequirement.count({ where: { storeId } })) > 0;
  const mates = team.map((p) => ({ id: p.id, avatarFruit: p.avatarFruit }));

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        let order = sections.reduce((n, s) => Math.max(n, s.sortOrder), 0);
        let addedSections = 0;
        for (const [key, name] of missingSections) {
          const same = named.find((r) => r.name.trim().toLowerCase() === key);
          if (same && same.scope !== 'SECTION') continue; // not a section; those shifts get none
          const r = same
            ? await tx.responsibility.update({ where: { id: same.id }, data: { archivedAt: null } })
            : await tx.responsibility.create({ data: { storeId, name: name.slice(0, 40), scope: 'SECTION', sortOrder: ++order } });
          sectionId.set(key, r.id);
          addedSections++;
        }

        // new people: limits roomy enough for the week they're importing with
        const ids = new Map<string, number>();
        let added = 0;
        for (const [name, v] of who) {
          if (v !== 'add') {
            ids.set(name, v);
            continue;
          }
          const theirs = kept.filter((s) => s.person === name);
          const hours = Math.ceil(theirs.reduce((n, s) => n + hhmmToMinutes(s.end) - hhmmToMinutes(s.start), 0) / 60);
          const days = new Set(theirs.map((s) => s.day)).size;
          const e = await tx.employee.create({
            data: { name: name.slice(0, 80), hourLimit: Math.max(40, hours), maxShifts: Math.min(7, Math.max(5, days)), hireDate: todayUTC() },
          });
          const fruit = firstFreeFruit(e.id, mates);
          mates.push({ id: e.id, avatarFruit: fruit });
          await tx.employee.update({ where: { id: e.id }, data: { avatarFruit: fruit } });
          await tx.employeeStore.create({ data: { employeeId: e.id, storeId, proficiency: 'REGULAR', primary: true } });
          if (b.usualHours && theirs.length > 0) {
            await tx.recurringAvailability.createMany({
              data: usualHoursFrom(theirs).map((w) => ({ employeeId: e.id, day: w.day, start: toClock(w.start), end: toClock(w.end) })),
            });
          }
          ids.set(name, e.id);
          added++;
        }

        if (existing.length > 0) {
          await tx.scheduleSnapshot.create({
            data: { storeId, weekStart, label: 'before importing a schedule', savedById: req.user!.id, shifts: existing },
          });
        }
        await tx.shift.deleteMany({ where: { storeId, weekStart } });
        await tx.shift.createMany({
          data: kept.map((s) => ({
            employeeId: s.person ? ids.get(s.person)! : null,
            storeId,
            weekStart,
            day: s.day,
            start: toClock(s.start),
            end: toClock(s.end),
            sectionId: s.section ? (sectionId.get(s.section.toLowerCase()) ?? null) : null,
          })),
        });

        // only for a store with none yet — never over needs someone set up by hand
        const needs = b.setUpNeeds && !hasNeeds ? needsFrom(kept) : [];
        if (needs.length > 0) {
          await tx.shiftRequirement.createMany({
            data: needs.map((n) => ({ storeId, day: n.day, start: toClock(n.start), end: toClock(n.end), regularRequired: n.regularRequired })),
          });
        }
        await tx.schedule.upsert({ where: { storeId }, create: { storeId, weekStart }, update: {} });
        return { added, needs: needs.length, sections: addedSections };
      },
      { timeout: 30_000 },
    );
    res.json({
      weekStart: weekStart.toISOString().slice(0, 10),
      shifts: kept.length,
      leftOff: shifts.length - kept.length,
      added: result.added,
      sections: result.sections,
      needs: result.needs,
    });
  } catch (err) {
    alertError('scheduleImport.apply', err, { storeId });
    res.status(500).json({ error: "The schedule couldn't be saved — nothing was changed. Try again." });
  }
});

export default router;
