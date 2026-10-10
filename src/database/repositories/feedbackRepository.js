const { getDb } = require('../client');

const EXCERPT_LENGTH = 500;

/** Records (or changes) one user's 👍 (1) / 👎 (-1) on one reply. */
function recordFeedback({ messageId, userId, channelId, rating, excerpt }) {
    getDb()
        .$client.prepare(
            `INSERT INTO reply_feedback (message_id, user_id, channel_id, rating, reply_excerpt)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (message_id, user_id)
             DO UPDATE SET rating = excluded.rating, created_at = CURRENT_TIMESTAMP`
        )
        .run(
            messageId,
            userId,
            channelId || null,
            rating,
            (excerpt || '').slice(0, EXCERPT_LENGTH)
        );
}

/** Totals for the last `days` days plus the newest 👎 replies, for the owner's "feedback" command. */
function feedbackSummary(days = 30, recentBad = 5) {
    const raw = getDb().$client;
    const totals = raw
        .prepare(
            `SELECT
                COALESCE(SUM(rating = 1), 0) AS up,
                COALESCE(SUM(rating = -1), 0) AS down
             FROM reply_feedback WHERE created_at >= datetime('now', ?)`
        )
        .get(`-${days} days`);
    const bad = raw
        .prepare(
            `SELECT message_id AS messageId, channel_id AS channelId, reply_excerpt AS excerpt
             FROM reply_feedback WHERE rating = -1 AND created_at >= datetime('now', ?)
             ORDER BY created_at DESC LIMIT ?`
        )
        .all(`-${days} days`, recentBad);
    return { ...totals, recentBad: bad };
}

module.exports = { recordFeedback, feedbackSummary };
