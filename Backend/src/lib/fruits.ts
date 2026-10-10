import prisma from './prisma.js';

// Mirrors Frontend/src/lib/fruit.ts — the set of valid avatar fruits. Kept
// hand-synced (same as types.ts mirroring the schema). Order doesn't matter here.
export const FRUITS = [
  'apple',
  'orange',
  'banana',
  'grape',
  'strawberry',
  'watermelon',
  'honeydew',
  'dragonfruit',
  'pineapple',
  'lemon',
  'lime',
  'peach',
  'pear',
  'cherry',
  'blueberry',
  'plum',
  'starfruit',
  'coconut',
  'mango',
  'pomegranate',
  'fig',
  'kiwi',
  'raspberry',
  'blackberry',
  'cantaloupe',
  'papaya',
  'apricot',
  'passionfruit',
  'guava',
  'tangerine',
  'avocado',
  'lychee',
  'persimmon',
] as const;

export type Fruit = (typeof FRUITS)[number];

export function isFruit(x: unknown): x is Fruit {
  return typeof x === 'string' && (FRUITS as readonly string[]).includes(x);
}

/** The deterministic default fruit for an employee with no chosen one.
 * Mirrors Frontend/src/lib/fruit.ts `fruitFor`. */
export function fruitFor(employeeId: number): Fruit {
  return FRUITS[employeeId % FRUITS.length]!;
}

/** A fruit not already in use (chosen OR falling out as someone's default) by
 * anyone in `others` — those rows' { id, avatarFruit }. Falls back to the id's
 * own default if every fruit is somehow taken. */
export function firstFreeFruit(
  forEmployeeId: number,
  others: { id: number; avatarFruit: string | null }[],
): Fruit {
  const used = new Set(others.map((o) => o.avatarFruit ?? fruitFor(o.id)));
  return FRUITS.find((f) => !used.has(f)) ?? fruitFor(forEmployeeId);
}

/** employeeId (for the deterministic fruit) + chosen avatarFruit, keyed by userId. */
export async function avatarsByUserId(userIds: number[]): Promise<Map<number, { key: number; fruit: string | null }>> {
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
