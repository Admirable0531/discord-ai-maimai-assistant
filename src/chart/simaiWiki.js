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

const normalise = (title) =>
    decode(String(title))
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '');

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
            byId.get(chart.song_id).push(name);
        }
    }
    const songs = Object.values(data.songs || {})
        .filter((s) => s.simai_id)
        .map((s) => ({
            title: s.title,
            id: Number(s.simai_id),
            type: s.type === 'standard' ? 'std' : 'dx',
            difficulties: byId.get(s.id) || [],
        }));
    manifestHeld = { at: Date.now(), songs };
    return songs;
}

/** The wiki's entry for a title (exact match after normalising), or null. */
async function findSong(title, chartType = 'dx') {
    const wanted = normalise(title);
    const fromManifest = await loadManifest();
    if (fromManifest) {
        const hit = fromManifest.find((s) => s.type === chartType && normalise(s.title) === wanted);
        // The manifest lists every song, so a miss is a real "not on the wiki".
        return hit || null;
    }
    // The manifest is unreachable: fall back to the wiki's own index.
    const index = parseIndex(await fetchPage(INDEX_PAGES[chartType] || INDEX_PAGES.dx));
    return index.find((s) => normalise(s.title) === wanted) || null;
}

/**
 * {success, text, id, ...} for a song + difficulty, or {success:false, error}
 * saying exactly what is missing (song not listed, no chart for that difficulty).
 */
async function getChartText(title, difficulty, chartType = 'dx') {
    const entry = await findSong(title, chartType);
    if (!entry)
        return { success: false, error: `"${title}" is not on the simai wiki ${chartType} list.` };
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

module.exports = { getChartText, findSong, parseIndex };
