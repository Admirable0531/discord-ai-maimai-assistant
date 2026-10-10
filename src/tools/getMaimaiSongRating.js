const { loadSongData } = require('../web/maimaiSongData');
const { findSheet, sheetLevel } = require('../web/maimaiChartLookup');
const { lookupSong } = require('../web/songResolver');
const { getSongRating, findMinAchvForRating } = require('../web/maimaiRatingMath');

const declaration = {
    name: 'get_maimai_song_rating',
    description:
        "One chart's rating from the real formula and constant: forward (achievement % -> rating) or reverse (target rating -> minimum achievement %). Pass exactly one of achievement_percent or target_rating. One chart in isolation — a player's rating is the sum of their best 50; for what a score does to a player's best 50, use get_maimai_score_impact.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: { type: 'string', description: 'Song title (partial match is fine).' },
            difficulty: {
                type: 'string',
                enum: ['basic', 'advanced', 'expert', 'master', 'remaster'],
                description: 'Chart difficulty.',
            },
            achievement_percent: {
                type: 'number',
                description:
                    'Forward direction: the achievement % to compute rating for, e.g. 100.9929.',
            },
            target_rating: {
                type: 'number',
                description:
                    'Reverse direction: the rating to find the minimum required achievement % for.',
            },
            chart_type: {
                type: 'string',
                enum: ['std', 'dx'],
                description:
                    'Which chart type, when the song has both. Most songs only have one, so omit it unless the tool comes back saying the two have different constants and asks which you meant.',
            },
        },
        required: ['song_name', 'difficulty'],
    },
};

async function execute(args) {
    const songQuery = typeof args?.song_name === 'string' ? args.song_name.trim() : '';
    const difficulty = typeof args?.difficulty === 'string' ? args.difficulty.toLowerCase() : '';
    const achv = typeof args?.achievement_percent === 'number' ? args.achievement_percent : null;
    const targetRating = typeof args?.target_rating === 'number' ? args.target_rating : null;
    const chartType =
        args?.chart_type === 'std' || args?.chart_type === 'dx' ? args.chart_type : null;

    if (!songQuery) return { success: false, error: 'song_name is required.' };
    if (!difficulty) return { success: false, error: 'difficulty is required.' };
    if (achv === null && targetRating === null) {
        return { success: false, error: 'Pass either achievement_percent or target_rating.' };
    }
    if (achv !== null && targetRating !== null) {
        return {
            success: false,
            error: 'Pass only one of achievement_percent or target_rating, not both.',
        };
    }

    let data;
    try {
        data = await loadSongData();
    } catch (err) {
        return { success: false, error: err.message };
    }

    // 宴会場/UTAGE entries share titles with 65 real songs but hold only joke
    // charts; the resolver leaves them out, since the difficulty here is always
    // a standard one.
    const lookup = await lookupSong(data.songs, songQuery);
    if (lookup.failure) return lookup.failure;
    const { song } = lookup;

    // Shared resolver rather than a bare sheets.find: std and dx charts of the
    // same song often carry different constants (71 of the 81 songs charted in
    // both), so an unqualified match can be over a point off. It reports the
    // ambiguity instead of picking — see maimaiChartLookup.js.
    const found = findSheet(song, difficulty, chartType);
    if (found.error) {
        return { success: false, ...found };
    }
    const sheet = found.sheet;
    const level = sheetLevel(sheet);
    if (level == null) {
        return {
            success: false,
            error: `No level data available for "${song.title}" (${difficulty}).`,
        };
    }

    const base = {
        success: true,
        song_title: song.title,
        difficulty,
        level: sheet.level,
        internal_level: sheet.internalLevel,
        level_used_for_calc: level,
    };

    if (achv !== null) {
        const result = getSongRating(level, achv);
        if (!result)
            return { ...base, success: false, error: `Invalid achievement percent: ${achv}` };
        return { ...base, achievement_percent: achv, rating: result.rating, rank: result.rank };
    }

    const result = findMinAchvForRating(level, targetRating);
    if (!result) {
        return {
            ...base,
            target_rating: targetRating,
            achievable: false,
            note: 'Not reachable even at 100.5% achievement on this chart.',
        };
    }
    return {
        ...base,
        target_rating: targetRating,
        achievable: true,
        min_achievement_percent: result.achv_needed,
        rank_at_that_achievement: result.rank,
    };
}

module.exports = { declaration, execute };
