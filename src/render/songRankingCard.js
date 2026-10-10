// Ranking on one chart (friends, or the global top): a ranked dot plot of
// achievement, with the tracked account's own row marked. Achievement is
// bounded (0–101%) and crowds at the top, so it is a position on an axis, not a
// bar from zero. Pure.
const {
    TOKENS,
    BASE_CSS,
    FONT_STACK,
    footerHtml,
    escapeHtml,
    displayName,
    coverUrl,
} = require('./theme');
const { PARTS_CSS, difficultyPill } = require('./parts');

const WIDTH = 1000;
const LANE_W = 400;
const ROW_H = 30;
const PAD = 30;
const MAX_ROWS = 25;
const AXIS_SPAN = 3; // percentage points below the best that the axis reaches

const CSS = `
${BASE_CSS}
${PARTS_CSS}
.card { width: ${WIDTH}px; padding: 32px; }
.top { display: flex; gap: 22px; align-items: center; }
.cover { flex: 0 0 96px; width: 96px; height: 96px; border-radius: 10px; background: ${TOKENS.axis}; overflow: hidden; }
.cover img { display: block; width: 96px; height: 96px; object-fit: cover; }
.label { color: ${TOKENS.inkMuted}; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.title { font-size: 32px; font-weight: 700; line-height: 1.15; margin-top: 4px; overflow-wrap: anywhere; }
.sub { color: ${TOKENS.inkSecondary}; font-size: 15px; margin-top: 8px; display: flex; align-items: center; gap: 8px; }
.table { margin-top: 22px; }
.axis { display: flex; height: 22px; margin-left: ${40 + 250 + 104}px; }
.row { display: flex; align-items: center; height: ${ROW_H}px; border-radius: 6px; }
.row.me { background: ${TOKENS.raised}; }
.rk { width: 40px; text-align: right; padding-right: 12px; color: ${TOKENS.inkMuted}; font-size: 14px; }
.nm { width: 250px; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 10px; }
.me-tag { margin-left: 8px; color: ${TOKENS.inkSecondary}; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.vl { width: 104px; text-align: right; font-size: 15px; font-weight: 600; padding-right: 14px; }
svg text { font-family: ${FONT_STACK}; }
`;

function ticksFor(values) {
    const max = Math.max(...values);
    const min = Math.min(...values.filter((v) => v >= max - AXIS_SPAN));
    const range = Math.max(max - min, 0.02);
    const step = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5].find((s) => s >= range / 4) ?? 5;
    const lo = Math.floor(min / step) * step;
    const hi = Math.max(Math.ceil(max / step) * step, lo + step);
    const ticks = [];
    for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(+v.toFixed(4));
    // Enough decimals to show the step exactly: 0.25 needs two, or 100.25 is shown as 100.3.
    const decimals = [0, 1, 2, 3, 4].find(
        (d) => Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-9
    );
    return { lo, hi, ticks, decimals };
}

/**
 * @param {object} model
 * @param {string} model.title
 * @param {string|null} model.cover
 * @param {string} model.difficulty
 * @param {string|null} model.level
 * @param {'friend'|'global'} model.scope
 * @param {Array<{rank:number,name:string,achievement:number,isYou:boolean}>} model.entries  best first
 * @param {string|null} model.yourScore     e.g. "100.6037%"
 * @param {number} model.totalEntries
 */
function buildSongRankingHtml({
    title,
    cover,
    difficulty,
    level,
    scope,
    entries,
    yourScore,
    totalEntries,
}) {
    const shown = entries.slice(0, MAX_ROWS);
    const { lo, hi, ticks, decimals } = ticksFor(shown.map((e) => e.achievement));
    const x = (v) => PAD + ((Math.max(v, lo) - lo) / (hi - lo)) * (LANE_W - 2 * PAD);
    const grid = ticks
        .map(
            (t) =>
                `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${ROW_H}" stroke="${TOKENS.grid}" stroke-width="1"/>`
        )
        .join('');
    const axis = `<svg width="${LANE_W}" height="22" viewBox="0 0 ${LANE_W} 22">${ticks
        .map(
            (t) =>
                `<text class="tabular" x="${x(t)}" y="15" text-anchor="middle" fill="${TOKENS.inkMuted}" font-size="12">${t.toFixed(decimals)}%</text>`
        )
        .join('')}</svg>`;
    const marker = (v) =>
        v < lo
            ? `<path d="M${PAD - 4} ${ROW_H / 2} l 11 -6 v 12 z" fill="${TOKENS.series1}"/>`
            : `<circle cx="${x(v)}" cy="${ROW_H / 2}" r="5" fill="${TOKENS.series1}" stroke="${TOKENS.surface}" stroke-width="2"/>`;
    const rows = shown
        .map(
            (e) =>
                `<div class="row${e.isYou ? ' me' : ''}"><div class="rk tabular">${escapeHtml(e.rank)}</div><div class="nm">${escapeHtml(displayName(e.name))}${e.isYou ? '<span class="me-tag">you</span>' : ''}</div><div class="vl tabular">${e.achievement.toFixed(4)}%</div><svg width="${LANE_W}" height="${ROW_H}" viewBox="0 0 ${LANE_W} ${ROW_H}">${grid}<line x1="${PAD}" x2="${LANE_W - PAD}" y1="${ROW_H / 2}" y2="${ROW_H / 2}" stroke="${TOKENS.axis}" stroke-width="1"/>${marker(e.achievement)}</svg></div>`
        )
        .join('');
    const img = coverUrl(cover, true);
    const youInList = shown.some((e) => e.isYou);
    const you = entries.find((e) => e.isYou);
    const below = shown.filter((e) => e.achievement < lo).length;
    const noun = scope === 'global' ? 'score' : 'friend';
    const youNote = youInList
        ? ''
        : you
          ? `Your score: ${escapeHtml(yourScore || `${you.achievement.toFixed(4)}%`)} (#${you.rank}).`
          : yourScore
            ? `Your score: ${escapeHtml(yourScore)}${scope === 'global' ? ` — not in the top ${totalEntries ?? entries.length}` : ''}.`
            : '';
    const notes = [
        entries.length > MAX_ROWS
            ? `Showing the top ${MAX_ROWS} of ${totalEntries ?? entries.length}.`
            : '',
        youNote,
        'Achievement only; clear badges of other players are not visible.',
        `Axis starts at ${lo.toFixed(decimals)}%.`,
        below > 0
            ? `${below} ${noun}${below === 1 ? '' : 's'} below the axis ${below === 1 ? 'is' : 'are'} marked with an arrow at its left edge.`
            : '',
    ].filter(Boolean);
    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="card">
  <div class="top">
    <div class="cover">${img ? `<img src="${escapeHtml(img)}" onerror="this.style.display='none'">` : ''}</div>
    <div>
      <div class="label">${scope === 'global' ? 'Global top scores' : 'Friend ranking'}</div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub">${difficultyPill(difficulty, level)}<span>${entries.length} ${scope === 'global' ? 'scores' : 'friends'}</span></div>
    </div>
  </div>
  <div class="table"><div class="axis">${axis}</div>${rows}</div>
  ${footerHtml(notes.join(' '))}
</div>
</body></html>`;
}

module.exports = { buildSongRankingHtml, WIDTH, ticksFor };
