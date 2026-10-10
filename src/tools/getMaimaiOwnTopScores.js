// Same data source and shape as getMaimaiFriendTopScores.js, but for the
// tracked account itself: server/update_user_data.js's nightly Puppeteer
// scraper already opens THIS account's own "Analyze Rating" page (via the
// mai-tools bookmarklet) in the exact same run it does for friends, and
// stores the result as the 'ryan_top' collection, served at
// /users/ryan/top-score. get_maimai_friend_top_scores can never return this
// account's own data — its friend lookup explicitly excludes user id
// 'ryan' (you can't be your own friend on maimai) — so this is the only
// path to the tracked account's real B15/B35 breakdown, and it needed no
// new scraping at all, just reading data that was already being collected.
const { normalizeName } = require('../web/maimaiFriendLookup');
const { ageInDays } = require('../utils/snapshotAge');
const { config } = require('../config/env');

const API_URL = config.tools.maimaiApiUrl;
const TIMEOUT_MS = 15000;

const declaration = {
    name: 'get_maimai_own_top_scores',
    description:
        'The tracked account\'s own best 50 (B15 new_version_top_plays + B35 old_version_top_plays, each with Song/Chart/Level/Achv/Rank/Rating) and snapshot_rating, from SEGA\'s rating-breakdown page, scraped daily. current_rating is checked independently; if it differs from snapshot_rating or snapshot_age_days is large, say the list may be outdated, and if current_rating_source is "unavailable" say freshness couldn\'t be verified. For "my B50 / my highest rated play" about the tracked account (get_maimai_friend_top_scores can never return it). Only the 50 charts that count: a chart missing here is not unplayed — for scores at a level or constant use get_maimai_scores_by_level.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

/**
 * The 'ryan' /users entry and the top-score snapshot are written together
 * by the same update_user_data.js run, so /users' own `rating` field can
 * never independently confirm the snapshot isn't stale (see the identical
 * issue and longer explanation in getMaimaiFriendTopScores.js). This
 * account shows up as a friend on the FY account's own friend list though
 * (confirmed live), and that leaderboard is updated reliably every day by
 * a separate scraper — so it's used as the independent live-rating source
 * here, matched by this account's display name from /users.
 */
async function fetchLiveRating(selfName) {
    if (!selfName) return null;
    const response = await fetch(`${API_URL}/api/friends-leaderboard?accountType=fy`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    if (!body?.success || !Array.isArray(body.friends)) return null;
    const target = normalizeName(selfName);
    const match = body.friends.find((f) => normalizeName(f.name) === target);
    return match && match.rating != null ? match.rating : null;
}

async function execute() {
    try {
        const usersResponse = await fetch(`${API_URL}/users`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!usersResponse.ok) throw new Error(`HTTP ${usersResponse.status} from /users`);
        const users = await usersResponse.json();
        const self = users.find((u) => u.user === 'ryan');

        const response = await fetch(`${API_URL}/users/ryan/top-score`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status === 404) {
            return {
                success: false,
                error: 'No top-score snapshot has ever been recorded for this account.',
            };
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || `HTTP ${response.status}` };
        }

        // Stored dates are day-first ("09/10/2026" is 9 October). This used to have
        // its own parser that handed them to new Date(), which reads them
        // month-first, so every snapshot looked a month older than it was.
        const snapshotAgeDays = ageInDays(body.Date);

        const liveRating = await fetchLiveRating(self?.name).catch(() => null);

        return {
            success: true,
            current_rating: liveRating,
            current_rating_source: liveRating != null ? 'daily_friend_leaderboard' : 'unavailable',
            snapshot_date: body.Date || null,
            snapshot_age_days: snapshotAgeDays,
            snapshot_rating: body.rating ?? null,
            // The rating SEGA itself displayed on that run; when it differs from
            // snapshot_rating (the breakdown's own total), the breakdown is
            // probably missing a recent play.
            sega_rating: body.sega_rating ?? null,
            new_version_top_plays: body.new || [],
            old_version_top_plays: body.old || [],
        };
    } catch (err) {
        return { success: false, error: `Could not reach the maimai stats API: ${err.message}` };
    }
}

module.exports = { declaration, execute };
