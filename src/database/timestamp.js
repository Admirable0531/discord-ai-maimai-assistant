/**
 * Single source of truth for timestamps written from JS rather than by the
 * database itself.
 *
 * created_at/updated_at default to SQLite's CURRENT_TIMESTAMP (see
 * schema.js), which formats as "YYYY-MM-DD HH:MM:SS" in UTC. A manual
 * `new Date().toISOString()` on an update path instead writes
 * "YYYY-MM-DDTHH:MM:SS.sssZ" — same column, two different shapes depending
 * on whether the row had ever been updated, which is exactly what the live
 * database ended up holding (memory row 2 vs. the rest). Anything that
 * later sorts or parses these as strings would quietly mis-order the ISO
 * rows against the rest, so match the DB's own format instead.
 */
function sqliteTimestamp(date = new Date()) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { sqliteTimestamp };
