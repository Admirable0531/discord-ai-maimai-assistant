// Talks to the existing Express API (server/express_server.js) — same /users
// and /users/:id/top-score endpoints server/update_user_data.js's daily
// scrape writes (via the mai-tools bookmarklet's "Analyze Rating" click-
// through on SEGA's own site, see that file's getTopScore()). No live
// browser session needed here, just reading what that pipeline already saved.
const { normalizeName } = require('../web/maimaiFriendLookup');
const { ageInDays, isStale } = require('../utils/snapshotAge');

const API_URL = process.env.MAIMAI_API_URL || 'http://localhost:3000';
const TIMEOUT_MS = 15000;

const declaration = {
    name: 'get_maimai_friend_top_scores',
    description:
        "Get one of this tracked account's friends' REAL best-scoring charts and total rating, straight off " +
        "SEGA's own rating-breakdown page for that friend (the same page the maimai bookmarklet's \"Analyze " +
        'Rating" opens) — not a guess assembled from sampling a few charts. Returns two lists (new_version_top_plays ' +
        "and old_version_top_plays, matching the game's own rating-split categories, each entry with Song/Chart/" +
        'Level/Achv/Rank/Rating) plus snapshot_rating, their total rating AT THE TIME OF THAT SNAPSHOT. IMPORTANT: ' +
        'this snapshot comes from a daily scraper that does not run reliably for every friend — snapshot_age_days ' +
        'can be months or even years for some friends. current_rating is cross-checked against the friend-list ' +
        'leaderboard, which is written by a separate job — but that job can ALSO be broken, so neither number is ' +
        'automatically the current one. Read current_rating_source: "daily_friend_leaderboard" means the ' +
        'cross-check is recent and current_rating can be treated as their rating now; "stale_friend_leaderboard" ' +
        'means that leaderboard has not run in a long time and current_rating is NOT their rating now (its age is ' +
        'in current_rating_age_days, its date in current_rating_date); "unavailable" means the friend was not ' +
        'found there and current_rating is null. freshest_rating_source names which of the two numbers is ' +
        'actually more recent, and any freshness_warnings spell out what is wrong — follow them, and never ' +
        "present a stale rating or rank as someone's standing right now. Do NOT treat an old snapshot as current " +
        'just because you have nothing to compare it to; surface snapshot_age_days and say plainly that ' +
        "freshness could not be verified. Use this for \"what's Y's " +
        'highest rated play / best scores" — get_maimai_friend_scores answers a narrower but always-fresh ' +
        'question (one difficulty constant at a time), and get_maimai_song_ranking answers a different direction ' +
        "entirely (who's best on one song, not one friend's best charts).",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            friend_name: {
                type: 'string',
                description:
                    "The friend's name (partial match is fine, full-width or plain ASCII both work).",
            },
        },
        required: ['friend_name'],
    },
};

