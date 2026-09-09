// Shared freshness math for the nightly-snapshot data sources (the friend
// rating leaderboard and the per-friend top-score snapshots). Both need to
// answer "how old is this, really?", and getting that wrong is not a cosmetic
// problem: the "main" account's friend-list scrape has failed every night
// since 2026-03-18, so anything that assumes "nightly" means "recent" will
// present half-year-old ratings as current.

// One snapshot is written per account per night, so more than two days old
// means nights were missed rather than the run being a few hours behind.
const STALE_AFTER_DAYS = 2;

/**
 * Whole days between `date` and now, or null when it can't be parsed.
 *
 * Slash dates from these pipelines are DAY-first ("07/09/2026 22:46:41" is
 * 7 September, confirmed against the leaderboard's own ISO snapshotDate of
 * 2026-09-08 for the same run). That has to be parsed explicitly, because
 * handing it to `new Date()` gets it silently wrong in the other direction —
 * JS reads bare slash dates as MONTH-first, turning 7 September into 9 July
 * and reporting a 2-day-old snapshot as ~2 months stale. The previous local
 * parser hit exactly that, so it over-reported staleness on fresh data.
 *
 * The one slash format that IS month-first is the localized
 * "M/D/YYYY, h:mm:ss AM/PM" shape, which is distinguishable by its comma /
 * meridiem and so is left to `new Date()`.
 */
function ageInDays(date) {
    if (!date) return null;
    const raw = String(date).trim();

    let parsed;
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        parsed = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
    } else {
        const dayFirst =
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
        if (dayFirst && !/,|[ap]\.?m\.?/i.test(raw)) {
            const [, d, mo, y, h = '0', mi = '0', s = '0'] = dayFirst;
            parsed = new Date(
                `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${s.padStart(2, '0')}`
            );
        } else {
            parsed = new Date(raw);
        }
    }

    if (!parsed || Number.isNaN(parsed.getTime())) return null;
    const days = Math.floor((Date.now() - parsed.getTime()) / 86400000);
    return days < 0 ? 0 : days;
}

/** True when a snapshot is old enough that nights were missed — or when its age is unknown, which is no safer. */
function isStale(date) {
    const days = ageInDays(date);
    return days === null || days > STALE_AFTER_DAYS;
}

module.exports = { STALE_AFTER_DAYS, ageInDays, isStale };
