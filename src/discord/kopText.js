// The KOP8th board as plain message text, so Discord search finds players by
// name. A message holds 2,000 characters, which fits about 34 ranking lines,
// so each region's top 100 is three messages (see PARTS). Pure: data in, text out.
const { escapeMarkdown } = require('discord.js');
const { displayName } = require('../render/theme');

const MAX_LENGTH = 2000;
// [first index, end index) of each message's slice of the top 100.
const PARTS = [
    [0, 34],
    [34, 67],
    [67, 100],
];

function moveText(move) {
    if (move === 'new') return ' 🆕';
    if (typeof move !== 'number' || move === 0) return '';
    return move > 0 ? ` ▲${move}` : ` ▼${-move}`;
}

function formatInt(n) {
    return Number.isFinite(n) ? n.toLocaleString('en-US') : '–';
}

/**
 * One line per player: rank, name (normal-width, so a search for "minjin"
 * finds "Ｍｉｎｊｉｎ"), total score, DX score and movement since the last update.
 * Players on the friend list are bold and starred.
 */
function rankingLine(e, isOurs, shortNames = false) {
    let name = displayName(e.name);
    if (shortNames && [...name].length > 10) name = `${[...name].slice(0, 10).join('')}…`;
    const shown = escapeMarkdown(name);
    return `\`${String(e.rank).padStart(3)}\` ${isOurs ? `⭐ **${shown}**` : shown} — ${formatInt(e.score)} · DX ${formatInt(e.dxScore)}${moveText(e.move)}`;
}

/**
 * The text of one board message: part `index` of PARTS for one region.
 * Only the first part has a header (region, update time, link): the parts
 * follow each other in the channel and read as one list.
 */
function kopMessage({ region, updated, pageUrl, entries, ours = new Set(), index }) {
    const [from, to] = PARTS[index];
    const slice = entries.slice(from, to);
    const heading =
        index === 0 ? `**KOP8th maimai — ${region}** · updated ${updated} · <${pageUrl}>\n` : '';
    const build = (short) =>
        heading + slice.map((e) => rankingLine(e, ours.has(e.rank), short)).join('\n');
    const text = build(false);
    // Long names could push a message past Discord's limit; shorten them rather than fail.
    return text.length <= MAX_LENGTH ? text : build(true).slice(0, MAX_LENGTH);
}

module.exports = { kopMessage, rankingLine, PARTS };
