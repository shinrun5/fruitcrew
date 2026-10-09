// Masks slurs and strong profanity in text people post for coworkers to see
// (store chat, DMs, shift notes) — App Store guideline 1.2 asks apps with
// user content to filter objectionable material before it's posted. The
// message still goes through, with the word starred out ("f***"), so a real
// handoff note never bounces over one word.
//
// Kept deliberately short: only terms with no everyday meaning in a café or
// shop (no "cock", "pinche", "dick"), so nothing ordinary gets mangled.
// Latin-script terms match at word starts; Chinese ones anywhere.

const LATIN_STEMS = [
  // English
  'fuck\\w*', 'motherfuck\\w*', 'shit(?:ty|head|s)?', 'bullshit', 'bitch\\w*', 'cunts?', 'assholes?',
  'bastards?', 'whores?', 'sluts?', 'twats?', 'wank\\w*', 'puss(?:y|ies)',
  'nigg(?:er|a|ers|as)', 'fag(?:got)?s?', 'retard(?:ed|s)?', 'spics?', 'chinks?', 'kikes?', 'wetbacks?', 'trann(?:y|ies)',
  // Spanish
  'put[ao]s?', 'pendej\\w*', 'cabr[oó]n(?:es)?', 'mierda', 'chinga\\w*', 'vergas?', 'co[ñn]o', 'maric[oó]n(?:es)?', 'culer[oa]s?',
  'joder', 'jodid[oa]s?',
];

const CJK_TERMS = ['操你妈', '草泥马', '傻逼', '傻屄', '婊子', '狗日的', '王八蛋', '贱人'];

const LATIN_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${LATIN_STEMS.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
const CJK_RE = new RegExp(CJK_TERMS.join('|'), 'gu');

/** The text with any listed word starred out (first letter kept for Latin words). */
export function cleanText(text: string): string {
  return text
    .replace(LATIN_RE, (w) => w[0] + '*'.repeat([...w].length - 1))
    .replace(CJK_RE, (w) => '*'.repeat([...w].length));
}
