const { loadSongData } = require('../web/maimaiSongData');
const { isUtageSong } = require('../web/maimaiChartLookup');
const { fold } = require('../web/maimaiSongMatch');
const { findSongs } = require('../web/songResolver');
const { searchWeb } = require('../web/searchProvider');
const { attachFile } = require('../utils/outputs');
const { COVER_HOST } = require('../render/theme');
const { buildSongCardHtml, WIDTH } = require('../render/songCard');
const { buildSongCardModel } = require('../web/maimaiSongCardModel');
const { drawCard } = require('../render/drawCard');
const logger = require('../utils/logger');

const MAX_COVER_BYTES = 3 * 1024 * 1024;
const VIDEO_DOMAINS = ['youtube.com', 'youtu.be', 'nicovideo.jp', 'bilibili.com'];
const DIFFICULTY_LABELS = {
    basic: 'BASIC',
    advanced: 'ADVANCED',
    expert: 'EXPERT',
    master: 'MASTER',
    remaster: 'Re:MASTER',
};
const DIFFICULTY_ORDER = ['remaster', 'master', 'expert', 'advanced', 'basic'];

const declaration = {
    name: 'get_maimai_chart_preview',
    description:
        'Preview a chart: a song card image (cover, every chart\'s level, constant, notes and charter), the details of one difficulty, and LINKS to watch it — chart-confirmation video search results (YouTube / niconico) and the RemyWiki page. For "show me X", "how does X look / play", "chart video of X". It can\'t render the chart itself: the videos are other people\'s uploads found by search, so present them as results to check (especially title_matches: false). Put the best video URL on its own line so Discord embeds it. Defaults to master, and the DX chart when a song has both.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song: { type: 'string', description: 'Song title or nickname.' },
            difficulty: {
                type: 'string',
                enum: Object.keys(DIFFICULTY_LABELS),
                description:
                    'Which chart (default master; falls back to the hardest one the song has).',
            },
            type: {
                type: 'string',
                enum: ['dx', 'std'],
                description: 'DX or standard chart, for songs that have both (default dx).',
            },
        },
        required: ['song'],
    },
};

/** The one song `query` means, or a list to choose from, or nothing. */
async function resolveSong(songs, query) {
    const { matches } = await findSongs(songs, query, (s) => !isUtageSong(s));
    return matches.map((m) => m.song);
}

function pickSheet(song, difficulty, type) {
    const wanted = type || (song.sheets.some((s) => s.type === 'dx') ? 'dx' : 'std');
    const ofType = song.sheets.filter((s) => s.type === wanted);
    const pool = ofType.length > 0 ? ofType : song.sheets;
    return (
        pool.find((s) => s.difficulty === difficulty) ||
        DIFFICULTY_ORDER.map((d) => pool.find((s) => s.difficulty === d)).find(Boolean) ||
        null
    );
}

async function fetchCover(imageName) {
    if (!imageName) return null;
    try {
        const response = await fetch(
            `https://${COVER_HOST}/maimai/img/cover/${encodeURIComponent(imageName)}`,
            {
                signal: AbortSignal.timeout(10000),
            }
        );
        if (!response.ok) return null;
        const data = Buffer.from(await response.arrayBuffer());
        return data.length > 0 && data.length <= MAX_COVER_BYTES ? data : null;
    } catch {
        return null;
    }
}

/** The song's RemyWiki page URL if the page exists, else null. */
async function remyWikiPage(title) {
    try {
        const params = new URLSearchParams({ action: 'query', titles: title, format: 'json' });
        const response = await fetch(`https://silentblue.remywiki.com/api.php?${params}`, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; discord-ai-assistant/1.0)' },
        });
        if (!response.ok) return null;
        const pages = (await response.json())?.query?.pages || {};
        const page = Object.values(pages)[0];
        if (!page || 'missing' in page || 'invalid' in page) return null;
        return `https://silentblue.remywiki.com/${encodeURIComponent(page.title.replace(/ /g, '_'))}`;
    } catch {
        return null;
    }
}

