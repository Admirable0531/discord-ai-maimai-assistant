// Turning what someone typed into the song they meant. Every tool that takes a
// song name goes through here, so "rondo", "apoc" or "电脑眠眠猫" work the same
// way in a playcount question as in a song search. (There used to be four
// matchers of different strength; the playcount and ranking tools had the
// weakest, a plain substring, and resolved "Oshama Scramble!" to its UTAGE joke
// chart instead of the real song.)
//
// Matching runs in tiers, loosest last, and stops at the first tier that finds
// anything — a loose rule applied to a query that already matches exactly would
// bury the real answer under false positives:
//
//   exact      the folded title equals the query
//   direct     the query is part of the title or artist (case, width, accents ignored)
//   fallback   romanised kana ("apoc") or a community alias (maimaiSongMatch.js)
//   converted  the query in simplified Chinese, converted to Japanese / traditional
//              kanji (电脑 -> 電脳), then matched directly
//   leet       digits read as letters on both sides ("overclock" ~ OV3RCLOCK)
//   words      every word of the query is in the title or artist
//   shortened  the query's leading words, dropping extras from the end ("dear player 2 salt")
//   typo       within one or two edits of the title or its start ("ov3rclcok")
//
// UTAGE (宴会場) entries share 65 titles with real songs; the real song wins.
const OpenCC = require('opencc-js');
const { fold, fallbackMatch, loadAliases } = require('./maimaiSongMatch');
const { isUtageSong } = require('./maimaiChartLookup');

const toJapanese = OpenCC.Converter({ from: 'cn', to: 'jp' });
const toTraditional = OpenCC.Converter({ from: 'cn', to: 't' });

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };
const MIN_TYPO_QUERY = 5;

/** fold() with digits read as the letters they usually stand in for. */
function leetKey(text) {
    return fold(text).replace(/[013457]/g, (d) => LEET[d]);
}

/** Edit distance counting a swap of two neighbours as one edit (optimal string alignment). */
function editDistance(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    const rows = [];
    for (let i = 0; i <= a.length; i++) rows.push([i]);
    for (let j = 1; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        let best = Infinity;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d = Math.min(d, rows[i - 2][j - 2] + 1);
            }
            rows[i][j] = d;
            best = Math.min(best, d);
        }
        if (best > cap) return cap + 1; // no cell can come back under the cap
    }
    return rows[a.length][b.length];
}

/** Words of the query worth matching on their own: folded, two characters or more (or any number). */
function queryWords(query) {
    return String(query || '')
        .normalize('NFKC')
        .split(/[\s,.、。・:;!?！？/]+/u)
        .map(fold)
        .filter((w) => w.length >= 2 || /\d/.test(w));
}

/**
 * The matching tiers for `query`, in order: [{name, match(song) -> via|null}],
 * where `via` is true for a plain match or a short note of how it matched.
 * Aliases are loaded only if a tier that needs them is reached.
 */
