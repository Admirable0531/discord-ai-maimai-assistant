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

const cache = new Map();

async function fetchPage(id) {
    const key = String(id);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < DAY_MS) return hit.html;
    const res = await fetch(`${BASE}/${id}.html`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`simai wiki page ${id} returned HTTP ${res.status}`);
    const html = await res.text();
    cache.set(key, { at: Date.now(), html });
    return html;
}

const normalise = (title) =>
    decode(String(title))
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s　]+/g, '');

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

/** The wiki's entry for a title (exact match after normalising), or null. */
async function findSong(title, chartType = 'dx') {
    const index = parseIndex(await fetchPage(INDEX_PAGES[chartType] || INDEX_PAGES.dx));
    const wanted = normalise(title);
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