async function findVideos(song, sheet) {
    const label = DIFFICULTY_LABELS[sheet.difficulty] || sheet.difficulty;
    const query = `maimai ${song.title} ${label} 譜面確認`;
    try {
        const results = await searchWeb({ query, allowedDomains: VIDEO_DOMAINS, maxResults: 5 });
        const wanted = fold(song.title);
        return results
            .map((r) => ({
                title: r.title,
                url: r.url,
                title_matches: wanted.length > 0 && fold(r.title).includes(wanted),
            }))
            .sort((a, b) => Number(b.title_matches) - Number(a.title_matches))
            .slice(0, 4);
    } catch (err) {
        logger.warn('tools', `Chart video search failed: ${err.message}`);
        return null;
    }
}

async function execute(args, context) {
    const query = typeof args?.song === 'string' ? args.song.trim() : '';
    if (!query) return { success: false, error: 'song is required.' };

    let data;
    try {
        data = await loadSongData();
    } catch (err) {
        return { success: false, error: err.message };
    }

    const candidates = await resolveSong(data.songs, query);
    if (candidates.length === 0) {
        return {
            success: false,
            error: `No song matching "${query}" — try search_maimai_songs for the exact title.`,
        };
    }
    if (candidates.length > 1) {
        return {
            success: false,
            error: `Several songs match "${query}" — ask which one.`,
            matches: candidates
                .slice(0, 8)
                .map((s) => ({ title: s.title, artist: s.artist, category: s.category })),
        };
    }

    const song = candidates[0];
    const sheet = pickSheet(song, args?.difficulty, args?.type);
    if (!sheet) return { success: false, error: `"${song.title}" has no charts to preview.` };

    const intlVersion = song.sheets.find((s) => s.regionOverrides?.intl?.version)?.regionOverrides
        .intl.version;

    const [card, videos, remywiki] = await Promise.all([
        drawCard(context, {
            html: buildSongCardHtml(
                buildSongCardModel(song, { type: sheet.type, difficulty: sheet.difficulty })
            ),
            width: WIDTH,
            filename: 'song-card.png',
        }),
        findVideos(song, sheet),
        remyWikiPage(song.title),
    ]);

    // The card didn't draw: the bare cover is still better than nothing.
    let imageAttached = card.ok;
    if (!imageAttached) {
        logger.warn('tools', `Song card failed (${card.error}); attaching the cover alone`);
        const cover = await fetchCover(song.imageName);
        if (cover) imageAttached = attachFile(context, { name: 'cover.png', data: cover }).ok;
    }

    const label = DIFFICULTY_LABELS[sheet.difficulty] || sheet.difficulty;
    const youtubeSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `maimai ${song.title} ${label} 譜面確認`
    )}`;

    return {
        success: true,
        image_attached: imageAttached,
        title: song.title,
        artist: song.artist,
        category: song.category,
        bpm: song.bpm,
        version: song.version,
        ...(intlVersion && intlVersion !== song.version ? { intl_version: intlVersion } : {}),
        release_date: song.releaseDate,
        chart: {
            type: sheet.type,
            difficulty: sheet.difficulty,
            level: sheet.level,
            constant: sheet.internalLevel,
            note_designer: sheet.noteDesigner,
            ...(sheet.noteCounts ? { notes: sheet.noteCounts } : {}),
        },
        videos: videos ?? [],
        ...(videos === null
            ? { video_search_error: 'Video search is unavailable right now.' }
            : {}),
        youtube_search_url: youtubeSearch,
        remywiki_url: remywiki,
        note:
            'A card with the cover and every chart (levels, constants, note counts, charters) is attached ' +
            "automatically — you can't see it, so don't re-list the charts. The videos are search results by other people — check " +
            'title_matches, and say they are results to look at, not guaranteed to be this exact chart.',
    };
}

module.exports = { declaration, execute };
