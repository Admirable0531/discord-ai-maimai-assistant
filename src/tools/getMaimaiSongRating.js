const { loadSongData } = require('../web/maimaiSongData');
const { findSheet, sheetLevel, isUtageSong } = require('../web/maimaiChartLookup');
const { getSongRating, findMinAchvForRating } = require('../web/maimaiRatingMath');

const declaration = {
    name: 'get_maimai_song_rating',
    description:
        "Calculate a single chart's DX Rating contribution — either forward (given an achievement %, what " +
        "rating does that chart give) or reverse (given a target rating, what's the minimum achievement % " +
        "needed on that chart). Uses the real internal level and maimai's actual rating formula, not a guess. " +
        "Pass exactly one of achievement_percent or target_rating. Note: this is one chart's rating in " +
        "isolation, not a player's overall profile rating (which is the sum of their best-N chart ratings, plus " +
        "+1 per All Perfect clear — this tool doesn't compute that aggregate).",
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
    const chartType = args?.chart_type === 'std' || args?.chart_type === 'dx' ? args.chart_type : null;

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

    const q = songQuery.toLowerCase();
    // 宴会場/UTAGE entries share titles with 65 real songs but hold only joke
    // charts (【宴】/【狂】/…), so leaving them in makes a normal lookup either
    // ambiguous or silently wrong. The difficulty enum here is always a
    // standard one, so they can never be what's meant.
    const songMatches = data.songs.filter(
        (s) => s.title.toLowerCase().includes(q) && !isUtageSong(s)
    );
    if (songMatches.length === 0) {
        return { success: false, error: `No song matching "${songQuery}" found.` };
    }
    let song = songMatches[0];
    if (songMatches.length > 1) {
        const exact = songMatches.find((s) => s.title.toLowerCase() === q);
        if (!exact) {
            return {
                success: false,
                error: `Multiple songs match "${songQuery}" — be more specific.`,
                matches: songMatches.slice(0, 10).map((s) => s.title),
            };
        }
        song = exact;
    }

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
