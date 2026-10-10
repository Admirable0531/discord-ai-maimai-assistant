const { loadSongData } = require('../web/maimaiSongData');
const { findSongs } = require('../web/songResolver');
const { buildSongCardHtml, WIDTH } = require('../render/songCard');
const { buildSongCardModel } = require('../web/maimaiSongCardModel');
const { drawCard } = require('../render/drawCard');

const MAX_RESULTS = 15;

const declaration = {
    name: 'search_maimai_songs',
    description:
        'Exact song and chart data from the game\'s song list: each chart\'s level and precise constant (internal level), BPM, artist, category, charter, note counts per chart (tap/hold/slide/touch/break/total), and the version a song was added in (intl_version when International got it later). Use it — not the web — for any question about a song\'s charts, level, notes or version. Loose names work (romaji, community nicknames, simplified Chinese, typos); matched_via says how a loose match was made, so confirm it with the user if it isn\'t obvious. For a question about ONE song ("what is X", "is X in international"), pass as_image: true for a song card.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Title, artist, nickname or romanised title (partial match).',
            },
            artist: {
                type: 'string',
                description: 'Only songs by this artist (partial match) — for "songs by X".',
            },
            category: {
                type: 'string',
                description:
                    'Genre category, e.g. "POPS＆アニメ", "niconico＆ボーカロイド", "東方Project", "maimai", "オンゲキ＆CHUNITHM", "宴会場". An unknown one returns the valid list.',
            },
            note_designer: {
                type: 'string',
                description: 'Only charts by this charter (partial match).',
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
                    'Only songs added in this version, e.g. "PiNK PLUS", "CiRCLE" ("pink+" works too). An unknown one returns the valid list.',
            },
            as_image: {
                type: 'boolean',
                description: 'Draw a song card for the one matching song.',
            },
            random: {
                type: 'boolean',
                description:
                    'Pick one match at random — "give me a random 13+ master to practise" (with difficulty and min_level).',
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
    /** The song's charts that pass every filter, or null when the song doesn't. */
    function passingSheets(song) {
        if (artist && !normalize(song.artist).includes(artist)) return null;
        if (resolvedVersion && song.version !== resolvedVersion) return null;
        if (resolvedCategory && song.category !== resolvedCategory) return null;
        if (minBpm !== null && (song.bpm == null || song.bpm < minBpm)) return null;
        if (maxBpm !== null && (song.bpm == null || song.bpm > maxBpm)) return null;
        const sheets = song.sheets.filter((sheet) => {
            if (difficulty && sheet.difficulty !== difficulty) return false;
            if (type && sheet.type !== type) return false;
            if (noteDesigner && !normalize(sheet.noteDesigner).includes(noteDesigner)) return false;
            const level = sheet.internalLevelValue ?? sheet.levelValue;
            if (minLevel !== null && level < minLevel) return false;
            if (maxLevel !== null && level > maxLevel) return false;
            return true;
        });
        if (hasSheetFilter && sheets.length === 0) return null;
        return hasSheetFilter ? sheets : song.sheets;
    }

    function collect(entries) {
        const found = [];
        for (const { song, via } of entries) {
            const sheets = passingSheets(song);
            if (!sheets) continue;
            const matchedVia = via;

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
                charts: sheets.map((sheet) => ({
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

    // A search lists everything containing the query, so the exact-title tier is
    // skipped; the looser tiers only run when nothing contains it (songResolver.js).
    const entries = query
        ? (
              await findSongs(data.songs, query, (song) => passingSheets(song) !== null, {
                  skipExact: true,
              })
          ).matches
        : data.songs.map((song) => ({ song, via: true }));
    const matches = collect(entries);

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
