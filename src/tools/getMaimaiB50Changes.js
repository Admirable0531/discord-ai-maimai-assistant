// What changed in a player's best 50 between an earlier snapshot and now: the
// rating difference, charts that entered and left, and charts whose score went
// up. The nightly scrape keeps a B50 snapshot per day (the stats API's
// top-history and scores-by-date), so "what pushed my rating up this week"
// is a diff of two of them rather than something to guess.
const { config } = require('../config/env');
const { loadSnapshot, parsePlay, chartKey } = require('../web/maimaiPlayerSnapshot');
const { parseSnapshotDate } = require('../utils/snapshotAge');

const API_URL = config.tools.maimaiApiUrl;
const TIMEOUT_MS = 15000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 15;

const declaration = {
    name: 'get_maimai_b50_changes',
    description:
        "What changed in a player's best 50 (B15 + B35) since an earlier day: the rating change, charts that " +
        'entered and left, and charts whose score went up, each with the rating it carries. From the nightly ' +
        'snapshots, so it answers "what changed in my B50 this week", "what raised my rating", "what did I ' +
        'improve since <date>". Leave player_name out for the tracked account; pass a friend\'s name otherwise. ' +
        'The comparison uses the last snapshot on or before the requested day — compared_with_date says which.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            player_name: {
                type: 'string',
                description: "A friend's name; omit for the tracked account.",
            },
            days: { type: 'integer', description: 'Compare with this many days ago (default 7).' },
            since_date: { type: 'string', description: 'Or compare with this date, YYYY-MM-DD.' },
        },
    },
};

async function getJson(path) {
    const response = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${path.split('?')[0]}`);
    return response.json();
}

/** The latest snapshot dated on or before `cutoff` (a Date), from the player's history list. */
function snapshotBefore(history, cutoff) {
    return history
        .map((h) => ({ ...h, at: parseSnapshotDate(h.Date) }))
        .filter((h) => h.at && h.at <= cutoff)
        .sort((a, b) => b.at - a.at)[0];
}

const keyOf = (p) => chartKey(p.song, p.chartType, p.difficulty);
const brief = (p) => ({
    song: p.song,
    chart_type: p.chartType,
    difficulty: p.difficulty,
    constant: p.level,
    achievement: p.achievement,
    rating: p.rating,
});

async function execute(args) {
    const now = await loadSnapshot(args?.player_name);
    if (!now.success) return now;

    let cutoff;
    if (typeof args?.since_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.since_date)) {
        cutoff = new Date(`${args.since_date}T23:59:59`);
    } else {
        const days = Math.min(Math.max(Number(args?.days) || 7, 1), 730);
        cutoff = new Date(Date.now() - days * DAY_MS);
    }

    let then;
    try {
        const history = await getJson(`/users/${encodeURIComponent(now.player.id)}/top-history`);
        const pick = snapshotBefore(Array.isArray(history) ? history : [], cutoff);
        if (!pick) {
            return {
                success: false,
                error: `${now.player.name} has no B50 snapshot that old — the history starts later.`,
            };
        }
        const day = pick.Date.split(' ')[0]; // DD/MM/YYYY, what scores-by-date takes
        then = await getJson(
            `/users/${encodeURIComponent(now.player.id)}/scores-by-date?date=${encodeURIComponent(day)}`
        );
        then.Date = then.Date || pick.Date;
    } catch (err) {
        return { success: false, error: `Could not reach the maimai stats API: ${err.message}` };
    }

    const before = new Map(
        [...(then.new || []), ...(then.old || [])].map(parsePlay).map((p) => [keyOf(p), p])
    );
    const after = new Map([...now.newPlays, ...now.oldPlays].map((p) => [keyOf(p), p]));

    const entered = [...after].filter(([k]) => !before.has(k)).map(([, p]) => brief(p));
    const left = [...before].filter(([k]) => !after.has(k)).map(([, p]) => brief(p));
    const improved = [...after]
        .filter(([k, p]) => before.has(k) && p.achievement > before.get(k).achievement)
        .map(([k, p]) => ({
            ...brief(p),
            achievement_before: before.get(k).achievement,
            rating_before: before.get(k).rating,
        }));
    const byRating = (a, b) => b.rating - a.rating;

    return {
        success: true,
        player: now.player.name,
        compared_with_date: then.Date,
        current_snapshot_date: now.snapshotDate,
        rating_then: then.rating ?? null,
        rating_now: now.rating,
        rating_change: then.rating != null && now.rating != null ? now.rating - then.rating : null,
        entered: entered.sort(byRating).slice(0, MAX_ROWS),
        left: left.sort(byRating).slice(0, MAX_ROWS),
        improved: improved
            .sort((a, b) => b.rating - b.rating_before - (a.rating - a.rating_before))
            .slice(0, MAX_ROWS),
        counts: { entered: entered.length, left: left.length, improved: improved.length },
        ...(now.stale
            ? { stale: true, note: 'The current snapshot itself is old — newer plays are missing.' }
            : {}),
    };
}

module.exports = { declaration, execute };
