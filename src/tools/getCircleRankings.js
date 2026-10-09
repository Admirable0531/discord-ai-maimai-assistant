const { config } = require('../config/env');
const { buildCircleHtml, WIDTH } = require('../render/circleCard');
const { drawCard } = require('../render/drawCard');
// See getFriendLeaderboard.js — same Express API, different endpoint.
const API_URL = config.tools.maimaiApiUrl;
const TIMEOUT_MS = 10000;

const declaration = {
    name: 'get_circle_rankings',
    description:
        'Get the latest circle (team) points leaderboard from maimai DX CiRCLE mode — circle name, points, ' +
        'and rank. Use this for questions like "who is #1 circle" or "what rank is [circle name]". This is ' +
        'live tracked data, not something to guess or look up on the web. IMAGE: pass as_image: true when the ' +
        'user wants to SEE the ranking (show / post / a picture or chart) — a bar chart is attached to your ' +
        "reply automatically; you can't see it, so add a short comment from the data and don't re-list the rows.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            limit: {
                type: 'integer',
                description: 'How many top circles to return (default 20, max 100).',
            },
            as_image: {
                type: 'boolean',
                description:
                    'Also draw the ranking as a bar chart and attach it to the reply (see the tool description).',
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

async function execute(args, context) {
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
