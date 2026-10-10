// Friend leaderboard: a ranked dot plot. Ratings run from ~10,000 to ~16,500,
// and a bar from zero would make 14,000 and 16,400 look almost equal, so
// position on a labelled axis carries the value instead (a dot's place, not a
// bar's length, which is why a non-zero axis is honest here). One series, so no
// legend; the figures are printed beside every dot because the rows are few
// enough to read. Pure: data in, HTML out.
const {
    TOKENS,
    BASE_CSS,
    FONT_STACK,
    escapeHtml,
    footerHtml,
    displayName,
    formatInt,
} = require('./theme');

// Sized for a phone: Discord shows the image about 360px wide, so a 1000px-wide
// card was drawn at a third of its size and 15px text came out under 6px. At
// 620px the same text lands near 9px. Rows are taller and the type larger for
// the same reason, and only the top MAX_ROWS are drawn by default — a long
// list is long on a phone, and the people at the bottom are rarely the question.
const WIDTH = 620;
const LANE_W = 200;
const ROW_H = 38;
const DEFAULT_MAX_ROWS = 25;
// Room at each end of the lane: the end tick labels are centred on the axis
// ends and need half their width on each side or they are clipped.
const DOT_PAD = 26;
// The axis covers the main cluster, not every outlier: a couple of friends far
// below the rest would otherwise stretch it so far that the cluster collapses
// into a sliver. Anyone below the axis is pinned to its left edge with an arrow.
const AXIS_SPAN = 3000;

const CSS = `
${BASE_CSS}
.card { width: ${WIDTH}px; padding: 28px 22px 24px; }
.label { color: ${TOKENS.inkMuted}; font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.title { font-size: 38px; font-weight: 700; line-height: 1.1; margin-top: 6px; }
.sub { color: ${TOKENS.inkSecondary}; font-size: 17px; margin-top: 8px; }
.banner { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; padding: 9px 12px; border: 1px solid ${TOKENS.warning}; border-radius: 6px; font-size: 15px; line-height: 1.35; }
.banner .icon { color: ${TOKENS.warning}; font-weight: 700; }
.table { margin-top: 18px; }
.row { display: flex; align-items: center; height: ${ROW_H}px; border-radius: 6px; }
.row.me { background: ${TOKENS.raised}; }
.rank { flex: 0 0 34px; text-align: right; padding-right: 10px; color: ${TOKENS.inkMuted}; font-size: 15px; }
.name { flex: 1; min-width: 0; font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 8px; }
.me-tag { margin-left: 8px; color: ${TOKENS.inkSecondary}; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.rating { flex: 0 0 70px; text-align: right; font-size: 17px; font-weight: 600; padding-right: 12px; }
.lane { flex: 0 0 ${LANE_W}px; height: ${ROW_H}px; }
.gap { height: ${ROW_H}px; display: flex; align-items: center; justify-content: center; color: ${TOKENS.inkMuted}; font-size: 15px; letter-spacing: 0.3em; }
.axis { display: flex; justify-content: flex-end; align-items: flex-end; height: 24px; }
svg text { font-family: ${FONT_STACK}; }
`;

/** Nice axis ticks covering [min, max] of the ratings that fit within AXIS_SPAN of the top. */
function axisTicks(ratings) {
    const max = Math.max(...ratings);
    const min = Math.min(...ratings.filter((r) => r >= max - AXIS_SPAN));
    const range = Math.max(max - min, 10);
    const step = [5, 10, 25, 50, 100, 250, 500, 1000, 2500].find((s) => s >= range / 3) ?? 2500;
    const lo = Math.floor(min / step) * step;
    // One rating, or all equal: the axis would have no width, so give it one step.
    const hi = Math.max(Math.ceil(max / step) * step, lo + step);
    const ticks = [];
    for (let v = lo; v <= hi; v += step) ticks.push(v);
    return { lo, hi, ticks };
}

/**
 * The rows to draw: the first `maxRows`, plus the highlighted friend when they
 * rank lower than that (set apart by a gap, so the list isn't taken to be contiguous).
 */
function pickRows(friends, highlightIndex, maxRows) {
    const shown = friends.slice(0, maxRows).map((f, i) => ({ f, i }));
    if (highlightIndex >= maxRows) shown.push({ f: friends[highlightIndex], i: highlightIndex });
    return shown;
}

