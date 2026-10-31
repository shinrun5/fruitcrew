import Anthropic from '@anthropic-ai/sdk';
import { DayOfWeek } from '@prisma/client';
import { HHMM, WEEK_DAYS } from './time.js';

/** What a store's current schedule says, read off a photo, PDF or spreadsheet:
 * who's named on it and every shift. Nothing here is saved — the manager
 * checks it on the import screen first. */
export interface ReadSchedule {
  /** the Monday of the week it shows, "YYYY-MM-DD" — "" when it shows no dates */
  weekOf: string;
  people: { name: string; role: string }[];
  /** person "" = nobody on it yet (an open shift); role "" = none */
  shifts: { person: string; day: DayOfWeek; start: string; end: string; role: string; unsure: boolean }[];
  /** things the reader wasn't sure of, for the manager */
  notes: string[];
}

export type ScheduleFile =
  | { kind: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string }
  | { kind: 'pdf'; data: string }
  /** a spreadsheet or CSV, turned into text on the phone/computer first */
  | { kind: 'text'; text: string };

export interface ReadContext {
  fileName: string;
  storeName: string;
  /** who's already on this store's team, so "Ava" on paper comes back as "Ava Martinez" */
  people: string[];
  /** the store's sections, so "Kitchen" on paper lands on the section that means it */
  sections: string[];
  /** the language the manager reads the app in — the notes are written in it */
  language: string;
}

/** Something the manager can act on (unreadable file, too big) — its message is shown as is. */
export class ScheduleReadError extends Error {}

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You read a store's work schedule — a photo of a paper or whiteboard schedule, a printout, a PDF, or a spreadsheet — and write down every shift on it, exactly as scheduled. A manager checks your result before anything is saved, so when something is hard to read, give your best reading and mark it unsure rather than leaving it out.

