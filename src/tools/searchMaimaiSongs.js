const { loadSongData } = require('../web/maimaiSongData');
const { directMatch, fallbackMatch, loadAliases } = require('../web/maimaiSongMatch');
const { buildSongCardHtml, WIDTH } = require('../render/songCard');
const { buildSongCardModel } = require('../web/maimaiSongCardModel');
const { drawCard } = require('../render/drawCard');

const MAX_RESULTS = 15;

const declaration = {
    name: 'search_maimai_songs',
    description:
        "Search the maimai DX song database for exact chart data: each difficulty's level (including the " +
        'precise decimal internal level, not just the displayed rounded level like "13+"), BPM, artist, ' +
        'category, note designer, note counts (tap/hold/slide/touch/break/total per chart), and which game ' +
        'version a song was added in (intl_version when International got it in a different version). ' +
        'Nicknames and loose spellings are handled: when nothing matches the title directly, it also tries ' +
        'romanised kana ("apoc" finds アポカリプス…) and community aliases (mostly Chinese, e.g. 反逆焰), and ' +
        "says which via matched_via — confirm a matched_via result with the user if it isn't obvious. Use this instead of " +
        "search_web/read_webpage for any question about a specific song's difficulty, level, chart details, " +
        "or release version — it's exact structured data pulled directly from the game data, not something " +
        'read off a wiki page. For a question about ONE specific song (e.g. "what is X", "tell me about X", ' +
        '"is X in international"), pass as_image: true to attach a song card — cover, every chart with its ' +
        "constant and note counts, and which regions have it. You can't see it, so add a short comment and " +
        "don't re-list the charts.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description:
                    'Song title, artist, nickname or romanised title to search for (partial match; case, ' +
                    'full-width and accents are ignored, so "rondo" finds RONDØ).',
            },
            artist: {
                type: 'string',
                description:
                    'Filter to songs by this artist specifically (partial match, case-insensitive) — narrower ' +
                    'than `query`, which also matches titles. Use this for "songs by X" requests where X might ' +
                    'also coincidentally appear in some unrelated title.',
            },
            category: {
                type: 'string',
                description:
                    'Only include songs in this genre category, e.g. "POPS＆アニメ", "niconico＆ボーカロイド", ' +
                    '"東方Project", "ゲーム＆バラエティ", "maimai", "オンゲキ＆CHUNITHM", "宴会場". Matching is ' +
                    "flexible (partial, case-insensitive); if it doesn't resolve, the result lists the exact " +
                    'category names to retry with.',
            },
            note_designer: {
                type: 'string',
                description:
                    'Filter to charts credited to this note designer/chart maker (partial match). "-" in the data means uncredited.',
            },
            difficulty: {
                type: 'string',
                enum: ['basic', 'advanced', 'expert', 'master', 'remaster'],
                description: 'Only include charts of this difficulty.',
            },
            type: {
                type: 'string',
                enum: ['dx', 'std', 'utage'],
                description: 'Only include charts of this type (DX vs standard vs utage).',
            },
            min_level: {
                type: 'number',
                description: 'Minimum chart level, numeric (e.g. 12.6 for "12+").',
            },
            max_level: { type: 'number', description: 'Maximum chart level, numeric.' },
            min_bpm: {
                type: 'number',
                description: "Minimum BPM (the song's, not any one chart's).",
            },
            max_bpm: { type: 'number', description: 'Maximum BPM.' },
            version: {
                type: 'string',
                description:
                    'Only include songs added in this game version, e.g. "PiNK PLUS", "CiRCLE", "BUDDiES PLUS". ' +
                    'Versions come in pairs — a base version (e.g. "PiNK") and its follow-up (e.g. "PiNK PLUS") — ' +
                    'so convert shorthand like "pink+" or "pink plus" to the base name plus "PLUS". Matching is ' +
                    'flexible on case/spacing/"+" vs "plus", so pass your best guess; if it doesn\'t resolve, the ' +
                    'result tells you the full list of valid version names to retry with.',
            },
            as_image: {
                type: 'boolean',
                description:
                    'Draw a song card (cover, every chart with its constant and note counts, which regions have it) and attach it to the reply. Only when exactly one song matches — use it when someone asks about one specific song.',
            },
            random: {
                type: 'boolean',
                description:
                    'Instead of listing matches, pick one uniformly at random from everything matching the other ' +
                    'filters. Use this for "give me a random song/chart to practice" style requests — e.g. ' +
                    'random: true with difficulty "master" and min_level 13 for "give me a random 13+ master".',
            },
        },
    },
};

