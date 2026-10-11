// How much achievement one Great / Good / Miss (or one break that isn't a
// Critical Perfect) costs on a given chart, from its real note counts. The
// scoring rule (confirmed against mai-tools' constants and the 判定全解 part 3
// article): the base score is 500 per tap, 1000 per hold, 500 per touch, 1500
// per slide track and 2500 per break; achievement is the earned base divided
// by the total base, plus a break bonus worth up to 1 percentage point shared
// equally between the chart's breaks. Regular notes score Perfect 100%, Great
// 80%, Good 50%, Miss 0; a break has its own table (maimaiScoreMath.js).
const { loadSongData } = require('../web/maimaiSongData');
const { lookupSong } = require('../web/songResolver');
const { findSheet } = require('../web/maimaiChartLookup');
const { BASE_SCORE_PER_TYPE, BREAK_TIERS, totalBaseScore } = require('../web/maimaiScoreMath');

const REGULAR_JUDGEMENTS = [
    ['great', 0.8],
    ['good', 0.5],
    ['miss', 0],
];
const REGULAR_TYPES = ['tap', 'hold', 'slide', 'touch'];
const RANK_LINES = [
    ['SSS+', 100.5],
    ['SSS', 100.0],
    ['SS+', 99.5],
    ['SS', 99.0],
];
const MAX_ACHIEVEMENT = 101;

const declaration = {
    name: 'get_maimai_judgement_loss',
    description:
        'How much achievement % one judgement costs on a specific chart, from its real note counts: for each note ' +
        'type (tap, hold, slide, touch) one Great / Good / Miss, and for a break each lower tier (Perfect-2 ' +
        'etc.), plus how many of each you can afford before dropping below SSS+ / SSS / SS+ / SS when everything ' +
        'else is a Critical Perfect. For "how much does one break/Great cost", "how many Greats until I lose SSS+", ' +
        '"how much % is one Good on a tap". A slide counts as one note (its star head is a tap). DX score is a ' +
        'separate system and is not covered. Pass chart_type when the song has both DX and standard.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: { type: 'string' },
            difficulty: {
                type: 'string',
                enum: ['basic', 'advanced', 'expert', 'master', 'remaster'],
            },
            chart_type: { type: 'string', enum: ['dx', 'std'] },
        },
        required: ['song_name', 'difficulty'],
    },
};

const round4 = (n) => Math.round(n * 10000) / 10000;

/** Loss in percentage points for one regular note of `type` scoring `multiplier` of its base. */
function regularLoss(type, multiplier, total) {
    return ((1 - multiplier) * BASE_SCORE_PER_TYPE[type] * 100) / total;
}

/** Loss for one break at a tier: the base it forfeits plus the bonus share it forfeits. */
function breakLoss(tier, total, breakCount) {
    const baseMultiplier = tier.base;
    const bonusMultiplier = tier.bonus;
    return (
        ((1 - baseMultiplier) * BASE_SCORE_PER_TYPE.break * 100) / total +
        (1 - bonusMultiplier) / breakCount
    );
}

async function execute(args) {
    const difficulty = String(args?.difficulty || '').toLowerCase();
    const chartType =
        args?.chart_type === 'std' || args?.chart_type === 'dx' ? args.chart_type : null;

    let songs;
    try {
        songs = (await loadSongData()).songs;
    } catch (err) {
        return { success: false, error: err.message };
    }
    const lookup = await lookupSong(songs, String(args?.song_name || '').trim());
    if (lookup.failure) return lookup.failure;
    const { song, matchedVia } = lookup;
    const found = findSheet(song, difficulty, chartType);
    if (found.error) return { success: false, ...found };

    const counts = found.sheet.noteCounts;
    const total = counts ? totalBaseScore(counts) : 0;
    if (!counts || total <= 0) {
        return {
            success: false,
            error: `No note counts are known for "${song.title}" (${difficulty}).`,
        };
    }
    const breaks = counts.break || 0;

    const rows = [];
    const add = (note, judgement, loss) => {
        const allowed = Object.fromEntries(
            RANK_LINES.map(([rank, line]) => [
                rank,
                Math.floor((MAX_ACHIEVEMENT - line) / loss + 1e-9),
            ])
        );
        rows.push({
            note,
            judgement,
            loss_percent: round4(loss),
            max_before_dropping_below: allowed,
        });
    };
    for (const type of REGULAR_TYPES) {
        if (!counts[type]) continue;
        for (const [judgement, multiplier] of REGULAR_JUDGEMENTS) {
            add(type, judgement, regularLoss(type, multiplier, total));
        }
    }
    if (breaks > 0) {
        for (const tier of BREAK_TIERS.slice(1))
            add('break', tier.label, breakLoss(tier, total, breaks));
    }

    return {
        success: true,
        song: song.title,
        ...(matchedVia ? { matched_via: matchedVia } : {}),
        chart_type: found.sheet.type,
        difficulty: found.sheet.difficulty,
        note_counts: {
            tap: counts.tap || 0,
            hold: counts.hold || 0,
            slide: counts.slide || 0,
            touch: counts.touch || 0,
            break: breaks,
            total: counts.total ?? null,
        },
        max_achievement: MAX_ACHIEVEMENT,
        losses: rows,
        notes: [
            'loss_percent is in percentage points of achievement, for ONE note, with everything else a Critical Perfect.',
            'max_before_dropping_below is how many of that single kind you can have before the rank line is lost.',
            'A break at Perfect-1 (the 2550 tier) already loses a little bonus; only a Critical Perfect (2600) loses nothing.',
        ],
    };
}

module.exports = { declaration, execute, regularLoss, breakLoss };
