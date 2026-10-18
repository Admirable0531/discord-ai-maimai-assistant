// "Hey Atri, show me my B50" -> "show me my B50". Speech recognisers rarely
// spell a made-up name the same way twice, so the name matches the spellings
// they actually produce for it, in English, Japanese and Chinese.

const GREETINGS = [
    'hey',
    'hi',
    'hello',
    'ok',
    'okay',
    'yo',
    'oi',
    'ねえ',
    'ねぇ',
    '嘿',
    '喂',
    '哎',
    '欸',
    '诶',
];

// Hesitations people start with before they get to the name ("uh, hey Atri").
const FILLERS = [
    'um',
    'umm',
    'uh',
    'uhh',
    'erm',
    'er',
    'ah',
    'so',
    'and',
    'oh',
    '呃',
    '嗯',
    '那个',
    'えーと',
    'えっと',
    'あの',
];

const NAMES = [
    'atri',
    'atari',
    'atria',
    'a tree',
    'atree',
    'attri',
    'atry',
    'a try',
    'ateri',
    'a tri',
    'アトリ',
    'あとり',
    '亚托莉',
    '亞托莉',
    '阿托莉',
    '阿特莉',
    '亚托利',
    '阿特里',
];

function escape(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Longest first, so "a tree" isn't cut short by a shorter alternative.
const NAME_PATTERN = [...NAMES]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
const GREETING_PATTERN = GREETINGS.map(escape).join('|');
const FILLER_PATTERN = FILLERS.map(escape).join('|');
const LEADING_JUNK = '[\\s,.!?、。，！？…"\'「」-]*';

// The name has to open the utterance (after optional fillers and a greeting): "I think
// atari games are fun" mentions the name without talking to the bot.
const WAKE = new RegExp(
    `^${LEADING_JUNK}(?:(?:${FILLER_PATTERN})(?![a-z])${LEADING_JUNK})*(?:(?:${GREETING_PATTERN})(?![a-z])${LEADING_JUNK})?(?:${NAME_PATTERN})(?![a-z])${LEADING_JUNK}`,
    'i'
);

const CJK = '\\u3000-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef';
// A gap with Chinese or Japanese on one side and a character or a word on the other.
const CJK_GAP = new RegExp(
    `(?<=[${CJK}])\\s+(?=[${CJK}A-Za-z0-9])|(?<=[A-Za-z0-9])\\s+(?=[${CJK}])`,
    'g'
);

/** Recognisers sometimes space out Chinese and Japanese character by character ("亚 托 莉"); close those gaps. */
function tidyTranscript(text) {
    return typeof text === 'string' ? text.replace(CJK_GAP, '').trim() : '';
}

/**
 * The request after the wake phrase, '' when the person only said the name
 * (they're about to ask), or null when the utterance wasn't addressed to Atri.
 */
function parseWakePhrase(transcript) {
    if (typeof transcript !== 'string') return null;
    const match = WAKE.exec(transcript);
    if (!match) return null;
    return transcript.slice(match[0].length).trim();
}

module.exports = { parseWakePhrase, tidyTranscript };