function matchTiers(query) {
    const q = fold(query);
    if (!q) return [];
    let aliases = null;
    const converted = [...new Set([toJapanese(query), toTraditional(query)])]
        .map(fold)
        .filter((c) => c && c !== q);
    const leet = leetKey(query);
    const words = queryWords(query);
    const typoCap = q.length >= 9 ? 2 : 1;

    return [
        { name: 'exact', match: (song) => fold(song.title) === q || null },
        {
            name: 'direct',
            match: (song) => fold(song.title).includes(q) || fold(song.artist).includes(q) || null,
        },
        {
            name: 'fallback',
            prepare: async () => {
                aliases = await loadAliases();
            },
            match: (song) => fallbackMatch(song, query, aliases),
        },
        {
            name: 'converted',
            match: (song) => {
                const hit = converted.find(
                    (c) => fold(song.title).includes(c) || fold(song.artist).includes(c)
                );
                return hit ? 'simplified Chinese' : null;
            },
        },
        {
            name: 'leet',
            // Only reached when the plain match failed, so a hit here means the digits mattered.
            match: (song) =>
                /[a-z]/.test(leet) && leetKey(song.title).includes(leet)
                    ? 'digits as letters'
                    : null,
        },
        {
            name: 'words',
            match: (song) => {
                if (words.length < 2) return null;
                const hay = fold(`${song.title} ${song.artist}`);
                return words.every((w) => hay.includes(w)) ? 'title and artist words' : null;
            },
        },
        // Longest leading run of words first, so "dear player 2 salt" tries "dear player 2"
        // before "dear player".
        ...words.slice(0, -1).map((_, i, shorter) => {
            const count = shorter.length - i; // words kept: n-1, n-2, … 1
            const prefix = words.slice(0, count).join('');
            return {
                name: 'shortened',
                match: (song) =>
                    count >= 2 && prefix.length >= 4 && fold(song.title).includes(prefix)
                        ? `first ${count} words`
                        : null,
            };
        }),
        {
            name: 'typo',
            match: (song) => {
                if (q.length < MIN_TYPO_QUERY) return null;
                const title = fold(song.title);
                const whole = editDistance(q, title, typoCap);
                const start = editDistance(q, title.slice(0, q.length), typoCap);
                return Math.min(whole, start) <= typoCap ? 'close spelling' : null;
            },
        },
    ];
}

/** Drops UTAGE entries whose title a real song in the same list also has. */
function preferRealSongs(entries) {
    const realTitles = new Set(
        entries.filter((e) => !isUtageSong(e.song)).map((e) => e.song.title)
    );
    return entries.filter((e) => !isUtageSong(e.song) || !realTitles.has(e.song.title));
}

/**
 * Songs matching `query`, from the first tier that matches anything, as
 * [{song, via}] (via: true or a short note). `accept(song)` narrows the songs
 * considered at every tier (filters such as version or BPM), so a tier only
 * counts as a hit when something survives the filters too. `skipExact` starts
 * at substring matching, for a search that should list every title containing
 * the query rather than only the exact one.
 */
async function findSongs(songs, query, accept = () => true, { skipExact = false } = {}) {
    for (const tier of matchTiers(query)) {
        if (skipExact && tier.name === 'exact') continue;
        if (tier.prepare) await tier.prepare();
        const found = [];
        for (const song of songs) {
            if (!accept(song)) continue;
            const via = tier.match(song);
            if (via) found.push({ song, via });
        }
        if (found.length > 0) return { tier: tier.name, matches: preferRealSongs(found) };
    }
    return { tier: null, matches: [] };
}

/**
 * The one song `query` means: {song, via} | {ambiguous: [titles]} | null.
 * An exact title wins outright; otherwise the match must be unique once
 * UTAGE namesakes are dropped.
 */
async function resolveSong(songs, query, { includeUtage = false } = {}) {
    const { matches } = await findSongs(songs, query, (s) => includeUtage || !isUtageSong(s));
    if (matches.length === 0) return null;
    const titles = [...new Set(matches.map((m) => m.song.title))];
    if (titles.length === 1) return matches[0];
    const exact = matches.find((m) => fold(m.song.title) === fold(query));
    if (exact) return exact;
    return { ambiguous: titles.slice(0, 15) };
}

/**
 * For tools: {song, matchedVia} when `query` means one song, otherwise
 * {failure} — a tool result saying none or several matched, ready to return.
 * matchedVia is null for a plain match, or how a loose one was made, so the
 * model can tell the user which song it took "rondo" to mean.
 */
async function lookupSong(songs, query) {
    const found = await resolveSong(songs, query);
    if (!found) {
        return {
            failure: {
                success: false,
                error: `No song matching "${query}" found. If it is a nickname, check search_knowledge_base for it.`,
            },
        };
    }
    if (found.ambiguous) {
        return {
            failure: {
                success: false,
                error: `Multiple songs match "${query}" — be more specific.`,
                matches: found.ambiguous,
            },
        };
    }
    return { song: found.song, matchedVia: found.via === true ? null : found.via };
}

module.exports = { findSongs, resolveSong, lookupSong, matchTiers, editDistance, leetKey };
