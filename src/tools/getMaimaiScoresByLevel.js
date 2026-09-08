const { fetchScoresByLevel, bestPerConstant } = require('../web/maimaiLevelScores');

const declaration = {
    name: 'get_maimai_scores_by_level',
    description:
        "Get ALL of this tracked account's best scores at one displayed level (\"14+\", \"13\", …), each " +
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
        'best_per_constant is empty — say so rather than falling back to guessing constants.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            level: {
                type: 'string',
                description:
                    'The displayed level to read, e.g. "14+", "14", "13+". Not a constant like 14.3.',
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

async function execute(args) {
    const level = typeof args?.level === 'string' ? args.level.trim() : '';
    if (!level) return { success: false, error: 'level is required, e.g. "14+".' };

    try {
        const { rows, annotated, bucket } = await fetchScoresByLevel(level);
        const best = bestPerConstant(rows);

        return {
            success: true,
            level,
            level_bucket: bucket,
            chart_count: rows.length,
            constants_available: annotated,
            best_per_constant: best,
            ...(args?.include_all_charts === true ? { charts: rows } : {}),
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { declaration, execute };
