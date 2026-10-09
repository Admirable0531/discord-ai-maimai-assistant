const { findPlayer, API_URL, TIMEOUT_MS } = require('../web/maimaiPlayers');
const { buildRatingChartHtml, WIDTH } = require('../render/ratingChart');
const { renderHtmlToPng } = require('../render/browserRenderer');
const { attachFile } = require('../utils/outputs');
const { parseSnapshotDate } = require('../utils/snapshotAge');

const DAY = 86400000;
const DEFAULT_DAYS = 0; // 0 = everything recorded

const declaration = {
    name: 'render_maimai_rating_history',
    description:
        "Draw a player's DX Rating over time as a line-graph IMAGE and attach it to your reply — one point " +
        "per day from the nightly snapshots (the tracked account's goes back to April 2024; friends' start " +
        'later), with the latest rating, the peak, and the change since the start. Use it for "show my rating ' +
        'history / graph / progress / how fast did X climb". Leave player_name out for the tracked account ' +
        "(the bot owner's own); pass a name for one of its friends. `days` limits it to the most recent N " +
        "days (omit for everything). The image is attached automatically and you can't see it: add a short " +
        'comment using the figures returned (change_last_30_days etc.), never read the graph out point by ' +
        'point. Breaks in the line are stretches with no snapshot; mention that if gap_days_over_14 is > 0 ' +
        'and it matters. Check latest_snapshot_age_days: if it is more than a couple of days, the history ' +
        "stops there and the player's current rating may be higher — say so.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            player_name: {
                type: 'string',
                description:
                    "A friend's name (partial match; full-width or plain ASCII). Omit for the tracked account.",
            },
            days: {
                type: 'number',
                description: 'Only the most recent N days. Omit for the full history.',
            },
        },
    },
};

/** One point per calendar day (the day's last snapshot), ascending. */
function toDailyPoints(history) {
    const byDay = new Map();
    const dated = [];
    for (const entry of history) {
        const when = parseSnapshotDate(entry.Date);
        const rating = Number(entry.rating);
        if (when && Number.isFinite(rating)) dated.push({ when, rating });
    }
    dated.sort((a, b) => a.when - b.when);
    for (const { when, rating } of dated) {
        // Calendar day in the server's zone, which is the zone the snapshots were stamped in.
        byDay.set(Date.UTC(when.getFullYear(), when.getMonth(), when.getDate()), rating);
    }
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, rating]) => ({ t, rating }));
}

// The nightly scrape sometimes reads the rating breakdown before it has finished
// loading and stores a total far below the real one (11,278 for a player rated
// ~16,000, back to normal the next day). Plotted, three such days stretched the
// axis over 6,000 points and squashed the real trend into a thin band. A day is
// treated as a bad read when it sits far below the median of the days around
// it — a real drop that lasts is the majority of its own window, so it stays.
const GLITCH_DROP = 250;
const GLITCH_HALF_WINDOW = 5;

/**
 * Points without the bad reads, and how many were dropped. The newest
 * GLITCH_HALF_WINDOW days are never dropped: with no days after them to
 * confirm a recovery, a real recent drop can't be told from a bad read, and
 * hiding the latest rating is worse than showing a glitch.
 */
function dropGlitches(points) {
    const kept = [];
    let dropped = 0;
    points.forEach((p, i) => {
        const confirmable = i <= points.length - 1 - GLITCH_HALF_WINDOW;
        if (confirmable) {
            const around = points
                .slice(Math.max(0, i - GLITCH_HALF_WINDOW), i + GLITCH_HALF_WINDOW + 1)
                .map((x) => x.rating)
                .sort((a, b) => a - b);
            const median = around[Math.floor(around.length / 2)];
            if (p.rating < median - GLITCH_DROP) {
                dropped++;
                return;
            }
        }
        kept.push(p);
    });
    return { points: kept, dropped };
}

/** last.rating minus the rating on the latest day at or before (last - days), or null if history is shorter. */
function changeOver(points, days) {
    const last = points[points.length - 1];
    const cutoff = last.t - days * DAY;
    let base = null;
    for (const p of points) if (p.t <= cutoff) base = p;
    return base ? last.rating - base.rating : null;
}

async function execute(args, context) {
    const found = await findPlayer(args?.player_name).catch((err) => ({
        error: `Could not reach the maimai stats API: ${err.message}`,
    }));
    if (found.error)
        return {
            success: false,
            error: found.error,
            ...(found.matches ? { matches: found.matches } : {}),
        };
    const { player } = found;

    let history;
    try {
        const response = await fetch(
            `${API_URL}/users/${encodeURIComponent(player.id)}/top-history`,
            {
                signal: AbortSignal.timeout(TIMEOUT_MS),
            }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        history = await response.json();
    } catch (err) {
        return { success: false, error: `Could not read rating history: ${err.message}` };
    }

    const cleaned = dropGlitches(toDailyPoints(Array.isArray(history) ? history : []));
    let points = cleaned.points;
    if (points.length === 0) {
        return { success: false, error: `No rating history is recorded for ${player.name}.` };
    }
    const days = Number(args?.days) > 0 ? Number(args.days) : DEFAULT_DAYS;
    if (days > 0) {
        const cutoff = points[points.length - 1].t - days * DAY;
        points = points.filter((p) => p.t >= cutoff);
    }

    let png;
    try {
        png = await renderHtmlToPng(
            buildRatingChartHtml({ playerName: player.name, points, excluded: cleaned.dropped }),
            {
                width: WIDTH,
            }
        );
    } catch (err) {
        return { success: false, error: err.message };
    }
    const attached = attachFile(context, {
        name: `rating-history-${player.isTracked ? 'tracked' : player.id}.png`,
        data: png,
    });
    if (!attached.ok) return { success: false, error: attached.reason };

    const first = points[0];
    const last = points[points.length - 1];
    const peak = points.reduce((best, p) => (p.rating > best.rating ? p : best));
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    let gaps = 0;
    for (let i = 1; i < points.length; i++) if (points[i].t - points[i - 1].t > 14 * DAY) gaps++;

    return {
        success: true,
        image_attached: true,
        note:
            "The graph is attached to your reply automatically — you can't see it. Add a short comment at " +
            "most; don't read it out point by point.",
        player: player.name,
        days_recorded: points.length,
        from: iso(first.t),
        to: iso(last.t),
        first_rating: first.rating,
        latest_rating: last.rating,
        change_total: last.rating - first.rating,
        peak_rating: peak.rating,
        peak_date: iso(peak.t),
        change_last_30_days: changeOver(points, 30),
        change_last_90_days: changeOver(points, 90),
        change_last_365_days: changeOver(points, 365),
        gap_days_over_14: gaps,
        ...(cleaned.dropped > 0
            ? {
                  bad_snapshots_excluded: cleaned.dropped,
                  bad_snapshots_note: `${cleaned.dropped} day(s) with a rating far below the days around them (a scrape that read the page before it finished loading) were left out of the graph and the figures above.`,
              }
            : {}),
        latest_snapshot_age_days: Math.max(0, Math.floor((Date.now() - last.t) / DAY)),
    };
}

module.exports = { declaration, execute, toDailyPoints, changeOver, dropGlitches };
