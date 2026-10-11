// Reads one difficulty's chart text out of a simai wiki (atwiki) song page.
// Each difficulty is an <h2> followed by a <div> holding the chart, one line
// per <br />, HTML-escaped. Returns the plain simai text (ending in "E").
const ENTITIES = {
    '&gt;': '>',
    '&lt;': '<',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
};

function decode(text) {
    return text.replace(/&(?:gt|lt|amp|quot|nbsp|#39);/g, (m) => ENTITIES[m]);
}

/** Difficulty names as the wiki spells them. */
const SECTION_NAMES = {
    basic: 'BASIC',
    advanced: 'ADVANCED',
    expert: 'EXPERT',
    master: 'MASTER',
    remaster: 'Re:MASTER',
};

/** The chart text of `difficulty` in the page HTML, or null if the page has none. */
function extractChart(html, difficulty) {
    const name = SECTION_NAMES[String(difficulty).toLowerCase()];
    if (!name) return null;
    const start = new RegExp(`<h2[^>]*>\\s*${name}\\s*</h2>`).exec(html);
    if (!start) return null;
    // The chart is split over several <div> blocks, so read up to the next
    // section anchor/heading instead of the first </div>.
    const rest = html.slice(start.index + start[0].length);
    const next = rest.search(/<a id=|<h2/);
    const block = next === -1 ? rest : rest.slice(0, next);
    let text = decode(block.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
        .replace(/\r/g, '')
        .trim();
    // Wiki comments can sit before the chart; it starts at the "(BPM)" header.
    const header = /^\(\d/m.exec(text);
    if (!header) return null;
    text = text.slice(header.index);
    // The chart ends at its "E" token; anything after is page furniture.
    const end = /(?:^|,)E\s*$/m.exec(text);
    if (end) text = text.slice(0, end.index + end[0].length).trim();
    return /,/.test(text) ? text : null;
}

module.exports = { extractChart, decode };
