// Fallback song matching for when a plain title/artist substring finds
// nothing. Players rarely type exact titles, and three kinds of misses showed
// up in real questions:
//
// 1. Special characters. "rondo" can't substring-match "RONDØ", nor
//    "ＳＡＬＴ"-style full-width text match its ASCII spelling. fold() fixes
//    both, and is also used for the direct match.
// 2. Romanised kana. "apoc" is how people write アポカリプスに反逆の焔を焚べろ.
//    Titles' kana are romanised (wanakana) and compared loosely (c/k, l/r),
//    so "apoc" finds "apokaripusu…". Kanji are left as they are.
// 3. Community nicknames, mostly Chinese ("反逆焰"), from LXNS's public alias
//    list. Group-specific nicknames still belong in the knowledge base.
const { toRomaji } = require('wanakana');
const logger = require('../utils/logger');

const ALIAS_URL = 'https://maimai.lxns.net/api/v0/maimai/alias/list';
const SONG_LIST_URL = 'https://maimai.lxns.net/api/v0/maimai/song/list';
const ALIAS_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 20000;
// Short romaji queries ("to", "no") would match half the song list.
const MIN_ROMAJI_QUERY = 3;

/** Case-, width- and accent-insensitive form with spaces and punctuation removed. */
function fold(text) {
    return (text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/ø/g, 'o')
        .replace(/æ/g, 'ae')
        .replace(/ß/g, 'ss')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\p{L}\p{N}]/gu, '');
}

/** fold() of the romanised title, with the letters romanisation varies on merged. */
function romajiKey(text) {
    return fold(toRomaji((text || '').normalize('NFKC')))
        .replace(/c/g, 'k')
        .replace(/l/g, 'r')
        .replace(/(.)\1+/g, '$1'); // "kakko" ~ "kako", "ii" ~ "i"
}

let aliasCache = null; // { byTitle: Map<title, string[]>, expiresAt }

/** title -> community aliases. Never throws: no aliases is a usable answer. */
async function loadAliases() {
    if (aliasCache && Date.now() < aliasCache.expiresAt) return aliasCache.byTitle;
    try {
        const [aliasRes, songRes] = await Promise.all([
            fetch(ALIAS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
            fetch(SONG_LIST_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
        ]);
        if (!aliasRes.ok || !songRes.ok) {
            throw new Error(`HTTP ${aliasRes.status}/${songRes.status}`);
        }
        const { aliases = [] } = await aliasRes.json();
        const { songs = [] } = await songRes.json();
        const titleById = new Map(songs.map((s) => [s.id, s.title]));
        const byTitle = new Map();
        for (const entry of aliases) {
            const title = titleById.get(entry.song_id);
            if (!title || !Array.isArray(entry.aliases)) continue;
            byTitle.set(title, [...(byTitle.get(title) || []), ...entry.aliases]);
        }
        aliasCache = { byTitle, expiresAt: Date.now() + ALIAS_TTL_MS };
    } catch (err) {
        logger.warn('songs', `Could not load LXNS song aliases: ${err.message}`);
        // Retry in an hour rather than on every search while it's down.
        aliasCache = {
            byTitle: aliasCache?.byTitle || new Map(),
            expiresAt: Date.now() + 60 * 60 * 1000,
        };
    }
    return aliasCache.byTitle;
}

/** True when `query` appears in the song's title or artist, ignoring case, width and accents. */
function directMatch(song, query) {
    const q = fold(query);
    return Boolean(q) && (fold(song.title).includes(q) || fold(song.artist).includes(q));
}

/**
 * How a song matches `query` when the direct match didn't: 'romaji' or
 * 'alias "<the alias>"', or null. Pass the result of loadAliases().
 */
function fallbackMatch(song, query, aliasesByTitle) {
    const q = fold(query);
    if (!q) return null;
    const rq = romajiKey(query);
    if (rq.length >= MIN_ROMAJI_QUERY && romajiKey(song.title).includes(rq)) return 'romaji';
    const alias = (aliasesByTitle.get(song.title) || []).find((a) => fold(a).includes(q));
    return alias ? `alias "${alias}"` : null;
}

module.exports = { fold, romajiKey, directMatch, fallbackMatch, loadAliases };
