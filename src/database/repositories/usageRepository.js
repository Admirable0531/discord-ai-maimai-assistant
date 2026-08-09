const { sql } = require('drizzle-orm');
const { getDb } = require('../client');
const { aiUsage } = require('../schema');

function logUsage({ provider, model, promptTokens, completionTokens, costUsd = null }) {
    const db = getDb();
    db.insert(aiUsage)
        .values({
            provider,
            model,
            promptTokens: promptTokens || 0,
            completionTokens: completionTokens || 0,
            costUsd,
        })
        .run();
}

/**
 * Mirrors jap-bot's GET /api/ai-usage shape (see jap-bot's usageRoutes.js) so
 * the homelab dashboard's aggregator can merge both bots' responses without
 * per-bot special-casing.
 */
function getUsageSummary(days = 30) {
    const db = getDb();
    const sinceModifier = '-' + days + ' days';

    const totalsRow = db.get(sql`
        SELECT
            COUNT(*) AS request_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            SUM(cost_usd) AS cost_usd
        FROM ai_usage
        WHERE created_at >= datetime('now', ${sinceModifier})
    `);

    const byProviderRows = db.all(sql`
        SELECT
            provider,
            COUNT(*) AS request_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            SUM(cost_usd) AS cost_usd
        FROM ai_usage
        WHERE created_at >= datetime('now', ${sinceModifier})
        GROUP BY provider
        ORDER BY (prompt_tokens + completion_tokens) DESC
    `);

    const seriesRows = db.all(sql`
        SELECT
            date(created_at) AS date,
            provider,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            SUM(cost_usd) AS cost_usd
        FROM ai_usage
        WHERE created_at >= datetime('now', ${sinceModifier})
        GROUP BY date(created_at), provider
        ORDER BY date ASC
    `);

    return {
        bot: 'discord-ai-assistant',
        since: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        totals: {
            requestCount: totalsRow.request_count,
            promptTokens: totalsRow.prompt_tokens,
            completionTokens: totalsRow.completion_tokens,
            totalTokens: totalsRow.prompt_tokens + totalsRow.completion_tokens,
            costUsd: totalsRow.cost_usd,
        },
        byProvider: byProviderRows.map((row) => ({
            provider: row.provider,
            requestCount: row.request_count,
            promptTokens: row.prompt_tokens,
            completionTokens: row.completion_tokens,
            totalTokens: row.prompt_tokens + row.completion_tokens,
            costUsd: row.cost_usd,
        })),
        series: seriesRows.map((row) => ({
            date: row.date,
            provider: row.provider,
            promptTokens: row.prompt_tokens,
            completionTokens: row.completion_tokens,
            totalTokens: row.prompt_tokens + row.completion_tokens,
            costUsd: row.cost_usd,
        })),
    };
}

module.exports = { logUsage, getUsageSummary };
