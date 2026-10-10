// Talks to the existing Express API (server/express_server.js) in the
// maimaiscrape repo, not a database this bot owns — that server already
// knows the MongoDB schema and does the same read the /latestfriendsleaderboard
// slash command in Discord_Bot uses, just as JSON.
const { ageInDays, isStale, formatSnapshotStamp } = require('../utils/snapshotAge');
const { buildLeaderboardHtml, WIDTH } = require('../render/leaderboardCard');
const { drawCard } = require('../render/drawCard');
const { fetchUsers, TRACKED_ID } = require('../web/maimaiPlayers');
const { normalizeName } = require('../web/maimaiFriendLookup');
const { config } = require('../config/env');

const API_URL = config.tools.maimaiApiUrl;
const TIMEOUT_MS = 10000;

const declaration = {
    name: 'get_friend_leaderboard',
    description:
        "Get the current maimai DX rating leaderboard for one tracked account's in-game friend list — each " +
        'friend\'s name, rating, and rank. There are TWO separate real accounts tracked, "fy" and "main", each ' +
        'with their own distinct ~40-friend list — a friend on one is very often NOT on the other. account_type ' +
        'defaults to "fy" if omitted, so never assume that\'s the right pool: if the user says "main account" ' +
        'call with account_type: "main"; if you\'re searching for one specific friend by name and don\'t know ' +
        "which account tracks them, call this tool twice (once per account_type) before concluding they're not " +
        'found — do not report "not found" after checking only one. Names on this leaderboard are often written ' +
        'in full-width Unicode characters (e.g. "Ｍｉｎｊｉｎ") — treat those as the same name as their plain-ASCII ' +
        'equivalent ("minjin") when matching, don\'t treat the different character width as a non-match. Use this ' +
        'for questions like "what is X\'s rating", "who has the highest rating", "is X a friend", or "top N ' +
        'friends". This is tracked data, not something to guess or look up on the web. FRESHNESS: this is the ' +
        'most recent nightly snapshot, which is not always recent — check snapshot_age_days and is_stale on ' +
        'every call. When is_stale is true the ratings and ranks are genuinely out of date (the scrape has been ' +
        'failing), so state the snapshot date plainly instead of presenting the numbers as current, and never ' +
        'describe a stale rank as someone\'s standing "now". If the asker is ' +
        "themselves one of the tracked friends, check search_memory first in case they've told you their in-game name before. " +
        'IMAGE: pass as_image: true when the user wants to SEE the leaderboard (show / post / send / a picture or ' +
        "card of it) — a ranked chart is attached to your reply automatically; you can't see it, so add a short " +
        'comment from the data and don\'t re-list the rows. Leave it off for a specific lookup ("what is X\'s rating").',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            account_type: {
                type: 'string',
                enum: ['fy', 'main'],
                description:
                    'Which tracked account\'s friend list to read — "fy" or "main" (default "fy" if omitted; these are two different friend lists, see the tool description).',
            },
            as_image: {
                type: 'boolean',
                description:
                    'Also draw the leaderboard as an image and attach it to the reply (see the tool description).',
            },
            top_n: {
                type: 'integer',
                description:
                    "With as_image: how many of the top friends to draw (default 25, max 60). The image is read on a phone, so keep it short unless the user asks for everyone; the asker's own row is always added.",
            },
        },
    },
};

async function execute(args, context) {
    const accountType = args?.account_type === 'main' ? 'main' : 'fy';
    try {
        const response = await fetch(
            `${API_URL}/api/friends-leaderboard?accountType=${accountType}`,
            {
                signal: AbortSignal.timeout(TIMEOUT_MS),
            }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.success) {
            return { success: false, error: body.error || `HTTP ${response.status}` };
        }
        const ageDays = ageInDays(body.snapshotDate);
        const stale = isStale(body.snapshotDate);

        const result = {
            success: true,
            accountType: body.accountType,
            snapshotDate: body.snapshotDate,
            snapshot_age_days: ageDays,
            is_stale: stale,
            ...(stale
                ? {
                      staleness_warning:
                          `These ratings are from ${body.snapshotDate || 'an unknown date'}` +
                          (ageDays !== null ? ` — ${ageDays} days old` : ' — age unknown') +
                          `. The nightly scrape for the "${body.accountType}" account has not run since ` +
                          'then, so these are NOT current ratings or ranks. Say so explicitly when you ' +
                          'use them, and give the date rather than presenting them as up to date.',
                  }
                : {}),
            friends: body.friends,
        };
        if (args?.as_image === true)
            await addImage(result, body, ageDays, stale, context, args?.top_n);
        return result;
    } catch (err) {
        return { success: false, error: `Could not reach the maimai stats API: ${err.message}` };
    }
}

/**
 * Draws the card for `result` and notes it there. The tracked account's own
 * row (it sits on the fy list) is marked "you". A failure to draw leaves the
 * data intact and says why.
 */
async function addImage(result, body, ageDays, stale, context, topN) {
    const friends = Array.isArray(body.friends) ? body.friends : [];
    if (friends.length === 0) {
        result.image_error = 'There are no friends in this snapshot to draw.';
        return;
    }
    let highlightIndex = -1;
    try {
        const self = (await fetchUsers()).find((u) => u.user === TRACKED_ID);
        if (self?.name) {
            highlightIndex = friends.findIndex(
                (f) => normalizeName(f.name) === normalizeName(self.name)
            );
        }
    } catch {
        // No highlight is fine.
    }
    const drawn = await drawCard(context, {
        html: buildLeaderboardHtml({
            accountLabel: body.accountType,
            snapshotDate: formatSnapshotStamp(body.snapshotDate),
            ageDays,
            stale,
            friends,
            highlightIndex,
            maxRows: Number.isInteger(topN) ? Math.min(Math.max(topN, 1), 60) : undefined,
        }),
        width: WIDTH,
        filename: `leaderboard-${body.accountType}.png`,
    });
    if (drawn.ok) {
        result.image_attached = true;
        result.note =
            "The image is attached to your reply automatically and you can't see it — add a short comment from the data, and don't re-list the rows.";
    } else {
        result.image_error = drawn.error;
    }
}

module.exports = { declaration, execute };
