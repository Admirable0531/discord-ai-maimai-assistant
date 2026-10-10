// One player's best-50 snapshot (their B15 and B35), parsed into numbers. The
// slash commands that work from a rating breakdown (/compare, /target,
// /recommend) share this the way /b50 shares its tools — it is the same data,
// from the same two tools, with the rows turned from strings into values.
const { findPlayer } = require('./maimaiPlayers');
const getOwnTopScores = require('../tools/getMaimaiOwnTopScores');
const getFriendTopScores = require('../tools/getMaimaiFriendTopScores');
const { isStale } = require('../utils/snapshotAge');

/** A snapshot row ({Song, Chart, Level, Achv, Rating, Diff, Version}) with real numbers. */
function parsePlay(row) {
    return {
        song: row.Song,
        chartType: String(row.Chart || '').toLowerCase(), // 'dx' | 'std'
        difficulty: String(row.Diff || '').toLowerCase(),
        version: row.Version || null,
        level: parseFloat(row.Level),
        achievement: parseFloat(String(row.Achv).replace('%', '')),
        rating: parseInt(row.Rating, 10),
    };
}

/** Identifies a chart across the snapshot and the song data. */
function chartKey(song, chartType, difficulty) {
    return `${song.trim()}|${chartType}|${difficulty}`.toLowerCase();
}

/**
 * Resolves `playerName` (empty = the tracked account) to its snapshot:
 * { success: true, player, rating, newPlays, oldPlays, snapshotDate, ageDays, stale }
 * or { success: false, error, matches? } — the same failure shape the tools use,
 * so describeFailure() in commandHelpers can print it.
 */
async function loadSnapshot(playerName) {
    const found = await findPlayer(playerName).catch((err) => ({
        error: `Could not reach the maimai stats API: ${err.message}`,
    }));
    if (found.error) {
        return {
            success: false,
            error: found.error,
            ...(found.matches ? { matches: found.matches } : {}),
        };
    }
    const { player } = found;
    const data = player.isTracked
        ? await getOwnTopScores.execute()
        : await getFriendTopScores.execute({ friend_name: player.name });
    if (!data.success) return data;

    const newPlays = (data.new_version_top_plays || []).map(parsePlay);
    const oldPlays = (data.old_version_top_plays || []).map(parsePlay);
    if (newPlays.length + oldPlays.length === 0) {
        return { success: false, error: `${player.name} has no top-score snapshot yet.` };
    }
    return {
        success: true,
        player,
        rating: data.snapshot_rating,
        newPlays,
        oldPlays,
        snapshotDate: data.snapshot_date,
        ageDays: data.snapshot_age_days,
        stale: isStale(data.snapshot_date),
    };
}

/** The footer line telling the reader how old the numbers are. */
function freshnessNote(...snapshots) {
    const stale = snapshots.filter((s) => s.stale);
    if (stale.length === 0) return 'From the latest daily snapshot.';
    return `⚠️ Out of date: ${stale.map((s) => `${s.player.name} (${s.ageDays ?? '?'}d old)`).join(', ')}.`;
}

const sum = (plays) => plays.reduce((total, p) => total + (p.rating || 0), 0);

module.exports = { loadSnapshot, parsePlay, chartKey, freshnessNote, sum };
