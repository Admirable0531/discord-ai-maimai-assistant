// Reads EVERY best score at one displayed level off the account's own
// "Song Scores by Level" page, annotated with each chart's internal level
// (定数 / constant) — the thing the rating-breakdown tools can't give, since
// those only ever cover the top 50 charts by rating.
//
// The constants come from mai-tools, the same bookmarklet
// server/update_user_data.js already injects for its nightly "Analyze
// Rating" scrape. On a /maimai-mobile/record/music* page its all-in-one
// entry point loads score-sort, which fetches the game version and mai-tools'
// song database and then stamps every row with the chart's constant:
//
//     elem.dataset['inlv'] = lv.toFixed(1);   // -> data-inlv="14.3"
//
// (confirmed by reading mai-tools' own src/scripts/score-sort.ts, function
// saveInLv). It also saves the printed level to data-lv first, which matters
// because it OVERWRITES the visible level text with the constant.
//
// mai-tools is third-party and its README says it's no longer actively
// developed, so treat the annotation as best-effort: if it doesn't land in
// time we still return every score at the level, just with constant: null,
// rather than failing the whole lookup.
const { LEVEL_BUCKETS } = require('./maimaiFriendLookup');
const { withAccountPage } = require('./maimaiAccountSession');
const logger = require('../utils/logger');

const MAI_TOOLS_SCRIPT = 'https://myjian.github.io/mai-tools/scripts/all-in-one.js';
// The script fetches a game version and a song database over the network
// before it can annotate anything, so this is deliberately generous.
const ANNOTATION_TIMEOUT_MS = 25000;

/** "14+" / "14" / 14 -> the numeric bucket index the site's own <select name="level"> uses. */
function toLevelBucket(level) {
    const key = String(level).trim();
    return LEVEL_BUCKETS[key] ?? null;
}

/**
 * Runs in the page. Mirrors mai-tools' own selectors (src/common/
 * fetch-score-util.ts) so it reads the same DOM the same way.
 *
 * AP/FC comes off the badge image rather than being inferred from the
 * achievement %%, which is the only correct way to determine it — a chart at
 * 100.5%+ is not necessarily AP.
 */
// Body is serialized and executed in the browser, so it must stay entirely
// self-contained: no closure over anything in this module.
function extractRows() {
    const rows = document.querySelectorAll('.main_wrapper.t_c .w_450.m_15.f_0');

    const badgeName = (img) => {
        if (!img || !img.src) return null;
        const src = img.src.replace(/\?ver=.*$/, '');
        const name = src.substring(src.lastIndexOf('_') + 1, src.lastIndexOf('.'));
        return name === 'back' ? null : name;
    };

    return Array.from(rows).map((row) => {
        const lvBlock = row.querySelector('.music_lv_block');
        const nameBlock = row.querySelector('.music_name_block');
        const scoreBlock = row.querySelectorAll('.music_score_block')[0];

        const inlv = lvBlock && lvBlock.dataset ? lvBlock.dataset.inlv : null;
        // data-lv is the printed level saved before mai-tools overwrites the
        // visible text; fall back to the text itself if it never ran.
        const printed = lvBlock && lvBlock.dataset && lvBlock.dataset.lv;

        const diffMatch = (row.className || '').match(/music_([a-z]+)_score_back/);
        const inner = row.querySelector('[class*="_score_back"]');
        const innerMatch =
            !diffMatch && inner ? (inner.className || '').match(/music_([a-z]+)_score_back/) : null;

        const achievementText = scoreBlock ? scoreBlock.innerText.trim() : '';
        const achievement = parseFloat(achievementText.replace('%', ''));

        const apFcRaw = badgeName(
            row.children[0] && row.children[0].querySelector('img.f_r:nth-last-of-type(2)')
        );

        return {
            song: nameBlock ? nameBlock.innerText.trim() : null,
            difficulty: diffMatch ? diffMatch[1] : innerMatch ? innerMatch[1] : null,
            chart_type: row.querySelector('.music_kind_icon_dx') ? 'dx' : 'standard',
            level: printed || (lvBlock ? lvBlock.innerText.trim() : null),
            constant: inlv ? parseFloat(inlv) : null,
            achievement: Number.isNaN(achievement) ? null : achievement,
            ap_fc: apFcRaw ? apFcRaw.replace('ap', 'AP').replace('p', '+').toUpperCase() : null,
        };
    });
}


/**
 * Every score at `level` ("14+", "13", …), each with its constant where
 * mai-tools supplied one.
 *
 * Throws with a specific message when the site ignores the level filter —
 * an invalid level value makes it silently fall back to LEVEL 1 and serve
 * real-looking results for the wrong level, which is far worse than an error.
 */
async function fetchScoresByLevel(level) {
    const bucket = toLevelBucket(level);
    if (bucket === null) {
        throw new Error(
            `"${level}" is not a maimai level. Use the printed level, e.g. "13", "13+", "14", "14+", "15".`
        );
    }

    const path = `/maimai-mobile/record/musicLevel/search/?level=${bucket}`;

    const { value } = await withAccountPage(path, async (page) => {
        let annotated = false;
        try {
            await page.addScriptTag({ url: MAI_TOOLS_SCRIPT });
            // The script only annotates after fetching the game version and
            // song DB, so waiting on the tag's load event isn't enough.
            await page.waitForFunction(() => document.querySelector('[data-inlv]') !== null, {
                timeout: ANNOTATION_TIMEOUT_MS,
            });
            annotated = true;
        } catch (err) {
            logger.warn(
                'web',
                `mai-tools did not annotate constants for level ${level} (${err.message}) — returning scores without them`
            );
        }
        return { rows: await page.evaluate(extractRows), annotated };
    });

    const { rows, annotated } = value;
    if (rows.length === 0) {
        throw new Error(
            `The level page returned no score rows for level ${level} (bucket ${bucket}).`
        );
    }

    // The site answers an unrecognised level by quietly serving LEVEL 1, so
    // confirm what came back is actually what was asked for.
    const wanted = String(level).trim();
    const matching = rows.filter((r) => r.level === wanted).length;
    if (matching < rows.length / 2) {
        const seen = [...new Set(rows.map((r) => r.level).filter(Boolean))].slice(0, 5);
        throw new Error(
            `Asked for level ${wanted} but the page returned level(s) ${seen.join(', ') || 'unknown'} — ` +
                `the site ignored the filter and fell back to its default.`
        );
    }

    return { rows, annotated, level: wanted, bucket };
}

/** Highest achievement at each constant, for "best score per 定数" questions. */
function bestPerConstant(rows) {
    const best = new Map();
    for (const row of rows) {
        if (row.constant == null || row.achievement == null) continue;
        const key = row.constant.toFixed(1);
        const current = best.get(key);
        if (!current || row.achievement > current.achievement) best.set(key, row);
    }
    return [...best.entries()]
        .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
        .map(([constant, row]) => ({
            constant: parseFloat(constant),
            song: row.song,
            difficulty: row.difficulty,
            chart_type: row.chart_type,
            achievement: row.achievement,
            ap_fc: row.ap_fc,
        }));
}

module.exports = { fetchScoresByLevel, bestPerConstant, toLevelBucket };
