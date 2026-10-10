// What one score on one chart would do to a player's rating: the chart's own
// rating, and whether it would enter their B15 / B35 — replacing which chart,
// for how much. Used for "is this a good score" on a result-screen screenshot
// (the model reads song, difficulty, type and achievement off the image and
// passes them here) and for "how much would 100.5 on X give me".
const { loadSongData } = require('../web/maimaiSongData');
const { lookupSong } = require('../web/songResolver');
const { findSheet, sheetLevel } = require('../web/maimaiChartLookup');
const { getSongRating } = require('../web/maimaiRatingMath');
const { loadSnapshot, chartKey } = require('../web/maimaiPlayerSnapshot');
const { versionKey, NEW_COUNT, OLD_COUNT } = require('../web/maimaiRatingTargets');

const declaration = {
    name: 'get_maimai_score_impact',
    description:
        "What one achievement on one chart is worth to a player: that chart's rating and rank, and what it does " +
        'to their best 50 — whether it enters the B15 (current version) or B35, which chart it pushes out, the ' +
        'net rating gain, or that their existing score on it is already better. Use it for a RESULT SCREEN ' +
        'screenshot ("is this a good score", "how much rating did I get"): read the song title, difficulty, ' +
        'DX/STD and achievement % off the image, then call this — and say which values you read so a misread ' +
        'can be caught. Also for "how much would X% on <song> give me". Leave player_name out for the tracked ' +
        "account (the bot owner's own); pass a friend's name otherwise. The AP bonus is not included.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: { type: 'string' },
            difficulty: {
                type: 'string',
                enum: ['basic', 'advanced', 'expert', 'master', 'remaster'],
            },
            chart_type: {
                type: 'string',
                enum: ['dx', 'std'],
                description: 'Needed when the song has both; a result screen shows it.',
            },
            achievement_percent: { type: 'number' },
            player_name: {
                type: 'string',
                description: "A friend's name; omit for the tracked account.",
            },
        },
        required: ['song_name', 'difficulty', 'achievement_percent'],
    },
};

async function execute(args) {
    const achievement = Number(args?.achievement_percent);
    if (!Number.isFinite(achievement) || achievement < 0 || achievement > 101) {
        return { success: false, error: 'achievement_percent must be between 0 and 101.' };
    }
    const chartType =
        args?.chart_type === 'dx' || args?.chart_type === 'std' ? args.chart_type : null;

    let songs;
    try {
        songs = (await loadSongData()).songs;
    } catch (err) {
        return { success: false, error: err.message };
    }
    const lookup = await lookupSong(songs, String(args?.song_name || '').trim());
    if (lookup.failure) return lookup.failure;
    const { song, matchedVia } = lookup;
    const found = findSheet(song, args?.difficulty, chartType);
    if (found.error) return { success: false, ...found };
    const constant = sheetLevel(found.sheet);
    if (constant == null)
        return { success: false, error: `No constant known for "${song.title}".` };
    const score = getSongRating(constant, achievement);

    const chart = {
        song: song.title,
        ...(matchedVia ? { matched_via: matchedVia } : {}),
        chart_type: found.sheet.type,
        difficulty: found.sheet.difficulty,
        constant,
        achievement,
        rank: score.rank,
        rating: score.rating,
    };

    const snapshot = await loadSnapshot(args?.player_name);
    if (!snapshot.success) {
        return { success: true, chart, best50: null, best50_error: snapshot.error };
    }

    // Which half it counts in: the B15 is the current version's songs, which the
    // snapshot's own B15 rows name.
    const newVersions = new Set(snapshot.newPlays.map((p) => versionKey(p.version)));
    const version = found.sheet.regionOverrides?.intl?.version || song.version;
    const isNew = newVersions.has(versionKey(version));
    const plays = isNew ? snapshot.newPlays : snapshot.oldPlays;
    const size = isNew ? NEW_COUNT : OLD_COUNT;
    const section = isNew ? 'B15' : 'B35';

    const key = chartKey(song.title, found.sheet.type, found.sheet.difficulty);
    const existing = plays.find((p) => chartKey(p.song, p.chartType, p.difficulty) === key);
    let impact;
    if (existing) {
        impact =
            existing.achievement >= achievement
                ? {
                      result: 'already_better',
                      existing_achievement: existing.achievement,
                      existing_rating: existing.rating,
                      rating_gain: 0,
                  }
                : {
                      result: 'improves_existing',
                      existing_achievement: existing.achievement,
                      existing_rating: existing.rating,
                      rating_gain: Math.max(0, score.rating - existing.rating),
                  };
    } else if (plays.length < size) {
        impact = { result: 'enters', replaces: null, rating_gain: score.rating };
    } else {
        const lowest = plays.reduce((min, p) => (p.rating < min.rating ? p : min));
        impact =
            score.rating > lowest.rating
                ? {
                      result: 'enters',
                      replaces: {
                          song: lowest.song,
                          difficulty: lowest.difficulty,
                          chart_type: lowest.chartType,
                          rating: lowest.rating,
                      },
                      rating_gain: score.rating - lowest.rating,
                  }
                : { result: 'does_not_enter', rating_to_beat: lowest.rating + 1, rating_gain: 0 };
    }

    return {
        success: true,
        chart,
        best50: {
            player: snapshot.player.name,
            section,
            ...impact,
            snapshot_date: snapshot.snapshotDate,
            ...(snapshot.stale ? { stale: true } : {}),
        },
        note:
            'Measured against the last nightly snapshot: a play made after it may already be counted in the game, ' +
            'and a chart outside the best 50 may have an older score that is unknown here.',
    };
}

module.exports = { declaration, execute };