How to read it:
- One shift is one person working one stretch of time on one day. Someone working two separate stretches on the same day is two shifts.
- day is the weekday: MONDAY to SUNDAY. If the schedule shows dates, set weekOf to the Monday of that week as YYYY-MM-DD; otherwise "".
- start and end are 24-hour "HH:MM". Read forms like "9-5", "9a–5p", "9:30-close". If the schedule uses words or codes instead of times ("open", "close", "AM", "PM", "A", "B"), use the schedule's own legend or store hours if it shows them; otherwise make your best guess and set unsure.
- A shift that ends after midnight: end it at "23:59" and set unsure.
- Skip cells that mean not working: OFF, X, a dash, blank, RO (requested off), vacation, sick and the like.
- person is the name as written, spelled the same way every time that person appears. A shift with nobody on it (OPEN, TBD, ???) gets person "".
- role is the position, station or section the shift is labelled with (Front, Kitchen, Cashier…), or "" if there isn't one.
- people lists everyone named on the schedule once each — including anyone with no shifts this week — with the role they're usually listed under ("" if none).
- notes are short plain sentences for the manager about anything you weren't sure of or couldn't read, such as "Maria's Saturday is smudged — read as 4 PM to 9 PM." Leave it empty when everything was clear.
- In the notes, refer to people by name (or "they"); never guess anyone's gender from their name, so no "he" or "she".
- Never add people or shifts that aren't on the schedule.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['weekOf', 'people', 'shifts', 'notes'],
  properties: {
    weekOf: { type: 'string' },
    people: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role'],
        properties: { name: { type: 'string' }, role: { type: 'string' } },
      },
    },
    shifts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['person', 'day', 'start', 'end', 'role', 'unsure'],
        properties: {
          person: { type: 'string' },
          day: { type: 'string', enum: [...WEEK_DAYS] },
          start: { type: 'string' },
          end: { type: 'string' },
          role: { type: 'string' },
          unsure: { type: 'boolean' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

function contextText(ctx: ReadContext, file: ScheduleFile): string {
  const lines = [`Store: ${ctx.storeName}.`, `File: "${ctx.fileName}".`];
  if (ctx.people.length > 0) {
    lines.push(
      `People already on this store's team: ${ctx.people.join(', ')}. If a name on the schedule is clearly one of them (a first name, nickname or initial), write it the way it's spelled here.`,
    );
  }
  if (ctx.sections.length > 0) {
    lines.push(
      `Sections this store uses: ${ctx.sections.join(', ')}. When a shift's label clearly means one of them, use that section's name as its role.`,
    );
  }
  lines.push(`Write the notes in ${ctx.language}.`);
  if (file.kind === 'text') lines.push('The spreadsheet, as text:', file.text);
  else lines.push('The schedule is attached above.');
  return lines.join('\n');
}

/** "9:00" → "09:00"; anything that isn't a time → null. */
function clock(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const v = `${m[1]!.padStart(2, '0')}:${m[2]}`;
  return HHMM.test(v) ? v : null;
}

const text = (s: unknown, max = 80) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

/** Keeps only what makes sense — real days, real times, start before end —
 * and says how many it had to drop, so nothing goes missing silently. */
export function tidy(raw: unknown): ReadSchedule {
  const r = (raw ?? {}) as Record<string, unknown>;
  const notes = Array.isArray(r.notes) ? r.notes.map((n) => text(n, 300)).filter(Boolean) : [];
  const shifts: ReadSchedule['shifts'] = [];
  let dropped = 0;
  for (const s of Array.isArray(r.shifts) ? r.shifts : []) {
    const x = (s ?? {}) as Record<string, unknown>;
    const day = WEEK_DAYS.find((d) => d === x.day);
    const start = clock(x.start);
    const end = clock(x.end);
    if (!day || !start || !end || start >= end) {
      dropped++;
      continue;
    }
    shifts.push({ person: text(x.person), day, start, end, role: text(x.role), unsure: x.unsure === true });
  }
  if (dropped > 0) {
    notes.push(`${dropped} shift${dropped === 1 ? '' : 's'} had times that couldn't be read and ${dropped === 1 ? 'was' : 'were'} left out — add ${dropped === 1 ? 'it' : 'them'} by hand if needed.`);
  }
  // everyone on a shift is someone, even if the list of people missed them
  const people = new Map<string, string>();
  for (const p of Array.isArray(r.people) ? r.people : []) {
    const x = (p ?? {}) as Record<string, unknown>;
    const name = text(x.name);
    if (name && !people.has(name)) people.set(name, text(x.role));
  }
  for (const s of shifts) if (s.person && !people.has(s.person)) people.set(s.person, s.role);
  const weekOf = typeof r.weekOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.weekOf) ? r.weekOf : '';
  return { weekOf, people: [...people].map(([name, role]) => ({ name, role })), shifts, notes };
}

let client: Anthropic | null = null;

async function readWithClaude(file: ScheduleFile, ctx: ReadContext): Promise<ReadSchedule> {
  client ??= new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (file.kind === 'image') {
    content.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } });
  } else if (file.kind === 'pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } });
  }
  content.push({ type: 'text', text: contextText(ctx, file) });

  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 64000,
        // reading a whole week right is worth the extra thought; it's a one-off per store
        output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
        // if a safety check declines, the API retries on another model instead of failing
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content }],
      })
      .finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      throw new ScheduleReadError("That file couldn't be read — try a clearer photo, a PDF, or the spreadsheet itself.");
    }
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
      throw new ScheduleReadError('The schedule reader is busy right now — try again in a minute.');
    }
    throw err;
  }
  console.info('schedule-import read', { model: message.model, usage: message.usage });

  if (message.stop_reason === 'refusal') {
    throw new ScheduleReadError("That file couldn't be read as a schedule — try a clearer photo or the spreadsheet itself.");
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ScheduleReadError('That schedule is too big to read in one go — import one week at a time.');
  }
  const out = message.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
  try {
    return tidy(JSON.parse(out?.text ?? ''));
  } catch {
    throw new ScheduleReadError("That file couldn't be read as a schedule — try a clearer photo or the spreadsheet itself.");
  }
}

let reader: (file: ScheduleFile, ctx: ReadContext) => Promise<ReadSchedule> = readWithClaude;

/** Read a schedule file (Claude, unless a test swapped the reader). */
export const readSchedule = (file: ScheduleFile, ctx: ReadContext) => reader(file, ctx);

/** Whether reading is switched on here — it needs the Anthropic API key. */
export const readerReady = () => reader !== readWithClaude || !!process.env.ANTHROPIC_API_KEY;

/** For tests: read without calling Claude. */
export function setScheduleReader(fn: typeof reader) {
  reader = fn;
}
