const { fetchScoresByLevel, bestPerConstant } = require('../web/maimaiLevelScores');
const { loadCoverMap } = require('../web/maimaiCovers');
const { buildLevelScoresHtml, WIDTH } = require('../render/levelScoresCard');
const { drawCard } = require('../render/drawCard');

const declaration = {
    name: 'get_maimai_scores_by_level',
    description:
        'ALL of the tracked account\'s scores at one DISPLAYED level ("14", "14+", "13"…), each with its constant, AP/FC badge and rank, live from the Song Scores by Level page — the complete list, unlike the best 50. For "my best at 14+ / each constant", "how many SSS at 14", plate progress, or anything the best 50 would leave out. Ask for the displayed level: constants 14.0–14.5 are "14" and 14.6–14.9 "14+", so a question about 14.3 means level "14"; best_per_constant gives the best at each constant. If constants_available is false the constant source failed — say so rather than guessing. as_image: true draws the per-constant table.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            level: {
                type: 'string',
                description:
                    'The displayed level to read, e.g. "14+", "14", "13+". Not a constant like 14.3.',
            },
            as_image: {
                type: 'boolean',
                description:
                    'Also draw the per-constant table as an image and attach it to the reply (see the tool description).',
            },
            include_all_charts: {
                type: 'boolean',
                description:
                    'Include the full per-chart list as well as the per-constant bests. Defaults to false — a single level can hold well over a hundred charts, so only ask for this when the individual charts actually matter.',
            },
        },
        required: ['level'],
    },
};

/** Charts grouped by constant, hardest first: how many exist, how many are played, and the best score. */
function groupByConstant(rows) {
    const groups = new Map();
    for (const row of rows) {
        if (row.constant == null) continue;
        const key = row.constant.toFixed(1);
        const group = groups.get(key) || {
            constant: row.constant,
            total: 0,
            played: 0,
            best: null,
        };
        group.total++;
        if (row.achievement != null) {
            group.played++;
            if (!group.best || row.achievement > group.best.achievement) group.best = row;
        }
        groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.constant - a.constant);
}

async function addImage(result, rows, level, context) {
    const groups = groupByConstant(rows);
    if (groups.length === 0) {
        result.image_error = 'No constants were available to draw (mai-tools did not load).';
        return;
    }
    const covers = await loadCoverMap(groups.filter((g) => g.best).map((g) => g.best.song));
    const drawn = await drawCard(context, {
        html: buildLevelScoresHtml({
            level,
            totalCharts: rows.length,
            playedCharts: rows.filter((r) => r.achievement != null).length,
            constants: groups.map((g) => ({
                constant: g.constant,
                played: g.played,
                total: g.total,
                best: g.best && {
                    song: g.best.song,
                    difficulty: g.best.difficulty,
                    chartType: g.best.chart_type,
                    achievement: g.best.achievement,
                    apFc: g.best.ap_fc,
                    cover: covers.get(g.best.song),
                },
            })),
        }),
        width: WIDTH,
        filename: `scores-${level.replace('+', 'plus')}.png`,
    });
    if (drawn.ok) {
        result.image_attached = true;
        result.note =
            "The image is attached to your reply automatically and you can't see it — add a short comment from the data, and don't re-list the rows.";
    } else {
        result.image_error = drawn.error;
    }
}

async function execute(args, context) {
    const level = typeof args?.level === 'string' ? args.level.trim() : '';
    if (!level) return { success: false, error: 'level is required, e.g. "14+".' };

    try {
        const { rows, annotated, bucket } = await fetchScoresByLevel(level);
        const best = bestPerConstant(rows);

        const result = {
            success: true,
            level,
            level_bucket: bucket,
            chart_count: rows.length,
            constants_available: annotated,
            best_per_constant: best,
            ...(args?.include_all_charts === true ? { charts: rows } : {}),
        };
        if (args?.as_image === true) await addImage(result, rows, level, context);
        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { declaration, execute };
