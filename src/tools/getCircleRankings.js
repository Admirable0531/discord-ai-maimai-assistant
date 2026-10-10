const { config } = require('../config/env');
const { buildCircleHtml, WIDTH } = require('../render/circleCard');
const { drawCard } = require('../render/drawCard');
// See getFriendLeaderboard.js — same Express API, different endpoint.
const API_URL = config.tools.maimaiApiUrl;
const TIMEOUT_MS = 10000;

const declaration = {
    name: 'get_circle_rankings',
    description:
        'The circle (team) points leaderboard from maimai DX CiRCLE mode — circle name, points and rank, from ' +
        'the nightly snapshot. For "who is #1 circle", "what rank is <circle>". With `circle`, instead that ' +
        "circle's points day by day: rank, cumulative points and each day's gain (points earned that day) — for " +
        '"how much did <circle> earn each day / this week". Only the top 100 are stored, so a day outside it has ' +
        'no entry. as_image: true draws the leaderboard when they want to SEE it.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            limit: {
                type: 'integer',
                description: 'How many top circles to return (default 20, max 100).',
            },
            as_image: {
                type: 'boolean',
                description: 'Draw the leaderboard as a bar chart.',
            },
            circle: {
                type: 'string',
                description:
                    "One circle's name (partial match; full-width or plain) for its daily history.",
            },
            days: {
                type: 'integer',
                description: 'With circle: how many days back (default 30).',
            },
        },
    },
};

/** Local wall-clock "YYYY-MM-DD HH:mm" for a full ISO timestamp. */
function localStamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** One circle's daily rank, points and gain (see maimaiscrape's /api/circle-rankings/history). */
async function circleHistory(circle, days) {
    const query = new URLSearchParams({ circle, days: String(days) });
    const response = await fetch(`${API_URL}/api/circle-rankings/history?${query}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    if (!body.success) {
        return {
            success: false,
            error: body.error || `HTTP ${response.status}`,
            ...(body.matches ? { matches: body.matches } : {}),
        };
    }
    const gains = body.days.map((d) => d.gain).filter((g) => g != null);
    return {
        success: true,
        circle: body.circle,
        days: body.days.map((d) => ({
            date: d.date,
            rank: d.rank,
            points: d.points,
            gain: d.gain,
        })),
        total_gained: gains.reduce((a, b) => a + b, 0),
        average_per_day: gains.length
            ? Math.round(gains.reduce((a, b) => a + b, 0) / gains.length)
            : null,
        note: "gain is the points earned since the previous day's snapshot; the first day has none.",
    };
}

async function execute(args, context) {
    if (typeof args?.circle === 'string' && args.circle.trim()) {
        const days = Math.min(Math.max(Number(args?.days) || 30, 1), 365);
        try {
            return await circleHistory(args.circle.trim(), days);
        } catch (err) {
            return {
                success: false,
                error: `Could not reach the maimai stats API: ${err.message}`,
            };
        }
    }
    const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
    try {
        const response = await fetch(`${API_URL}/api/circle-rankings?limit=${limit}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.success) {
            return { success: false, error: body.error || `HTTP ${response.status}` };
        }
        const result = { success: true, scrapedAt: body.scrapedAt, rankings: body.rankings };
        if (args?.as_image === true && Array.isArray(body.rankings) && body.rankings.length > 0) {
            const drawn = await drawCard(context, {
                html: buildCircleHtml({
                    scrapedAt: localStamp(body.scrapedAt),
                    rankings: body.rankings,
                }),
                width: WIDTH,
                filename: 'circle-rankings.png',
            });
            if (drawn.ok) {
                result.image_attached = true;
                result.note =
                    "The image is attached to your reply automatically and you can't see it — add a short comment from the data, and don't re-list the rows.";
            } else {
                result.image_error = drawn.error;
            }
        }
        return result;
    } catch (err) {
        return { success: false, error: `Could not reach the maimai stats API: ${err.message}` };
    }
}

module.exports = { declaration, execute };
