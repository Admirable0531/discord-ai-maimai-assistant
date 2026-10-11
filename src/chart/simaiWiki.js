// Finds a song's chart text on the simai wiki. The index pages (DX = 808,
// standard = 32) list every song with a link per difficulty that has chart
// data; each song page holds the chart text. One request at a time, cached
// for a day, never bulk-mirrored. The text is for analysis only and must not
// be reposted in Discord.
const { decode, extractChart } = require('./simaiPage');

const BASE = 'https://w.atwiki.jp/simai/pages';
const INDEX_PAGES = { dx: 808, std: 32 };
const DAY_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = 'AtriDiscordBot/1.0 (chart analysis; contact via Discord)';

const fs = require('fs');
const path = require('path');

const CACHE_DIR =
    process.env.CHART_CACHE_DIR || path.join(__dirname, '..', '..', 'data', 'simai-cache');
// Index pages change when charts are added; song pages rarely change.
const TTL_MS = { index: DAY_MS, song: 7 * DAY_MS };
// Memory copy so repeated questions in one run never touch the disk or the wiki.
const memory = new Map();

function readCached(id) {
    const file = path.join(CACHE_DIR, `${id}.html`);
    try {
        const stat = fs.statSync(file);
        return { html: fs.readFileSync(file, 'utf8'), at: stat.mtimeMs };
    } catch {
        return null;
    }
}

function writeCached(id, html) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(path.join(CACHE_DIR, `${id}.html`), html);
    } catch {
        // A cache that cannot be written only costs a refetch.
    }
}

/**
 * One wiki page. Fresh copies come from the cache; a failed fetch (the site is
 * behind a bot challenge that can block for a while) falls back to a stale
 * copy rather than failing, and says so plainly when there is none.
 */
async function fetchPage(id) {
    const key = String(id);
    const kind = Object.values(INDEX_PAGES).includes(Number(id)) ? 'index' : 'song';
    const held = memory.get(key) || readCached(key);
    if (held && Date.now() - held.at < TTL_MS[kind]) {
        memory.set(key, held);
        return held.html;
    }
    try {
        const res = await fetch(`${BASE}/${id}.html`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        if (/<title>Just a moment/i.test(html)) throw new Error('blocked by a bot check');
        memory.set(key, { html, at: Date.now() });
        writeCached(key, html);
        return html;
    } catch (err) {
        if (held) return held.html;
        throw new Error(`simai wiki page ${id} unavailable (${err.message})`);
    }
}

const FOLD_MAP = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', ł: 'l', þ: 'th' };
/**
 * Title as a search key: accents and look-alike letters folded (Ø -> o), case,
 * spaces and punctuation dropped, so "rondo" finds "RONDØ" and "ro nd" finds it too.
 */
function fold(text) {
    return decode(String(text))
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[øæœßđłþ]/g, (c) => FOLD_MAP[c])
        .replace(/[^\p{L}\p{N}]+/gu, '');
}
/** [{title, id, difficulties[]}] from an index page: one row per song. */
function parseIndex(html) {
    const songs = [];
    for (const row of html.split(/<tr\b/).slice(1)) {
        const first =
            /<a href="\/\/w\.atwiki\.jp\/simai\/pages\/(\d+)\.html"\s+title="[^"]*">([^<]+)<\/a>/.exec(
                row
            );
        if (!first) continue;
        const difficulties = new Set();
        for (const m of row.matchAll(
            /pages\/\d+\.html#(BASIC|ADVANCED|EXPERT|MASTER|Re:MASTER)"/g
        )) {
            difficulties.add(m[1] === 'Re:MASTER' ? 'remaster' : m[1].toLowerCase());
        }
        songs.push({
            title: decode(first[2]),
            id: Number(first[1]),
            difficulties: [...difficulties],
        });
    }
    return songs;
}

const MANIFEST_URL = 'https://mai-notes.com/data/manifest.json';
let manifestHeld = null;

/**
 * mai-notes publishes a static manifest of every song with its simai wiki page
 * id and which charts have data. Using it to find the page id means the wiki's
 * big index page is never needed; one small song page is fetched per new song.
 * Returns [{title, id, type, difficulties[]}] or null if it cannot be read.
 */
