// See getFriendLeaderboard.js — same Express API, different endpoint, and the
// same caveat: this is the newest STORED snapshot, scraped once a day at
// 06:30 MYT, not the ranking page read when the question is asked.
const { snapshotAgeDays } = require('../utils/snapshotAge');

const API_URL = process.env.MAIMAI_API_URL || 'http://localhost:3000';
const TIMEOUT_MS = 10000;

const declaration = {
    name: 'get_circle_rankings',
    description:
        'Get the latest circle (team) points leaderboard from maimai DX CiRCLE mode — circle name, points, ' +
        'and rank. Use this for questions like "who is #1 circle" or "what rank is [circle name]". This is ' +
        'tracked data, not something to guess or look up on the web, but it is a STORED SNAPSHOT scraped ' +
        'once a day, not the page read when you ask: the result carries scrapedAt and snapshot_age_days, and ' +
        'when snapshot_age_days is 1 or more say when the points were measured instead of calling them ' +
        'current. Only the last 7 days of snapshots are kept, so per-day history beyond that does not exist.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            limit: {
                type: 'integer',
                description: 'How many top circles to return (default 20, max 100).',
            },
        },
    },
};

async function execute(args) {
    const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
    try {
        const response = await fetch(`${API_URL}/api/circle-rankings?limit=${limit}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.success) {
            return { success: false, error: body.error || `HTTP ${response.status}` };
        }
        return {
            success: true,
            scrapedAt: body.scrapedAt,
            snapshot_age_days: snapshotAgeDays(body.scrapedAt),
            rankings: body.rankings,
        };
    } catch (err) {
        return { success: false, error: `Could not reach the maimai stats API: ${err.message}` };
    }
}

module.exports = { declaration, execute };
