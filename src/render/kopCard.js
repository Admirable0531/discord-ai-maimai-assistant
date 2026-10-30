// KOP8th maimai ranking: one region's top players as a table, with how far
// each moved since SEGA's previous update and the group's own players marked.
// A table, not a chart: the top 100 sit within ~0.6% of each other, so the
// scores themselves are what people compare. Pure: data in, HTML out.
const { TOKENS, BASE_CSS, escapeHtml, footerHtml, displayName, formatInt } = require('./theme');

const WIDTH = 620;
const ROW_H = 36;
const DEFAULT_MAX_ROWS = 30;

const CSS = `
${BASE_CSS}
.card { width: ${WIDTH}px; padding: 28px 22px 24px; }
.label { color: ${TOKENS.inkMuted}; font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.title { font-size: 38px; font-weight: 700; line-height: 1.1; margin-top: 6px; }
.sub { color: ${TOKENS.inkSecondary}; font-size: 17px; margin-top: 8px; }
.table { margin-top: 18px; }
.head, .row { display: flex; align-items: center; }
.head { height: 24px; color: ${TOKENS.inkMuted}; font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; border-bottom: 1px solid ${TOKENS.axis}; }
.row { height: ${ROW_H}px; border-radius: 6px; }
.row.ours { background: ${TOKENS.raised}; }
.rank { flex: 0 0 40px; text-align: right; padding-right: 10px; color: ${TOKENS.inkMuted}; font-size: 15px; }
.row .rank { color: ${TOKENS.inkSecondary}; }
.move { flex: 0 0 52px; font-size: 13px; font-weight: 600; }
.move.up { color: ${TOKENS.good}; }
.move.down { color: ${TOKENS.warning}; }
.move.new { color: ${TOKENS.series1}; }
.move.same { color: ${TOKENS.inkMuted}; }
.name { flex: 1; min-width: 0; font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 8px; }
.tag { margin-left: 8px; color: ${TOKENS.inkSecondary}; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.score { flex: 0 0 104px; text-align: right; font-size: 17px; font-weight: 600; }
.dx { flex: 0 0 70px; text-align: right; color: ${TOKENS.inkSecondary}; font-size: 15px; padding-right: 4px; }
.gap { height: ${ROW_H}px; display: flex; align-items: center; justify-content: center; color: ${TOKENS.inkMuted}; font-size: 15px; letter-spacing: 0.3em; }
`;

/** Movement as text with its direction in the glyph, so it never relies on colour alone. */
function moveCell(move) {
    if (move === null || move === undefined) return '<div class="move"></div>';
    if (move === 'new') return '<div class="move new">NEW</div>';
    if (move === 0) return '<div class="move same">–</div>';
    return move > 0
        ? `<div class="move up tabular">▲${move}</div>`
        : `<div class="move down tabular">▼${-move}</div>`;
}

/**
 * @param {object} model
 * @param {string} model.region        "Japan" / "International"
 * @param {string} model.updated       "2026/10/30 07:00 JST"
 * @param {Array<{rank,name,score,dxScore,move}>} model.entries  best first
 * @param {Set<number>} [model.ours]   ranks of the group's own players
 * @param {number} [model.maxRows]
 */
function buildKopHtml({ region, updated, entries, ours = new Set(), maxRows = DEFAULT_MAX_ROWS }) {
    const top = entries.slice(0, maxRows);
    const below = entries.slice(maxRows).filter((e) => ours.has(e.rank));
    const row = (e) =>
        `<div class="row${ours.has(e.rank) ? ' ours' : ''}"><div class="rank tabular">${e.rank}</div>${moveCell(e.move)}<div class="name">${escapeHtml(displayName(e.name))}${ours.has(e.rank) ? '<span class="tag">friend</span>' : ''}</div><div class="score tabular">${formatInt(e.score)}</div><div class="dx tabular">${formatInt(e.dxScore)}</div></div>`;
    // A gap only where ranks are skipped, so the list is never taken to be contiguous when it isn't.
    let previous = 0;
    const rows = [...top, ...below]
        .map((e) => {
            const gap = e.rank - previous > 1 ? '<div class="gap">···</div>' : '';
            previous = e.rank;
            return gap + row(e);
        })
        .join('');

    const last = entries[entries.length - 1];
    const notes = [
        last ? `#${last.rank} is ${formatInt(last.score)}.` : '',
        entries.some((e) => e.move !== null) ? 'Movement is since SEGA’s previous update.' : '',
        ours.size ? 'Highlighted: players on the tracked friend list.' : '',
    ]
        .filter(Boolean)
        .join(' ');

    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="card">
  <div class="label">KOP8th · maimai DX score attack</div>
  <div class="title">${escapeHtml(region)}</div>
  <div class="sub">Top ${Math.min(maxRows, entries.length)} of ${entries.length} · updated ${escapeHtml(updated)}</div>
  <div class="table">
    <div class="head"><div class="rank">#</div><div class="move"></div><div class="name">Player</div><div class="score">Score</div><div class="dx">DX</div></div>
    ${rows}
  </div>
  ${footerHtml(notes)}
</div>
</body></html>`;
}

module.exports = { buildKopHtml, WIDTH, DEFAULT_MAX_ROWS };
