// Friend leaderboard: a ranked dot plot. Ratings run from ~10,000 to ~16,500,
// and a bar from zero would make 14,000 and 16,400 look almost equal, so
// position on a labelled axis carries the value instead (a dot's place, not a
// bar's length, which is why a non-zero axis is honest here). One series, so no
// legend; the figures are printed beside every dot because the rows are few
// enough to read. Pure: data in, HTML out.
const { TOKENS, BASE_CSS, FONT_STACK, escapeHtml, displayName, formatInt } = require('./theme');

const WIDTH = 1000;
const LANE_W = 460;
const ROW_H = 30;
// Room at each end of the lane: the end tick labels are centred on the axis
// ends and need half their width on each side or they are clipped.
const DOT_PAD = 28;
// The axis covers the main cluster, not every outlier: a couple of friends far
// below the rest would otherwise stretch it so far that the cluster collapses
// into a sliver. Anyone below the axis is pinned to its left edge with an arrow.
const AXIS_SPAN = 3000;

const CSS = `
${BASE_CSS}
.card { width: ${WIDTH}px; padding: 32px; }
.label { color: ${TOKENS.inkMuted}; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.title { font-size: 40px; font-weight: 700; line-height: 1.1; margin-top: 6px; }
.sub { color: ${TOKENS.inkSecondary}; font-size: 16px; margin-top: 8px; }
.banner { display: inline-flex; align-items: center; gap: 8px; margin-top: 12px; padding: 8px 12px; border: 1px solid ${TOKENS.warning}; border-radius: 6px; font-size: 14px; }
.banner .icon { color: ${TOKENS.warning}; font-weight: 700; }
.table { margin-top: 24px; }
.row { display: flex; align-items: center; height: ${ROW_H}px; border-radius: 6px; }
.row.me { background: ${TOKENS.raised}; }
.rank { width: 44px; text-align: right; padding-right: 12px; color: ${TOKENS.inkMuted}; font-size: 14px; }
.name { width: 290px; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 10px; }
.me-tag { margin-left: 8px; color: ${TOKENS.inkSecondary}; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.rating { width: 70px; text-align: right; font-size: 15px; font-weight: 600; padding-right: 14px; }
.lane { flex: 0 0 ${LANE_W}px; height: ${ROW_H}px; }
.axis { display: flex; align-items: flex-end; height: 22px; margin-left: ${44 + 290 + 70}px; }
svg text { font-family: ${FONT_STACK}; }
.footer { margin-top: 20px; color: ${TOKENS.inkMuted}; font-size: 12px; text-align: right; }
`;

/** Nice axis ticks covering [min, max] of the ratings that fit within AXIS_SPAN of the top. */
function axisTicks(ratings) {
    const max = Math.max(...ratings);
    const min = Math.min(...ratings.filter((r) => r >= max - AXIS_SPAN));
    const range = Math.max(max - min, 10);
    const step = [5, 10, 25, 50, 100, 250, 500, 1000, 2500].find((s) => s >= range / 4) ?? 2500;
    const lo = Math.floor(min / step) * step;
    // One rating, or all equal: the axis would have no width, so give it one step.
    const hi = Math.max(Math.ceil(max / step) * step, lo + step);
    const ticks = [];
    for (let v = lo; v <= hi; v += step) ticks.push(v);
    return { lo, hi, ticks };
}

/**
 * @param {object} model
 * @param {string} model.accountLabel   "main" / "fy"
 * @param {string|null} model.snapshotDate  readable
 * @param {number|null} model.ageDays
 * @param {boolean} model.stale
 * @param {Array<{rank:number,name:string,rating:number}>} model.friends  ranked, best first
 * @param {string|null} model.highlightName  a row to mark as "you" (normalised match done by caller)
 */
function buildLeaderboardHtml({
    accountLabel,
    snapshotDate,
    ageDays,
    stale,
    friends,
    highlightIndex = -1,
}) {
    const ratings = friends.map((f) => f.rating);
    const { lo, hi, ticks } = axisTicks(ratings);
    const x = (v) => DOT_PAD + ((Math.max(v, lo) - lo) / (hi - lo)) * (LANE_W - 2 * DOT_PAD);
    const below = friends.filter((f) => f.rating < lo).length;

    const grid = (h) =>
        ticks
            .map(
                (t) =>
                    `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${h}" stroke="${TOKENS.grid}" stroke-width="1"/>`
            )
            .join('');
    const axis = `<svg width="${LANE_W}" height="22" viewBox="0 0 ${LANE_W} 22">${ticks
        .map(
            (t) =>
                `<text class="tabular" x="${x(t)}" y="15" text-anchor="middle" fill="${TOKENS.inkMuted}" font-size="12">${formatInt(t)}</text>`
        )
        .join('')}</svg>`;

    // A dot where the rating is; below the axis, an arrow at the left edge (the number beside it is exact).
    const marker = (rating) =>
        rating < lo
            ? `<path d="M${DOT_PAD - 4} ${ROW_H / 2} l 11 -6 v 12 z" fill="${TOKENS.series1}"/>`
            : `<circle cx="${x(rating)}" cy="${ROW_H / 2}" r="5" fill="${TOKENS.series1}" stroke="${TOKENS.surface}" stroke-width="2"/>`;

    const rows = friends
        .map((f, i) => {
            const me = i === highlightIndex;
            const lane = `<svg class="lane" width="${LANE_W}" height="${ROW_H}" viewBox="0 0 ${LANE_W} ${ROW_H}">${grid(ROW_H)}<line x1="${DOT_PAD}" x2="${LANE_W - DOT_PAD}" y1="${ROW_H / 2}" y2="${ROW_H / 2}" stroke="${TOKENS.axis}" stroke-width="1"/>${marker(f.rating)}</svg>`;
            return `<div class="row${me ? ' me' : ''}"><div class="rank tabular">${escapeHtml(f.rank)}</div><div class="name">${escapeHtml(displayName(f.name))}${me ? '<span class="me-tag">you</span>' : ''}</div><div class="rating tabular">${formatInt(f.rating)}</div>${lane}</div>`;
        })
        .join('');

    const age =
        ageDays === null
            ? 'age unknown'
            : ageDays === 0
              ? 'today'
              : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
    const banner = stale
        ? `<div class="banner"><span class="icon">⚠</span><span>Out of date — this snapshot is from ${escapeHtml(snapshotDate || 'an unknown date')} (${escapeHtml(age)}); ratings and ranks may have moved.</span></div>`
        : '';

    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="card">
  <div class="label">Friend leaderboard</div>
  <div class="title">${escapeHtml(accountLabel)} account</div>
  <div class="sub">${friends.length} friends · snapshot ${escapeHtml(snapshotDate || '–')} · ${escapeHtml(age)}</div>
  ${banner}
  <div class="table"><div class="axis">${axis}</div>${rows}</div>
  <div class="footer">Axis starts at ${formatInt(lo)}, not zero — a dot's position is the rating.${below > 0 ? ` ${below} friend${below === 1 ? '' : 's'} below the axis ${below === 1 ? 'is' : 'are'} marked with an arrow at its left edge.` : ''} Generated by Atri</div>
</div>
</body></html>`;
}

module.exports = { buildLeaderboardHtml, WIDTH, axisTicks };
