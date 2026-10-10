// The tracked account's scores for every chart of one game version and one
// difficulty, from maimai NET's "Song Scores by Version" page
// (/record/musicVersion/search/?version=<n>&diff=<0-4>). Unlike the best 50,
// it lists every chart of the version, played or not (confirmed live: PRiSM
// MASTER lists 71 charts, 3 with no score), each with its type and its real
// badges — so plate progress can be read off it rather than estimated.
const cheerio = require('cheerio');
const { fetchAccountPage } = require('./maimaiAccountSession');

// The page's own <select name="version"> values (read live).
const VERSIONS = [
    'maimai',
    'maimai PLUS',
    'GreeN',
    'GreeN PLUS',
    'ORANGE',
    'ORANGE PLUS',
    'PiNK',
    'PiNK PLUS',
    'MURASAKi',
    'MURASAKi PLUS',
    'MiLK',
    'MiLK PLUS',
    'FiNALE',
    'でらっくす',
    'でらっくす PLUS',
    'スプラッシュ',
    'スプラッシュ PLUS',
    'UNiVERSE',
    'UNiVERSE PLUS',
    'FESTiVAL',
    'FESTiVAL PLUS',
    'BUDDiES',
    'BUDDiES PLUS',
    'PRiSM',
    'PRiSM PLUS',
    'CiRCLE',
    'CiRCLE PLUS',
];
const DIFFICULTIES = ['basic', 'advanced', 'expert', 'master', 'remaster'];

const CLEAR = { app: 'AP+', ap: 'AP', fcp: 'FC+', fc: 'FC' };
const SYNC = { fdxp: 'FDX+', fdx: 'FDX', fsp: 'FS+', fs: 'FS', sync: 'SYNC' };
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // "version:diff" -> { at, charts }

const icon = (src) =>
    ((src || '').split('/').pop() || '').replace(/\?.*$/, '').replace(/\.png$/, '');

/** [{title, level, chartType, achievement|null, clear|null, sync|null}] from one page. */
function parseVersionPage(html) {
    const $ = cheerio.load(html);
    return $('[class*="_score_back"]')
        .toArray()
        .map((block) => {
            const $b = $(block);
            const icons = $b
                .find('img')
                .toArray()
                .map((img) => icon($(img).attr('src')));
            const badge = (table) => {
                const hit = icons.map((i) => i.replace(/^music_icon_/, '')).find((i) => table[i]);
                return hit ? table[hit] : null;
            };
            const achv = parseFloat($b.find('.music_score_block').first().text().replace('%', ''));
            return {
                title: $b.find('.music_name_block').first().text().trim(),
                level: $b.find('.music_lv_block').first().text().trim() || null,
                chartType: icons.includes('music_standard') ? 'std' : 'dx',
                achievement: Number.isFinite(achv) ? achv : null,
                clear: badge(CLEAR),
                sync: badge(SYNC),
            };
        })
        .filter((c) => c.title);
}

/** Every chart of version index `version` at `difficulty`, cached briefly so a follow-up question doesn't refetch. */
async function fetchVersionScores(version, difficulty) {
    const diff = DIFFICULTIES.indexOf(difficulty);
    if (!VERSIONS[version] || diff < 0)
        throw new Error(`Unknown version ${version} / ${difficulty}`);
    const key = `${version}:${diff}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.charts;
    const { html } = await fetchAccountPage(
        `/maimai-mobile/record/musicVersion/search/?version=${version}&diff=${diff}`
    );
    const charts = parseVersionPage(html);
    cache.set(key, { at: Date.now(), charts });
    return charts;
}

module.exports = { VERSIONS, DIFFICULTIES, parseVersionPage, fetchVersionScores };
