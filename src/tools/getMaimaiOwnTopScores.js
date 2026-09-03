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

const API_URL = process.env.MAIMAI_API_URL || 'http://localhost:3000';
const TIMEOUT_MS = 15000;

const declaration = {
    name: 'get_maimai_own_top_scores',
    description:
        "Get this tracked account's OWN real best-scoring charts and total rating, straight off SEGA's " +
        "rating-breakdown page (same source and shape as get_maimai_friend_top_scores, just for the " +
        'tracked account itself rather than one of its friends — that tool can never return this data, ' +
        'since its friend lookup specifically excludes this account). Returns two lists ' +
        "(new_version_top_plays and old_version_top_plays, matching the game's own rating-split " +
        'categories, each entry with Song/Chart/Level/Achv/Rank/Rating) plus snapshot_rating, the total ' +
        'rating AT THE TIME OF THAT SNAPSHOT. IMPORTANT: this is a daily snapshot, not always fresh — ' +
        'ALWAYS compare snapshot_rating against current_rating (this account\'s live rating, included in ' +
        'the same result) and check snapshot_age_days; if they differ or the snapshot is old, tell the ' +
        'user plainly that the top plays shown may be outdated rather than presenting them as current. ' +
        'Use this for "what\'s my/its highest rated play / B50 breakdown" about the tracked account — not ' +
        'about a friend, which is get_maimai_friend_top_scores instead.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

/** Handles both Date formats seen in stored snapshots: "DD/MM/YYYY HH:mm:ss" and "M/D/YYYY, h:mm:ss AM/PM". */
function parseSnapshotDate(dateStr) {
    if (!dateStr) return null;
    const direct = new Date(dateStr);
    if (!Number.isNaN(direct.getTime())) return direct;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2}):(\d{2})$/.exec(dateStr.trim());
    if (!m) return null;
    const [, d, mo, y, h, mi, s] = m;
    const dt = new Date(
        `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${s}`
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
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

        const snapshotDate = parseSnapshotDate(body.Date);
        const snapshotAgeDays = snapshotDate
            ? Math.floor((Date.now() - snapshotDate.getTime()) / 86400000)
            : null;

        return {
            success: true,
            current_rating: self ? Number(self.rating) || self.rating || null : null,
            snapshot_date: body.Date || null,
            snapshot_age_days: snapshotAgeDays,
            snapshot_rating: body.rating ?? null,
            new_version_top_plays: body.new || [],
            old_version_top_plays: body.old || [],
        };
    } catch (err) {
        return { success: false, error: `Could not reach the maimai stats API: ${err.message}` };
    }
}

module.exports = { declaration, execute };