/**
 * @param {object} model
 * @param {string} model.accountLabel   "main" / "fy"
 * @param {string|null} model.snapshotDate  readable
 * @param {number|null} model.ageDays
 * @param {boolean} model.stale
 * @param {Array<{rank:number,name:string,rating:number}>} model.friends  ranked, best first
 * @param {number} [model.highlightIndex]  index into friends of the row to mark "you", or -1
 * @param {number} [model.maxRows]  how many of the top friends to draw
 */
function buildLeaderboardHtml({
    accountLabel,
    snapshotDate,
    ageDays,
    stale,
    friends,
    highlightIndex = -1,
    maxRows = DEFAULT_MAX_ROWS,
}) {
    const shown = pickRows(friends, highlightIndex, Math.max(1, maxRows));
    const { lo, hi, ticks } = axisTicks(shown.map(({ f }) => f.rating));
    const x = (v) => DOT_PAD + ((Math.max(v, lo) - lo) / (hi - lo)) * (LANE_W - 2 * DOT_PAD);
    const below = shown.filter(({ f }) => f.rating < lo).length;
    const hidden = friends.length - shown.length;

    const grid = (h) =>
        ticks
            .map(
                (t) =>
                    `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${h}" stroke="${TOKENS.grid}" stroke-width="1"/>`
            )
            .join('');
    const axis = `<svg width="${LANE_W}" height="24" viewBox="0 0 ${LANE_W} 24">${ticks
        .map(
            (t) =>
                `<text class="tabular" x="${x(t)}" y="17" text-anchor="middle" fill="${TOKENS.inkMuted}" font-size="13">${formatInt(t)}</text>`
        )
        .join('')}</svg>`;

    // A dot where the rating is; below the axis, an arrow at the left edge (the number beside it is exact).
    const marker = (rating) =>
        rating < lo
            ? `<path d="M${DOT_PAD - 4} ${ROW_H / 2} l 11 -6 v 12 z" fill="${TOKENS.series1}"/>`
            : `<circle cx="${x(rating)}" cy="${ROW_H / 2}" r="6" fill="${TOKENS.series1}" stroke="${TOKENS.surface}" stroke-width="2"/>`;

    let previous = -1;
    const rows = shown
        .map(({ f, i }) => {
            const me = i === highlightIndex;
            const gap = i - previous > 1 ? '<div class="gap">···</div>' : '';
            previous = i;
            const lane = `<svg class="lane" width="${LANE_W}" height="${ROW_H}" viewBox="0 0 ${LANE_W} ${ROW_H}">${grid(ROW_H)}<line x1="${DOT_PAD}" x2="${LANE_W - DOT_PAD}" y1="${ROW_H / 2}" y2="${ROW_H / 2}" stroke="${TOKENS.axis}" stroke-width="1"/>${marker(f.rating)}</svg>`;
            return `${gap}<div class="row${me ? ' me' : ''}"><div class="rank tabular">${escapeHtml(f.rank)}</div><div class="name">${escapeHtml(displayName(f.name))}${me ? '<span class="me-tag">you</span>' : ''}</div><div class="rating tabular">${formatInt(f.rating)}</div>${lane}</div>`;
        })
        .join('');

    const age =
        ageDays === null
            ? 'age unknown'
            : ageDays === 0
              ? 'today'
              : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
    const banner = stale
        ? `<div class="banner"><span class="icon">⚠</span><span>Out of date — snapshot from ${escapeHtml(snapshotDate || 'an unknown date')} (${escapeHtml(age)}); ratings and ranks may have moved.</span></div>`
        : '';
    const count =
        hidden > 0
            ? `Top ${shown.length - (highlightIndex >= maxRows ? 1 : 0)} of ${friends.length} friends`
            : `${friends.length} friends`;

    const notes = [
        `Axis starts at ${formatInt(lo)}, not zero — a dot's position is the rating.`,
        below > 0
            ? `${below} friend${below === 1 ? '' : 's'} below the axis ${below === 1 ? 'is' : 'are'} marked with an arrow.`
            : '',
    ]
        .filter(Boolean)
        .join(' ');

    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="card">
  <div class="label">Friend leaderboard</div>
  <div class="title">${escapeHtml(accountLabel)} account</div>
  <div class="sub">${count} · ${escapeHtml(snapshotDate || '–')} · ${escapeHtml(age)}</div>
  ${banner}
  <div class="table"><div class="axis">${axis}</div>${rows}</div>
  ${footerHtml(notes)}
</div>
</body></html>`;
}

module.exports = { buildLeaderboardHtml, WIDTH, axisTicks, DEFAULT_MAX_ROWS };