async function findFriend(friendName) {
    const response = await fetch(`${API_URL}/users`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status} from /users`);
    const users = await response.json();

    const target = normalizeName(friendName);
    const friends = users.filter((u) => u.user !== 'ryan' && u.name);
    const exact = friends.find((u) => normalizeName(u.name) === target);
    if (exact) return exact;
    const substring = friends.filter((u) => normalizeName(u.name).includes(target));
    if (substring.length === 1) return substring[0];
    if (substring.length > 1) return { ambiguous: substring.map((u) => u.name) };
    return null;
}

/**
 * The top-score snapshot and /users' own `rating` field are written together
 * by the SAME update_user_data.js run (see insertFriendUserInfo + getTopScore
 * in that file) — so comparing snapshot_rating against /users' rating can
 * never detect staleness, since a scraper run that hasn't fired in months
 * writes both numbers identically stale, every time. The friend-list
 * leaderboard (friend_rating_daily_snapshots / _main, written by the separate
 * discord-bot friend-list scraper) is written independently, so it's the only
 * cross-check available here. All of this account's friend_<idx>_top entries
 * come from its "main" friend-list scrape specifically (confirmed against
 * collectionNames.js / update_user_data.js), so "main" is the correct
 * leaderboard to check regardless of which name was searched.
 *
 * What this function must NOT do is assume that leaderboard is current. It was
 * previously treated as reliably daily and its rating returned as
 * `current_rating` unconditionally — but the "main" scrape has failed every
 * night since 2026-03-18, so it served ratings ~6 months old while the
 * 2-day-old top-score snapshot beside it was the fresher number. That inverted
 * the whole check: the stale value was labelled current and the fresh one
 * flagged as suspect. The leaderboard's own age now comes back with it so the
 * caller can tell which of the two is actually more recent.
 */
async function fetchLeaderboardRating(friendName) {
    const response = await fetch(`${API_URL}/api/friends-leaderboard?accountType=main`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    if (!body?.success || !Array.isArray(body.friends)) return null;
    const target = normalizeName(friendName);
    const match = body.friends.find((f) => normalizeName(f.name) === target);
    if (!match || match.rating == null) return null;
    return {
        rating: match.rating,
        snapshotDate: body.snapshotDate ?? null,
        ageDays: ageInDays(body.snapshotDate),
    };
}

async function execute(args) {
    const friendName = typeof args?.friend_name === 'string' ? args.friend_name.trim() : '';
    if (!friendName) return { success: false, error: 'friend_name is required.' };

    try {
        const friend = await findFriend(friendName);
        if (!friend) {
            return {
                success: false,
                error: `No friend matching "${friendName}" found on this account's friend list.`,
            };
        }
        if (friend.ambiguous) {
            return {
                success: false,
                error: `Multiple friends match "${friendName}" — be more specific.`,
                matches: friend.ambiguous,
            };
        }

        const response = await fetch(`${API_URL}/users/${friend.user}/top-score`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status === 404) {
            return {
                success: false,
                error: `No top-score snapshot has ever been recorded for ${friend.name}.`,
            };
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || `HTTP ${response.status}` };
        }

        const snapshotAgeDays = ageInDays(body.Date);

        const leaderboard = await fetchLeaderboardRating(friend.name).catch(() => null);
        const leaderboardStale = leaderboard ? isStale(leaderboard.snapshotDate) : true;
        // Which of the two independently-written numbers is actually more
        // recent. Either can be the stale one, so this is compared rather than
        // assumed — that assumption is exactly what broke before.
        const leaderboardIsFresher =
            leaderboard &&
            leaderboard.ageDays !== null &&
            (snapshotAgeDays === null || leaderboard.ageDays <= snapshotAgeDays);

        let currentRatingSource;
        if (!leaderboard) currentRatingSource = 'unavailable';
        else if (leaderboardStale) currentRatingSource = 'stale_friend_leaderboard';
        else currentRatingSource = 'daily_friend_leaderboard';

        const warnings = [];
        if (leaderboard && leaderboardStale) {
            warnings.push(
                `The friend leaderboard used to cross-check this is itself ${
                    leaderboard.ageDays !== null
                        ? `${leaderboard.ageDays} days old`
                        : 'of unknown age'
                } (${leaderboard.snapshotDate || 'no date'}), because the nightly "main" friend-list scrape ` +
                    "has been failing. Do not present current_rating as this friend's rating right now."
            );
        }
        if (leaderboard && !leaderboardIsFresher && snapshotAgeDays !== null) {
            warnings.push(
                `current_rating (${leaderboard.rating}) is OLDER than snapshot_rating (${
                    body.rating ?? 'unknown'
                }): the leaderboard is ${leaderboard.ageDays} days old versus the top-score snapshot's ` +
                    `${snapshotAgeDays}. The snapshot is the more recent of the two here — do not describe ` +
                    'the leaderboard number as the up-to-date one.'
            );
        }

        return {
            success: true,
            friend_name: friend.name,
            current_rating: leaderboard ? leaderboard.rating : null,
            current_rating_source: currentRatingSource,
            current_rating_age_days: leaderboard ? leaderboard.ageDays : null,
            current_rating_date: leaderboard ? leaderboard.snapshotDate : null,
            snapshot_date: body.Date || null,
            snapshot_age_days: snapshotAgeDays,
            snapshot_rating: body.rating ?? null,
            freshest_rating_source: leaderboardIsFresher
                ? 'friend_leaderboard'
                : 'top_score_snapshot',
            ...(warnings.length > 0 ? { freshness_warnings: warnings } : {}),
            new_version_top_plays: body.new || [],
            old_version_top_plays: body.old || [],
        };
    } catch (err) {
        return { success: false, error: `Could not reach the maimai stats API: ${err.message}` };
    }
}

module.exports = { declaration, execute };
