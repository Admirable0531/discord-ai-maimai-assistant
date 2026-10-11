// Reads a chart the user supplies: either raw simai text or a whole
// maidata.txt (with &title=, &inote_5=... sections). Returns the one chart to
// show, or a plain-language reason it could not be used.

const LEVELS = { 2: 'Basic', 3: 'Advanced', 4: 'Expert', 5: 'Master', 6: 'Re:Master', 7: 'Utage' };
const NUMBER = { basic: 2, advanced: 3, expert: 4, master: 5, remaster: 6 };
const MAX_CHARS = 300000;

/** {success, title, label, text} or {success: false, error}. */
function parseCustomChart(input, { difficulty = 'auto' } = {}) {
    const raw = String(input || '')
        .replace(/^\uFEFF/, '')
        .replace(/\r/g, '');
    if (!raw.trim()) return { success: false, error: 'Paste a chart or choose a file first.' };
    if (raw.length > MAX_CHARS) {
        return {
            success: false,
            error: 'That text is too long to be one chart (limit 300,000 characters).',
        };
    }
    if (!/^&\w+=/m.test(raw)) {
        return { success: true, title: '', label: 'Custom', text: raw.trim() };
    }
    // a maidata.txt: &key=value sections, the chart in &inote_N
    const fields = {};
    for (const part of ('\n' + raw).split(/\n(?=&\w+=)/)) {
        const m = /^&(\w+)=([\s\S]*)$/.exec(part.trim());
        if (m) fields[m[1].toLowerCase()] = m[2].trim();
    }
    const available = Object.keys(fields)
        .map((k) => /^inote_(\d+)$/.exec(k))
        .filter((m) => m && fields[m[0]])
        .map((m) => Number(m[1]))
        .sort((a, b) => a - b);
    if (available.length === 0) {
        return {
            success: false,
            error: 'This maidata file has no chart in it (no &inote_ section with notes).',
        };
    }
    let pick = available[available.length - 1];
    if (difficulty !== 'auto') {
        pick = NUMBER[difficulty];
        if (!available.includes(pick)) {
            const have = available.map((n) => LEVELS[n] || `#${n}`).join(', ');
            return {
                success: false,
                error: `That file has no ${LEVELS[pick]} chart. It has: ${have}.`,
            };
        }
    }
    return {
        success: true,
        title: fields.title || '',
        label: LEVELS[pick] || `#${pick}`,
        text: fields[`inote_${pick}`],
    };
}

/** A readable message for a parse failure from the chart reader. */
function describeParseError(err) {
    const where =
        err && err.line
            ? ` near line ${err.line}${err.character ? `, character ${err.character}` : ''}`
            : '';
    return `The chart could not be read${where}. Check for a missing comma, a bracket that is not closed, or a missing end marker (E).`;
}

module.exports = { parseCustomChart, describeParseError, LEVELS };
