// Where a player's next rating points are, from their best-50 snapshot. Shared
// by the /target and /recommend commands and the get_maimai_rating_targets tool,
// so the chat answer and the slash command can't disagree.
const { getSongRating, findMinAchvForRating } = require('./maimaiRatingMath');
const { chartKey } = require('./maimaiPlayerSnapshot');
const { isUtageSong } = require('./maimaiChartLookup');

const RATING_CAP = 100.5;
const NEW_COUNT = 15;
const OLD_COUNT = 35;
const DIFFICULTIES = new Set(['expert', 'master', 'remaster']);

/**
 * For each chart in the best 50: the achievement that would add one rating
 * point to it, and how far that is from the score now. Each chart's rating
 * counts straight into the total, so +1 on any of them is +1 overall — the
 * cheapest ones are where to spend the next attempts.
 */
function nextPointTargets(plays, section) {
    const targets = [];
    for (const play of plays) {
        const now = getSongRating(play.level, play.achievement);
        if (!now) continue;
        const next = findMinAchvForRating(play.level, now.rating + 1);
        if (!next || next.achv_needed > RATING_CAP) continue; // maxed out at this constant
        const gap = next.achv_needed - play.achievement;
        if (gap <= 0) continue;
        targets.push({ play, section, now: now.rating, needed: next.achv_needed, gap });
    }
    return targets;
}

/** "CiRCLE+" (rating pages) and "CiRCLE PLUS" (song data) are the same version. */
function versionKey(version) {
    return String(version || '')
        .toLowerCase()
        .replace(/\+/g, ' plus')
        .replace(/\s+/g, ' ')
        .trim();
}

/** The rating a new chart has to beat to enter this list: the lowest in it, or 0 while the list isn't full yet. */
function cutoff(plays, size) {
    return plays.length >= size ? Math.min(...plays.map((p) => p.rating)) : 0;
}

/**
 * Charts that would displace the lowest entry of the B15 / B35 at a score no
 * higher than `target`, skipping charts already in the best 50. The chart's own
 * score is unknown (only the best 50 is stored), so one the player has
 * already played below the cutoff can show up — it is "worth trying", not
 * "unplayed".
 */
function findCandidates(songs, snapshot, target) {
    const newVersions = new Set(snapshot.newPlays.map((p) => versionKey(p.version)));
    const inBest = new Set(
        [...snapshot.newPlays, ...snapshot.oldPlays].map((p) =>
            chartKey(p.song, p.chartType, p.difficulty)
        )
    );
    const cutoffs = {
        new: cutoff(snapshot.newPlays, NEW_COUNT),
        old: cutoff(snapshot.oldPlays, OLD_COUNT),
    };
    const found = { new: [], old: [] };

    for (const song of songs) {
        if (isUtageSong(song)) continue;
        for (const sheet of song.sheets || []) {
            const level = sheet.internalLevelValue;
            if (!DIFFICULTIES.has(sheet.difficulty) || !Number.isFinite(level)) continue;
            if (sheet.regions?.intl === false) continue; // the tracked account is on the international game
            if (inBest.has(chartKey(song.title, sheet.type, sheet.difficulty))) continue;

            const version = sheet.regionOverrides?.intl?.version || song.version;
            const section = newVersions.has(versionKey(version)) ? 'new' : 'old';
            const need = findMinAchvForRating(level, cutoffs[section] + 1);
            if (!need || need.achv_needed > target) continue;

            const atTarget = getSongRating(level, target)?.rating ?? 0;
            found[section].push({
                title: song.title,
                type: sheet.type,
                difficulty: sheet.difficulty,
                level,
                needed: need.achv_needed,
                gain: atTarget - cutoffs[section],
            });
        }
    }
    return { found, cutoffs };
}

module.exports = { nextPointTargets, findCandidates, versionKey, NEW_COUNT, OLD_COUNT };
