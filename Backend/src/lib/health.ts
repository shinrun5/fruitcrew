import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prisma from './prisma.js';

// GET /api/health is also Railway's deploy check (railway.json
// healthcheckPath): a new deploy only goes live once this answers 200. So it
// checks the two things that have taken the site down — the database is
// reachable, and every migration this code ships with has been applied. If a
// deploy's migrations didn't run, the deploy fails its check and the previous
// version keeps serving, instead of every signed-in request erroring on a
// missing column.

const MIGRATIONS_DIR = fileURLToPath(new URL('../../prisma/migrations', import.meta.url));

let expected: string[] | null = null;
function expectedMigrations(): string[] {
  if (!expected) {
    expected = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
      .map((d) => d.name);
  }
  return expected;
}

// a passing check is reused briefly, so a busy uptime monitor can't hammer the database
let okUntil = 0;

export async function checkHealth(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (Date.now() < okUntil) return { ok: true };
  let applied: Set<string>;
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    applied = new Set(rows.map((r) => r.migration_name));
  } catch (e) {
    console.error('[health] database unreachable:', e instanceof Error ? e.message : e);
    return { ok: false, reason: 'database unreachable' };
  }
  const missing = expectedMigrations().filter((m) => !applied.has(m));
  if (missing.length) {
    console.error(`[health] database is missing ${missing.length} migration(s): ${missing.join(', ')}`);
    return { ok: false, reason: `database is missing ${missing.length} migration(s)` };
  }
  okUntil = Date.now() + 30_000;
  return { ok: true };
}
