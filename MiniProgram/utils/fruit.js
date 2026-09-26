// The real app draws 33 hand-illustrated custom fruit avatars (see
// Frontend/src/components/FruitAvatar.tsx) — porting those into a Mini
// Program is real design/asset work, out of scope for this prototype. This
// is a plain-emoji stand-in that mimics the *idea* (a fruit per person), not
// a match for the real art.
const FRUITS = [
  'apple', 'orange', 'banana', 'grape', 'strawberry', 'watermelon', 'honeydew',
  'dragonfruit', 'pineapple', 'lemon', 'lime', 'peach', 'pear', 'cherry',
  'blueberry', 'plum', 'starfruit', 'coconut', 'mango', 'pomegranate', 'fig',
  'kiwi', 'raspberry', 'blackberry', 'cantaloupe', 'papaya', 'apricot',
  'passionfruit', 'guava', 'tangerine', 'avocado', 'lychee', 'persimmon',
];

const EMOJI = {
  apple: '🍎', orange: '🍊', banana: '🍌', grape: '🍇', strawberry: '🍓',
  watermelon: '🍉', honeydew: '🍈', dragonfruit: '🐉', pineapple: '🍍',
  lemon: '🍋', lime: '🍋', peach: '🍑', pear: '🍐', cherry: '🍒',
  blueberry: '🫐', plum: '🟣', starfruit: '⭐', coconut: '🥥', mango: '🥭',
  pomegranate: '🔴', fig: '🟤', kiwi: '🥝', raspberry: '🍇', blackberry: '🫐',
  cantaloupe: '🍈', papaya: '🧡', apricot: '🍑', passionfruit: '🟠',
  guava: '🟢', tangerine: '🍊', avocado: '🥑', lychee: '⚪', persimmon: '🟠',
};

/** Same deterministic id-based pick as fruitFor() in Frontend/src/lib/fruit.ts,
 * so the same person tends to land on a similar fruit across both apps. */
function fruitEmojiFor(employeeId) {
  const fruit = FRUITS[((employeeId % FRUITS.length) + FRUITS.length) % FRUITS.length];
  return EMOJI[fruit] || '🍎';
}

module.exports = { fruitEmojiFor };
