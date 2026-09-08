// Resolving "song title + difficulty" to one chart in the arcade-songs
// dataset is not the one-liner it looks like, and getting it wrong is silent
// rather than loud. Two things bite:
//
// 1. Duplicate titles. 65 titles in the dataset appear as more than one song
//    entry — the real song, plus a 宴会場 (UTAGE) entry carrying only joke
//    charts with difficulties like 【宴】/【狂】/【即】 and no master at all.
//    A plain sheets.find(difficulty === 'master') against the UTAGE entry
//    finds nothing, so the chart gets dropped with no error. That is exactly
//    why ジングルベル, Oshama Scramble!, 脳漿炸裂ガール and friends were
//    vanishing out of per-constant results.
//
// 2. std vs dx. 81 songs have a master chart in BOTH chart types, and 71 of
//    those 81 have DIFFERENT constants between them — POP TEAM EPIC is 11.0
//    as std and 12.6 as dx. Taking whichever sheet happens to come first can
//    therefore misplace a chart by more than a whole point, which silently
//    files it under the wrong constant.
//
// So: prefer the real song over its UTAGE namesake, and never guess between
// std and dx when their constants disagree — report the ambiguity instead.

/** UTAGE entries are the 宴会場 joke charts, never what a normal score row refers to. */
function isUtageSong(song) {
    return (
        song.category === '宴会場' ||
        (Array.isArray(song.sheets) &&
            song.sheets.length > 0 &&
            song.sheets.every((sh) => sh.type === 'utage'))
    );
}

/**
 * The song entry a normal (non-UTAGE) score row refers to. Falls back to a
 * UTAGE entry only when that is genuinely the only thing with this title.
 */
function findSongByTitle(songs, title) {
    const target = (title || '').trim();
    if (!target) return null;
    const matches = songs.filter((s) => s.title.trim() === target);
    if (matches.length === 0) return null;
    return matches.find((s) => !isUtageSong(s)) || matches[0];
}

/**
 * One chart's sheet. `chartType` ('std' | 'dx') should be passed whenever the
 * source page shows it, since the two can carry different constants.
 *
 * Returns {sheet} on success, or {error, ...context} — including
 * {ambiguous: true} when the type wasn't given and the candidates disagree,
 * so a caller reports "which chart type?" rather than picking one at random.
 */
function findSheet(song, difficulty, chartType = null) {
    const candidates = (song.sheets || []).filter((sh) => sh.difficulty === difficulty);
    if (candidates.length === 0) {
        return {
            error: `"${song.title}" has no ${difficulty} chart.`,
            available_difficulties: [...new Set((song.sheets || []).map((sh) => sh.difficulty))],
        };
    }

    if (chartType) {
        const typed = candidates.find((sh) => sh.type === chartType);
        if (!typed) {
            return {
                error: `"${song.title}" has no ${chartType} ${difficulty} chart.`,
                available_chart_types: candidates.map((sh) => sh.type),
            };
        }
        return { sheet: typed };
    }

    if (candidates.length === 1) return { sheet: candidates[0] };

    const levels = new Set(candidates.map((sh) => sh.internalLevelValue ?? sh.levelValue));
    if (levels.size === 1) return { sheet: candidates[0] }; // same constant either way

    return {
        error:
            `"${song.title}" has both std and dx ${difficulty} charts with different constants ` +
            `(${candidates.map((sh) => `${sh.type}: ${sh.internalLevelValue ?? sh.levelValue}`).join(', ')}) ` +
            `— specify which chart type.`,
        ambiguous: true,
        available_chart_types: candidates.map((sh) => sh.type),
    };
}

/** The chart's constant, or null when it has no level data. */
function sheetLevel(sheet) {
    return sheet ? (sheet.internalLevelValue ?? sheet.levelValue ?? null) : null;
}

/** Convenience: title + difficulty (+ chart type) -> {song, sheet, level} or {error}. */
function resolveChart(songs, title, difficulty, chartType = null) {
    const song = findSongByTitle(songs, title);
    if (!song) return { error: `No song titled "${title}" found.` };
    const result = findSheet(song, difficulty, chartType);
    if (result.error) return { song, ...result };
    return { song, sheet: result.sheet, level: sheetLevel(result.sheet) };
}

module.exports = { isUtageSong, findSongByTitle, findSheet, sheetLevel, resolveChart };
