const { fetchAccountPage } = require('../web/maimaiAccountSession');
const { loadSongData } = require('../web/maimaiSongData');
const { findPlayedCharts } = require('../web/maimaiSongIndex');
const { lookupSong } = require('../web/songResolver');
const {
    parseRankingFormTokens,
    parseRankingEntries,
    parseYourScore,
} = require('../web/maimaiRankingLookup');
const { buildSongRankingHtml, WIDTH } = require('../render/songRankingCard');
const { drawCard } = require('../render/drawCard');

const declaration = {
    name: 'get_maimai_song_ranking',
    description:
        'Per-song score ranking on one difficulty: the tracked account\'s friends (scope "friend") or the global top (scope "global"), each with name and achievement %. For "who has the best score on X", "how many people 101\'d X" (use min_achievement_percent). get_friend_leaderboard is DX Rating only, not per song. Only percentages are shown for other players — never call an entry AP or AP+. Works only for songs the tracked account has played. as_image: true when they want to SEE it.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: {
                type: 'string',
                description: 'The song title to look up (partial match is fine).',
            },
            difficulty: {
                type: 'string',
                enum: ['basic', 'advanced', 'expert', 'master', 'remaster'],
                description: 'Chart difficulty.',
            },
            scope: {
                type: 'string',
                enum: ['friend', 'global'],
                description:
                    'Whose ranking to fetch — this account\'s friends, or the global top scores. Defaults to "friend".',
            },
            chart_type: {
                type: 'string',
                enum: ['dx', 'std'],
                description: 'For a song charted as both: which one (default dx).',
            },
            min_achievement_percent: {
                type: 'number',
                description:
                    'Optional: only return entries at or above this achievement %% (e.g. 100.5 to only see APs). Global rankings can be long, so filtering is recommended when you only care about high scores.',
            },
            as_image: {
                type: 'boolean',
                description:
                    'Also draw the ranking as a card and attach it to the reply (see the tool description).',
            },
        },
        required: ['song_name', 'difficulty'],
    },
};

async function execute(args, context) {
    const songName = typeof args?.song_name === 'string' ? args.song_name.trim() : '';
    const difficulty = typeof args?.difficulty === 'string' ? args.difficulty.toLowerCase() : '';
    const scope = args?.scope === 'global' ? 'global' : 'friend';
    const minAchv =
        typeof args?.min_achievement_percent === 'number' ? args.min_achievement_percent : null;

    if (!songName) return { success: false, error: 'song_name is required.' };
    if (!difficulty) return { success: false, error: 'difficulty is required.' };

    try {
        const songData = await loadSongData();
        const found = await lookupSong(songData.songs, songName);
        if (found.failure) return found.failure;
        const { song, matchedVia } = found;

        const charts = await findPlayedCharts(song);
        const wantedType =
            args?.chart_type === 'std' || args?.chart_type === 'dx' ? args.chart_type : null;
        const chart =
            charts.find((c) => c.chartType === wantedType) ||
            (wantedType ? null : charts.find((c) => c.chartType === 'dx') || charts[0]);
        if (wantedType && !chart && charts.length > 0) {
            return {
                success: false,
                error: `This account hasn't played the ${wantedType.toUpperCase()} chart of "${song.title}".`,
                played_chart_types: charts.map((c) => c.chartType),
            };
        }
        const idx = chart?.idx;
        if (!idx) {
            return {
                success: false,
                error: `"${song.title}" doesn't appear in this account's play history — it hasn't been played (on any difficulty).`,
            };
        }

        const { html: detailHtml } = await fetchAccountPage(
            `/maimai-mobile/record/musicDetail/?idx=${encodeURIComponent(idx)}`
        );
        const tokensByDifficulty = parseRankingFormTokens(detailHtml);
        const rankingIdx = tokensByDifficulty[difficulty];
        if (!rankingIdx) {
            return {
                success: false,
                error: `"${song.title}" has no ${difficulty} chart (or this account has never opened it).`,
                available_difficulties: Object.keys(tokensByDifficulty),
            };
        }

        const diffNum = { basic: 0, advanced: 1, expert: 2, master: 3, remaster: 4 }[difficulty];
        const rankingType = scope === 'global' ? 99 : 3;
        const { html: rankingHtml, finalUrl } = await fetchAccountPage(
            `/maimai-mobile/ranking/musicRankingDetail/?diff=${diffNum}&idx=${encodeURIComponent(rankingIdx)}&rankingType=${rankingType}&scoreType=2`
        );

        let entries = parseRankingEntries(rankingHtml);
        const totalEntries = entries.length;
        if (minAchv !== null) entries = entries.filter((e) => e.achievement >= minAchv);

        const result = {
            success: true,
            song_name: song.title,
            ...(matchedVia ? { matched_via: matchedVia } : {}),
            chart_type: chart.chartType,
            ...(charts.length > 1 && !wantedType
                ? {
                      note: 'This song has DX and STD charts; this is the DX ranking — pass chart_type "std" for the other.',
                  }
                : {}),
            difficulty,
            scope,
            your_score: parseYourScore(rankingHtml),
            entries,
            total_entries_on_page: totalEntries,
            returned_entries: entries.length,
            url: finalUrl,
        };
        if (args?.as_image === true) {
            if (entries.length === 0) {
                result.image_error = 'There are no entries to draw.';
            } else {
                const sheets = (song.sheets || []).filter(
                    (s) => s.difficulty === difficulty && s.type !== 'utage'
                );
                const sheet = sheets.find((s) => s.type === 'dx') || sheets[0];
                const drawn = await drawCard(context, {
                    html: buildSongRankingHtml({
                        title: song.title,
                        cover: song.imageName,
                        difficulty,
                        level: sheet?.level ?? null,
                        scope,
                        entries: entries.map((e) => ({
                            rank: e.rank,
                            name: e.name,
                            achievement: e.achievement,
                            isYou: e.is_you,
                        })),
                        yourScore: result.your_score,
                        totalEntries,
                    }),
                    width: WIDTH,
                    filename: `ranking-${scope}.png`,
                });
                if (drawn.ok) {
                    result.image_attached = true;
                    result.note =
                        "The image is attached to your reply automatically and you can't see it — add a short comment from the data, and don't re-list the rows.";
                } else {
                    result.image_error = drawn.error;
                }
            }
        }
        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { declaration, execute };
