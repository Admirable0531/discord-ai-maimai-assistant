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
        'The DX Rating leaderboard of one tracked account\'s friend list: each friend\'s name, rating and rank. Two accounts are tracked, "fy" (the default) and "main", with different friend lists — use "main" when the user says so, and when looking for one person whose list you don\'t know, check both before saying they aren\'t there. Names are often full-width ("Ｍｉｎｊｉｎ" is "minjin"). For "what is X\'s rating", "who\'s highest", "is X a friend", "top N". It is the last nightly snapshot: when is_stale is true, give the snapshot date and don\'t present the ranks as current. If the asker may be on the list, check their memories for their in-game name. as_image: true when they want to SEE it, not for a single lookup.',
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
