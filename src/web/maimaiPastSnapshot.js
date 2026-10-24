// A player's best-50 snapshot from an earlier day. maimaiscrape keeps every
// nightly snapshot in full (top-history only returns their ratings), so "my
// B50 when I hit 16000" or "my B50 on 1 March" is a lookup, not a guess.
const { API_URL, TIMEOUT_MS } = require('./maimaiPlayers');
const { toDailyPoints, dropGlitches } = require('../tools/renderMaimaiRatingHistory');

const DAY = 24 * 60 * 60 * 1000;

function dayString(t) {
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, '0');
    return {
        iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        // How maimaiscrape stamps snapshots, and what scores-by-date matches on.
        stored: `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    };
}

/**
 * Which day to read, from one point per day (ascending, bad reads dropped):
 * a day `reachedRating` was reached, or the last day on or before `date`
 * ("YYYY-MM-DD"). A rating can be reached more than once — each new version
 * resets the B15 and drops it — so every crossing is returned as `crossings`
 * and `occurrence` picks one: 1 the first (default), 2 the second, -1 the
 * most recent. Returns { point, crossings? } or { error }.
 */
function pickDay(points, { date, reachedRating, occurrence = 1 }) {
    if (points.length === 0) return { error: 'No snapshots are recorded for this player.' };
    const first = dayString(points[0].t).iso;

    if (Number.isFinite(reachedRating)) {
        const crossings = points.filter(
            (p, i) => p.rating >= reachedRating && (i === 0 || points[i - 1].rating < reachedRating)
        );
        if (crossings.length === 0) {
            const peak = Math.max(...points.map((p) => p.rating));
            return {
                error: `Never reached ${reachedRating} in the snapshots (from ${first}); the highest is ${peak}.`,
            };
        }
        const n = Number.isInteger(occurrence) && occurrence !== 0 ? occurrence : 1;
        const point = n < 0 ? crossings[crossings.length + n] : crossings[n - 1];
        if (!point) {
            return {
                error: `${reachedRating} was reached ${crossings.length} time(s), so there is no occurrence ${n}.`,
                crossings,
            };
        }
        return { point, crossings };
    }

    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
    if (!m) return { error: 'The date must be YYYY-MM-DD.' };
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    let point = null;
    for (const p of points) if (p.t <= t) point = p;
    if (!point) return { error: `The snapshots start on ${first}; there is none for ${date}.` };
    return { point };
}

async function getJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/**
 * The snapshot for `playerId` picked by { date } or { reachedRating, occurrence }:
 * { success, snapshot_date, snapshot_rating, snapshot_age_days, new, old },
 * or { success: false, error }.
 */
async function fetchPastSnapshot(playerId, { date, reachedRating, occurrence }) {
    const id = encodeURIComponent(playerId);
    let history;
    try {
        history = await getJson(`${API_URL}/users/${id}/top-history`);
    } catch (err) {
        return { success: false, error: `Could not read the snapshot history: ${err.message}` };
    }
    const { points } = dropGlitches(toDailyPoints(Array.isArray(history) ? history : []));
    const picked = pickDay(points, { date, reachedRating, occurrence });
    const reachedOn = picked.crossings?.map((p) => ({
        date: dayString(p.t).iso,
        rating: p.rating,
    }));
    if (picked.error) {
        return {
            success: false,
            error: picked.error,
            ...(reachedOn ? { reached_on: reachedOn } : {}),
        };
    }

    const day = dayString(picked.point.t);
    let record;
    try {
        record = await getJson(
            `${API_URL}/users/${id}/scores-by-date?date=${encodeURIComponent(day.stored)}`
        );
    } catch (err) {
        return { success: false, error: `Could not read the ${day.iso} snapshot: ${err.message}` };
    }
    const newPlays = Array.isArray(record?.new) ? record.new : [];
    const oldPlays = Array.isArray(record?.old) ? record.old : [];
    if (newPlays.length + oldPlays.length === 0) {
        return { success: false, error: `The ${day.iso} snapshot has no charts in it.` };
    }
    const today = new Date();
    return {
        success: true,
        snapshot_date: record.Date || day.stored,
        snapshot_rating: Number(record.rating) || picked.point.rating,
        snapshot_age_days: Math.round(
            (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - picked.point.t) /
                DAY
        ),
        new_version_top_plays: newPlays,
        old_version_top_plays: oldPlays,
        // Every day the rating was crossed, so the answer can say it happened more than once.
        ...(reachedOn && reachedOn.length > 1 ? { reached_on: reachedOn } : {}),
    };
}

module.exports = { fetchPastSnapshot, pickDay };
