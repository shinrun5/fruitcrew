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
] as const

export type Fruit = (typeof FRUITS)[number]

/** The default fruit for someone who hasn't picked one: stable per employee
 * id rather than random-per-render, and collision-tolerant (two people can
 * share a fruit). Mirrors Backend/src/lib/fruits.ts `fruitFor`. */
export function fruitFor(employeeId: number): Fruit {
  return FRUITS[employeeId % FRUITS.length]
}

/** The person's chosen fruit if they have a valid one, else the deterministic default. */
export function fruitForPerson(p: { employeeId: number; avatarFruit?: string | null }): Fruit {
  return p.avatarFruit && (FRUITS as readonly string[]).includes(p.avatarFruit)
    ? (p.avatarFruit as Fruit)
    : fruitFor(p.employeeId)
}