async function loadManifest() {
    if (manifestHeld && Date.now() - manifestHeld.at < DAY_MS) return manifestHeld.songs;
    const file = path.join(CACHE_DIR, 'mai-notes-manifest.json');
    let raw = null;
    try {
        const stat = fs.statSync(file);
        if (Date.now() - stat.mtimeMs < DAY_MS) raw = fs.readFileSync(file, 'utf8');
    } catch {
        // no cached copy yet
    }
    if (!raw) {
        try {
            const res = await fetch(MANIFEST_URL, {
                headers: { 'User-Agent': USER_AGENT },
                signal: AbortSignal.timeout(30000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            raw = await res.text();
            JSON.parse(raw);
            try {
                fs.mkdirSync(CACHE_DIR, { recursive: true });
                fs.writeFileSync(file, raw);
            } catch {
                // an unwritable cache only costs a refetch
            }
        } catch {
            try {
                raw = fs.readFileSync(file, 'utf8'); // stale beats nothing
            } catch {
                return null;
            }
        }
    }
    const data = JSON.parse(raw);
    const byId = new Map();
    for (const chart of data.charts || []) {
        if (!byId.has(chart.song_id)) byId.set(chart.song_id, []);
        if (chart.has_chart_data) {
            const name = String(chart.difficulty).toLowerCase().replace(':', '').replace(/\s/g, '');
            byId.get(chart.song_id).push({ name, level: chart.level });
        }
    }
    const ORDER = ['basic', 'advanced', 'expert', 'master', 'remaster'];
    const songs = Object.values(data.songs || {})
        .filter((s) => s.simai_id)
        .map((s) => ({
            title:
                String(s.title)
                    .replace(/[\u200e\u200f]/g, '')
                    .trim() || '(untitled)',
            artist: s.artist || '',
            id: Number(s.simai_id),
            type: s.type === 'standard' ? 'std' : 'dx',
            difficulties: (byId.get(s.id) || [])
                .map((c) => c.name)
                .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)),
            levels: Object.fromEntries((byId.get(s.id) || []).map((c) => [c.name, c.level])),
            key: fold(s.title),
            artistKey: fold(s.artist || ''),
        }));
    manifestHeld = { at: Date.now(), songs };
    return songs;
}

/** Songs that match a search, best first: exact, prefix, word start, contains, in-order letters. */
async function searchSongs(query, { limit = 40, type = null } = {}) {
    const songs = await loadManifest();
    const q = fold(query);
    if (!songs || !q) return [];
    const inOrder = (key) => {
        let at = 0;
        for (const ch of q) {
            at = key.indexOf(ch, at);
            if (at === -1) return false;
            at += 1;
        }
        return true;
    };
    const scored = [];
    for (const song of songs) {
        if (type && song.type !== type) continue;
        let score = null;
        if (song.key === q) score = 0;
        else if (song.key.startsWith(q)) score = 1;
        else if (song.key.includes(q)) score = 3;
        else if (song.artistKey.includes(q)) score = 5;
        else if (q.length >= 3 && inOrder(song.key)) score = 6;
        if (score !== null) scored.push({ song, score });
    }
    // Loose in-order matches only help when there are few real ones.
    const real = scored.filter((x) => x.score < 6).length;
    if (real >= 5) scored.splice(0, scored.length, ...scored.filter((x) => x.score < 6));
    scored.sort(
        (a, b) =>
            a.score - b.score ||
            a.song.key.length - b.song.key.length ||
            a.song.title.localeCompare(b.song.title)
    );
    return scored.slice(0, limit).map((x) => x.song);
}

/** The wiki's entry for a title: exact after folding, else the one song it unambiguously means. */
async function findSong(title, chartType = 'dx') {
    const wanted = fold(title);
    const fromManifest = await loadManifest();
    if (fromManifest) {
        const sameType = fromManifest.filter((s) => s.type === chartType);
        const exact = sameType.find((s) => s.key === wanted);
        if (exact) return exact;
        const near = (await searchSongs(title, { limit: 3, type: chartType })).filter(
            (s) => s.key.startsWith(wanted) || s.key.includes(wanted)
        );
        // "rond" -> RONDØ when nothing else fits; several candidates is a genuine miss.
        return near.length === 1 ? near[0] : null;
    }
    // The manifest is unreachable: fall back to the wiki's own index.
    const index = parseIndex(await fetchPage(INDEX_PAGES[chartType] || INDEX_PAGES.dx));
    return index.find((s) => fold(s.title) === wanted) || null;
}

/**
 * {success, text, id, ...} for a song + difficulty, or {success:false, error}
 * saying exactly what is missing (song not listed, no chart for that difficulty).
 */
async function getChartText(title, difficulty, chartType = 'dx') {
    const entry = await findSong(title, chartType);
    if (!entry) {
        const suggestions = (await searchSongs(title, { limit: 5 })).map(
            (x) => `${x.title} (${x.type.toUpperCase()})`
        );
        return {
            success: false,
            error: `"${title}" is not on the simai wiki ${chartType} list.${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`,
            suggestions,
        };
    }
    const text = extractChart(await fetchPage(entry.id), difficulty);
    if (!text) {
        return {
            success: false,
            error: `The simai wiki has no ${difficulty} chart for "${entry.title}".`,
            available: entry.difficulties,
        };
    }
    return { success: true, text, id: entry.id, title: entry.title };
}

module.exports = { getChartText, findSong, searchSongs, fold, parseIndex };
