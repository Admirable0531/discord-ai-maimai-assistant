/**
 * How old a stored snapshot is, in whole days.
 *
 * The API's stored-data endpoints each date their results differently —
 * /api/friends-leaderboard returns a snapshotDate calendar day
 * ("2026-10-02", the scraper's UTC day), /api/circle-rankings returns a full
 * scrapedAt timestamp — and both reach the model as "tracked data" with no
 * hint of age unless something works it out. Reporting a nightly snapshot as
 * somebody's current rating is the specific failure this exists to prevent,
 * so the number is computed once here and handed over as snapshot_age_days
 * rather than left for the model to derive from a date string.
 *
 * Returns null for a missing or unparseable value — callers pass that through
 * rather than guessing an age.
 */
function snapshotAgeDays(value) {
    if (!value) return null;
    // A bare calendar day has no time or zone; anchor it to UTC midnight so
    // the age doesn't shift with the host's timezone.
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
    const parsed = Date.parse(normalized);
    if (Number.isNaN(parsed)) return null;
    return Math.max(0, Math.floor((Date.now() - parsed) / 86400000));
}

module.exports = { snapshotAgeDays };
