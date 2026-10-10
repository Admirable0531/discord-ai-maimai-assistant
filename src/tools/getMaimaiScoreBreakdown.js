const { loadSongData } = require('../web/maimaiSongData');
const { findSheet } = require('../web/maimaiChartLookup');
const { lookupSong } = require('../web/songResolver');
const { findApBreakdown } = require('../web/maimaiScoreMath');

const declaration = {
    name: 'get_maimai_score_breakdown',
    description:
        "Whether an achievement % (e.g. 100.9929) is possible as an AP — every note Perfect or better — on one chart, from its real note counts and the scoring formula, and if so the exact break judgments (Critical Perfect / high Perfect / low Perfect) that produce it, plus the chart's AP range (100.5–101% with breaks, exactly 100% without). Pure-AP scores only: if the target isn't a valid AP, say so rather than guessing a Great/Good/Miss combination.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: { type: 'string', description: 'Song title (partial match is fine).' },
            difficulty: {
                type: 'string',
                enum: ['basic', 'advanced', 'expert', 'master', 'remaster'],
                description: 'Chart difficulty to check.',
            },
            target_percent: {
                type: 'number',
                description: 'The achievement percentage to check, e.g. 100.9929.',
            },
        },
        required: ['song_name', 'difficulty', 'target_percent'],
    },
};

async function execute(args) {
    const songQuery = typeof args?.song_name === 'string' ? args.song_name.trim() : '';
    const difficulty = typeof args?.difficulty === 'string' ? args.difficulty.toLowerCase() : '';
    const targetPercent = typeof args?.target_percent === 'number' ? args.target_percent : null;

    if (!songQuery) return { success: false, error: 'song_name is required.' };
    if (!difficulty) return { success: false, error: 'difficulty is required.' };
    if (targetPercent === null || Number.isNaN(targetPercent))
        return { success: false, error: 'target_percent is required.' };

    let data;
    try {
        data = await loadSongData();
    } catch (err) {
        return { success: false, error: err.message };
    }

    // UTAGE namesakes are left out by the resolver: they carry only joke charts,
    // never the standard difficulty asked for here.
    const found = await lookupSong(data.songs, songQuery);
    if (found.failure) return found.failure;
    return checkChart(found.song, difficulty, targetPercent);
}

function checkChart(song, difficulty, targetPercent) {
    // Via the shared resolver: std and dx charts of one song can differ in
    // note counts as well as constant, so this surfaces the ambiguity rather
    // than silently taking whichever sheet came first.
    const found = findSheet(song, difficulty);
    if (found.error) {
        return { success: false, ...found };
    }
    const sheet = found.sheet;
    if (!sheet.noteCounts) {
        return {
            success: false,
            error: `No note-count data available for "${song.title}" (${difficulty}).`,
        };
    }

    const noteCounts = sheet.noteCounts;
    const breakdown = findApBreakdown(noteCounts, targetPercent);

    if (!breakdown) {
        const fallbackRange =
            noteCounts.break > 0
                ? { min_ap_percent: 100.5, max_ap_percent: 101 }
                : { min_ap_percent: 100, max_ap_percent: 100 };
        return {
            success: true,
            song_title: song.title,
            difficulty,
            level: sheet.level,
            internal_level: sheet.internalLevel,
            note_counts: noteCounts,
            target_percent: targetPercent,
            is_achievable_ap: false,
            ...fallbackRange,
            note: 'Not achievable as a pure AP on this chart (either outside the possible AP range, or this exact value does not land on the achievable step grid). This does not rule out a score that includes Great/Good/Miss judgments — that combination space is not searched by this tool.',
        };
    }

    return {
        success: true,
        song_title: song.title,
        difficulty,
        level: sheet.level,
        internal_level: sheet.internalLevel,
        note_counts: noteCounts,
        target_percent: targetPercent,
        is_achievable_ap: true,
        exact_percent: Number(breakdown.exactPercent.toFixed(6)),
        break_breakdown: {
            critical_perfect: breakdown.cp,
            perfect_high_window: breakdown.hp,
            perfect_low_window: breakdown.lp,
            total_breaks: noteCounts.break,
        },
        min_ap_percent: breakdown.minApPercent,
        max_ap_percent: breakdown.maxApPercent,
    };
}

module.exports = { declaration, execute };
