const { loadSongData } = require('../web/maimaiSongData');
const { isUtageSong } = require('../web/maimaiChartLookup');
const { fold, fallbackMatch, loadAliases } = require('../web/maimaiSongMatch');
const { searchWeb } = require('../web/searchProvider');
const { attachFile } = require('../utils/outputs');
const { COVER_HOST } = require('../render/theme');
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
        "Preview a maimai chart: the song's cover art (attached to your reply as an image), its chart " +
        'details for one difficulty (level, exact constant, charter, note counts), and LINKS to watch the ' +
        'chart — video search results (YouTube / niconico, "譜面確認"-style chart-confirmation videos) and the ' +
        'song\'s RemyWiki page when it has one. Use it for "show me X", "how does X look / play", "chart ' +
        'preview / video of X". It cannot render the chart itself — the videos are search results from other ' +
        'people, so say they are results to check rather than guaranteed matches (title_matches: false ones ' +
        'especially). Put the best video URL in your reply on its own line so Discord embeds it. The cover is ' +
        "attached automatically and you can't see it. Takes a song title or a nickname; it asks you to pick " +
        'when several songs fit. Defaults: master difficulty, the DX chart when a song has both.',
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
    const q = fold(query);
    const real = songs.filter((s) => !isUtageSong(s));
    let candidates = real.filter((s) => fold(s.title) === q);
    if (candidates.length === 0) candidates = real.filter((s) => q && fold(s.title).includes(q));
    if (candidates.length === 0) {
        const aliases = await loadAliases();
        candidates = real.filter((s) => fallbackMatch(s, query, aliases));
    }
    return candidates;
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

    const [cover, videos, remywiki] = await Promise.all([
        fetchCover(song.imageName),
        findVideos(song, sheet),
        remyWikiPage(song.title),
    ]);

    let coverAttached = false;
    if (cover) coverAttached = attachFile(context, { name: 'cover.png', data: cover }).ok;

    const label = DIFFICULTY_LABELS[sheet.difficulty] || sheet.difficulty;
    const youtubeSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `maimai ${song.title} ${label} 譜面確認`
    )}`;
    const intlVersion = song.sheets.find((s) => s.regionOverrides?.intl?.version)?.regionOverrides
        .intl.version;

    return {
        success: true,
        cover_attached: coverAttached,
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
            'The cover is attached automatically. The videos are search results by other people — check ' +
            'title_matches, and say they are results to look at, not guaranteed to be this exact chart.',
    };
}

module.exports = { declaration, execute };
