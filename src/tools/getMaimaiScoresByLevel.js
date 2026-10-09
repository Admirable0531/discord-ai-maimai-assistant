const { fetchScoresByLevel, bestPerConstant } = require('../web/maimaiLevelScores');
const { loadCoverMap } = require('../web/maimaiCovers');
const { buildLevelScoresHtml, WIDTH } = require('../render/levelScoresCard');
const { drawCard } = require('../render/drawCard');

const declaration = {
    name: 'get_maimai_scores_by_level',
    description:
        'Get ALL of this tracked account\'s best scores at one displayed level ("14+", "13", …), each ' +
        "with its chart constant (定数 / internal level), read live off the account's own Song Scores by " +
        'Level page. This is the COMPLETE set of scores at that level — unlike get_maimai_own_top_scores, ' +
        'which is only the 50 charts currently feeding the rating and therefore silently missing most ' +
        'charts, especially at lower constants. Use this for "my best score at 14+/13/each constant", ' +
        '"how many SSS do I have at 14", plate/将牌 progress, or anything needing scores the rating ' +
        'breakdown would leave out. IMPORTANT: ask for a DISPLAYED level, not a constant — the game ' +
        'groups constants 14.0-14.5 under "14" and 14.6-14.9 under "14+", so a question about constant ' +
        '14.3 means fetching level "14" and reading the per-constant breakdown in the result. ' +
        'best_per_constant gives the highest achievement at each constant directly. ap_fc comes from the ' +
        "chart's actual AP/FC badge, so it is the only trustworthy way to say something is AP — never " +
        'infer AP from the achievement %% alone. If constants_available is false, mai-tools (the ' +
        'third-party script that supplies constants) failed to load, so every constant is null and ' +
        'best_per_constant is empty — say so rather than falling back to guessing constants. IMAGE: pass ' +
        'as_image: true when the user wants to SEE the table (show / post / a picture of it) — a card with the ' +
        'best score at every constant, cover art, rank, AP/FC badge and how many charts are played is attached ' +
        "to your reply automatically; you can't see it, so add a short comment and don't re-list the rows. It is " +
        'also the way to give a long per-constant table without writing it out.',
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
