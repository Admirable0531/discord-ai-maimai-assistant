// What the song card draws for one song of the arcade-songs data: every real
// chart (DX first, easiest to hardest), which regions the song is in, and the
// chart the user asked about, if any. Shared by the chart-preview tool and
// search_maimai_songs, so a song looks the same whichever way it is asked for.
const REGIONS = [
    ['jp', 'Japan'],
    ['intl', 'International'],
    ['usa', 'USA'],
    ['cn', 'China'],
];
const DIFFICULTY_ORDER = ['basic', 'advanced', 'expert', 'master', 'remaster'];

function cardCharts(song) {
    return song.sheets
        .filter((s) => s.type === 'dx' || s.type === 'std')
        .sort(
            (a, b) =>
                (a.type === b.type ? 0 : a.type === 'dx' ? -1 : 1) ||
                DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty)
        )
        .map((s) => ({
            type: s.type,
            difficulty: s.difficulty,
            level: s.level,
            constant: s.internalLevel,
            designer: s.noteDesigner,
            notes: s.noteCounts,
        }));
}

/** Regions the song is available in, or null when the data doesn't say. */
function availability(song) {
    if (!song.sheets.some((s) => s.regions)) return null;
    return REGIONS.map(([key, label]) => ({
        label,
        on: song.sheets.some((s) => s.regions?.[key]),
    }));
}

/** @param {{type, difficulty}|null} highlight */
function buildSongCardModel(song, highlight = null) {
    const intlVersion = song.sheets.find((s) => s.regionOverrides?.intl?.version)?.regionOverrides
        .intl.version;
    return {
        title: song.title,
        artist: song.artist,
        category: song.category,
        bpm: song.bpm,
        version: song.version,
        intlVersion,
        releaseDate: song.releaseDate,
        cover: song.imageName,
        charts: cardCharts(song),
        availability: availability(song),
        highlight,
    };
}

module.exports = { buildSongCardModel, cardCharts };
