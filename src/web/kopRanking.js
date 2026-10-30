// KING of Performai 8th (KOP8th) maimai score-attack rankings, Japan and
// International. The official pages are a Nuxt app that loads these JSON
// files in the browser (found in its ranking chunk: kop8th/json/<game>/<eventId>.json);
// each holds the top 100 and the time SEGA last updated it.
const { normalizeName } = require('./maimaiFriendLookup');

const TIMEOUT_MS = 20_000;

const REGIONS = [
    {
        key: 'jp',
        label: 'Japan',
        url: 'https://maimai.sega.jp/kop8th/json/maimai/maimai_scoreattack_ranking.json',
        pageUrl: 'https://maimai.sega.jp/kop8th/maimai/ranking/',
    },
    {
        key: 'intl',
        label: 'International',
        url: 'https://maimai.sega.jp/kop8th/json/maimai_itr/maimai_scoreattack_ranking.json',
        pageUrl: 'https://maimai.sega.com/kop8th/maimai_itr_en/ranking/',
    },
];

function toInt(value) {
    const n = parseInt(String(value ?? '').replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : null;
}

/** The JSON's ranking list as [{rank, name, score, dxScore, recordDate}], best first. */
function parseRanking(body) {
    const list = Array.isArray(body?.ranking)
        ? body.ranking
        : Array.isArray(body?.rankingList)
          ? body.rankingList
          : [];
    return list
        .map((e) => ({
            rank: toInt(e.rank),
            name: String(e.userName ?? ''),
            score: toInt(e.score),
            dxScore: toInt(e.subScore),
            recordDate: e.recordDate || null,
        }))
        .filter((e) => e.rank !== null && e.name)
        .sort((a, b) => a.rank - b.rank);
}

/** "2026/10/30 02:00:00 (JST)" and "2026/10/30 07:00:00" both -> "2026/10/30 07:00 JST". */
function formatUpdate(update) {
    const m = /^(\d{4}\/\d{2}\/\d{2}) (\d{2}:\d{2})/.exec(String(update ?? ''));
    return m ? `${m[1]} ${m[2]} JST` : String(update ?? '');
}

/** { update, entries } for one region; throws on a network or HTTP error. */
async function fetchRanking(region) {
    const response = await fetch(region.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AtriBot)' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${region.url}`);
    const body = await response.json();
    return { update: String(body.update ?? ''), entries: parseRanking(body) };
}

/**
 * Each entry with `move` against the previous update's ranking: places gained
 * (positive) or lost (negative), 0 for unchanged, 'new' when the player
 * wasn't in it, or null when there is no previous ranking to compare with.
 */
function withMovement(entries, previous) {
    if (!Array.isArray(previous) || previous.length === 0) {
        return entries.map((e) => ({ ...e, move: null }));
    }
    const before = new Map(previous.map((e) => [normalizeName(e.name), e.rank]));
    return entries.map((e) => {
        const old = before.get(normalizeName(e.name));
        return { ...e, move: old === undefined ? 'new' : old - e.rank };
    });
}

module.exports = { REGIONS, fetchRanking, parseRanking, formatUpdate, withMovement };