function normalize(s) {
    return (s || '').toLowerCase();
}

/** "pink+", "PiNK PLUS", "pink plus" all collapse to the same key, so free-text version input matches the canonical name. */
function normalizeVersion(v) {
    return (v || '')
        .toLowerCase()
        .replace(/\+/g, ' plus')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Resolves a free-text version guess to one of the game's actual version
 * names. Exact match after normalization first; falls back to a substring
 * match only when it's unambiguous. Returns candidates (or the full list)
 * on failure so the caller can retry with a corrected value instead of
 * silently getting zero results.
 */
function resolveVersion(rawVersion, allVersions) {
    const target = normalizeVersion(rawVersion);
    const exact = allVersions.find((v) => normalizeVersion(v) === target);
    if (exact) return { resolved: exact };

    const partial = allVersions.filter(
        (v) => normalizeVersion(v).includes(target) || target.includes(normalizeVersion(v))
    );
    return {
        resolved: partial.length === 1 ? partial[0] : null,
        candidates: partial.length > 0 ? partial : allVersions,
    };
}

/** Same shape as resolveVersion, for the (shorter, less ambiguous) category list — no "+"/"plus" normalization needed. */
function resolveCategory(rawCategory, allCategories) {
    const target = normalize(rawCategory).trim();
    const exact = allCategories.find((c) => normalize(c) === target);
    if (exact) return { resolved: exact };

    const partial = allCategories.filter(
        (c) => normalize(c).includes(target) || target.includes(normalize(c))
    );
    return {
        resolved: partial.length === 1 ? partial[0] : null,
        candidates: partial.length > 0 ? partial : allCategories,
    };
}

async function execute(args, context) {
    const query = typeof args?.query === 'string' ? args.query.trim() : '';
    const artist = typeof args?.artist === 'string' ? normalize(args.artist.trim()) : '';
    const noteDesigner =
        typeof args?.note_designer === 'string' ? normalize(args.note_designer.trim()) : '';
    const difficulty = typeof args?.difficulty === 'string' ? args.difficulty.toLowerCase() : null;
    const type = typeof args?.type === 'string' ? args.type.toLowerCase() : null;
    const minLevel = typeof args?.min_level === 'number' ? args.min_level : null;
    const maxLevel = typeof args?.max_level === 'number' ? args.max_level : null;
    const minBpm = typeof args?.min_bpm === 'number' ? args.min_bpm : null;
    const maxBpm = typeof args?.max_bpm === 'number' ? args.max_bpm : null;
    const random = args?.random === true;
    const hasSheetFilter = Boolean(
        difficulty || type || minLevel !== null || maxLevel !== null || noteDesigner
    );

    let data;
    try {
        data = await loadSongData();
    } catch (err) {
        return { success: false, error: err.message };
    }

    let resolvedVersion = null;
    if (typeof args?.version === 'string' && args.version.trim()) {
        const allVersions = data.versions.map((v) => v.version);
        const { resolved, candidates } = resolveVersion(args.version, allVersions);
        if (!resolved) {
            return {
                success: false,
                error: `Could not match "${args.version}" to a known game version.`,
                known_versions: candidates,
            };
        }
        resolvedVersion = resolved;
    }

    let resolvedCategory = null;
    if (typeof args?.category === 'string' && args.category.trim()) {
        const allCategories = data.categories.map((c) => c.category);
        const { resolved, candidates } = resolveCategory(args.category, allCategories);
        if (!resolved) {
            return {
                success: false,
                error: `Could not match "${args.category}" to a known category.`,
                known_categories: candidates,
            };
        }
        resolvedCategory = resolved;
    }

    // Collected without an early cutoff so `random` picks uniformly across
    // every real match, not just whichever happened to appear first in the
    // source data — truncation to MAX_RESULTS (when not random) happens
    // after the full scan instead.
    function collect(matchQuery) {
        const found = [];
        for (const song of data.songs) {
            let matchedVia = null;
            if (query) {
                matchedVia = matchQuery(song);
                if (!matchedVia) continue;
            }
            if (artist && !normalize(song.artist).includes(artist)) continue;
            if (resolvedVersion && song.version !== resolvedVersion) continue;
            if (resolvedCategory && song.category !== resolvedCategory) continue;
            if (minBpm !== null && (song.bpm == null || song.bpm < minBpm)) continue;
            if (maxBpm !== null && (song.bpm == null || song.bpm > maxBpm)) continue;

            const matchingSheets = song.sheets.filter((sheet) => {
                if (difficulty && sheet.difficulty !== difficulty) return false;
                if (type && sheet.type !== type) return false;
                if (noteDesigner && !normalize(sheet.noteDesigner).includes(noteDesigner))
                    return false;
                const level = sheet.internalLevelValue ?? sheet.levelValue;
                if (minLevel !== null && level < minLevel) return false;
                if (maxLevel !== null && level > maxLevel) return false;
                return true;
            });
            if (hasSheetFilter && matchingSheets.length === 0) continue;

            const intlVersion = song.sheets.find((sh) => sh.regionOverrides?.intl?.version)
                ?.regionOverrides.intl.version;
            found.push({
                title: song.title,
                artist: song.artist,
                category: song.category,
                bpm: song.bpm,
                version: song.version,
                ...(intlVersion && intlVersion !== song.version
                    ? { intl_version: intlVersion }
                    : {}),
                releaseDate: song.releaseDate,
                ...(matchedVia === true ? {} : matchedVia ? { matched_via: matchedVia } : {}),
                charts: (hasSheetFilter ? matchingSheets : song.sheets).map((sheet) => ({
                    type: sheet.type,
                    difficulty: sheet.difficulty,
                    level: sheet.level,
                    internalLevel: sheet.internalLevel,
                    noteDesigner: sheet.noteDesigner,
                    ...(sheet.noteCounts ? { notes: sheet.noteCounts } : {}),
                })),
            });
        }
        return found;
    }

    let matches = collect((song) => directMatch(song, query));
    // Only when the title/artist found nothing: loose matching on a short or
    // common query would bury the real answer under false positives.
    if (query && matches.length === 0) {
        const aliasesByTitle = await loadAliases();
        matches = collect((song) => fallbackMatch(song, query, aliasesByTitle));
    }

    if (random) {
        if (matches.length === 0) {
            return { success: true, result_count: 0, songs: [], data_updated_at: data.updateTime };
        }
        const pick = matches[Math.floor(Math.random() * matches.length)];
        return {
            success: true,
            result_count: 1,
            picked_from: matches.length,
            songs: [pick],
            data_updated_at: data.updateTime,
        };
    }

    const result = {
        success: true,
        result_count: Math.min(matches.length, MAX_RESULTS),
        truncated: matches.length > MAX_RESULTS,
        songs: matches.slice(0, MAX_RESULTS),
        data_updated_at: data.updateTime,
    };

    // A card is for ONE song; with several matches, the model should narrow it down first.
    if (args?.as_image === true) {
        if (matches.length !== 1) {
            result.image_error =
                matches.length === 0
                    ? 'There is no song to draw.'
                    : `${matches.length} songs matched, and a card shows one — narrow the search to a single song first.`;
        } else {
            const m = matches[0];
            const song = data.songs.find(
                (s) => s.title === m.title && s.artist === m.artist && s.category === m.category
            );
            const highlight = difficulty && type ? { type, difficulty } : null;
            const drawn = await drawCard(context, {
                html: buildSongCardHtml(buildSongCardModel(song, highlight)),
                width: WIDTH,
                filename: 'song-card.png',
            });
            if (drawn.ok) {
                result.image_attached = true;
                result.note =
                    "The song card is attached to your reply automatically and you can't see it — add a short comment from the data, and don't re-list the charts.";
            } else {
                result.image_error = drawn.error;
            }
        }
    }
    return result;
}

module.exports = { declaration, execute };
