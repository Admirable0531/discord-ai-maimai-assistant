const cheerio = require('cheerio');
const { fetchAccountPage } = require('./maimaiAccountSession');

// record/musicMybest/search/ (the previous approach here) returns exactly
// 20 entries for EVERY diff value (0/1/2/3/4/99), confirmed live against a
// heavily-played account — it's a top-20-by-play-count view, not "every
// song ever played" like it looks on a lightly-played test account where
// the cap never gets hit. record/musicLevel/search/?level=<bucket> has no
// such cap (confirmed live: 214 real entries at level=13 alone) and is
// keyed by the song's own internal level, which we already know from
// loadSongData — so look the song up directly by level bucket instead of
// scanning a capped list.
const DIFFICULTY_PRIORITY = ['master', 'remaster', 'expert', 'advanced', 'basic'];

/** Displayed-level bucket string (e.g. "13", "13+") for an exact internal level, matching musicLevel/search's own convention. */
function levelToBucketLabel(levelValue) {
    const intLevel = Math.floor(levelValue);
    const frac = levelValue - intLevel;
    return frac >= 0.6 - 1e-9 ? `${intLevel}+` : `${intLevel}`;
}

/**
 * This tracked account's musicDetail idx for each chart TYPE of a song it has
 * played: [{idx, chartType: 'dx' | 'std'}]. A song charted as both DX and
 * standard is two entries on the site, each with its own idx and its own
 * detail page (confirmed live: "Endless, Sleepless Night" and ジングルベル
 * appear twice on one level page with different idx values, and a detail page
 * shows only its own type). Taking the first entry with a matching title, as
 * this used to, silently dropped the other type's plays.
 *
 * Tries the song's level buckets (Master/Re:Master first, since that's what's
 * asked about most) until every chart type the song has is found or the
 * buckets run out — usually 1-2 requests, at most one per distinct level.
 */
async function findPlayedCharts(song) {
    const sheets = song.sheets.filter((sh) => sh.type === 'dx' || sh.type === 'std');
    const wantedTypes = new Set(sheets.map((sh) => sh.type));
    const orderedSheets = [...sheets].sort(
        (a, b) =>
            DIFFICULTY_PRIORITY.indexOf(a.difficulty) - DIFFICULTY_PRIORITY.indexOf(b.difficulty)
    );
    const found = new Map(); // chartType -> idx
    const checkedBuckets = new Set();

    for (const sheet of orderedSheets) {
        if (found.size >= wantedTypes.size) break;
        const level = sheet.internalLevelValue ?? sheet.levelValue;
        if (level == null) continue;
        const bucket = levelToBucketLabel(level);
        if (checkedBuckets.has(bucket)) continue;
        checkedBuckets.add(bucket);

        const { html } = await fetchAccountPage(
            `/maimai-mobile/record/musicLevel/search/?level=${encodeURIComponent(bucket)}`
        );
        const $ = cheerio.load(html);
        $('[class*="_score_back"]').each((_, block) => {
            const $block = $(block);
            if ($block.find('.music_name_block').first().text().trim() !== song.title) return;
            const kind = $block
                .find('img')
                .toArray()
                .map((img) => $(img).attr('src') || '')
                .find((src) => /music_(dx|standard)\./.test(src));
            const chartType = kind?.includes('music_standard') ? 'std' : 'dx';
            const idx = $block.find('input[name="idx"]').attr('value');
            if (idx && !found.has(chartType)) found.set(chartType, idx);
        });
    }
    return [...found].map(([chartType, idx]) => ({ chartType, idx }));
}

// Turning a typed name into a song is songResolver.js's job.
module.exports = { findPlayedCharts, levelToBucketLabel };
