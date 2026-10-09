// Rating-history card: one line (rating over time), built to the dataviz
// skill's spec for a single time series — 2px line, ~10% area wash, an end dot
// with a surface ring, hairline recessive grid, direct labels only on the
// start, the peak and the latest value. A single series gets no legend (the
// title names it) and, being a static image, no hover layer: the figures a
// tooltip would have carried go back to the model in the tool result.
// Pure: data in, HTML out (see browserRenderer.js for the PNG).
const { TOKENS, BASE_CSS, FONT_STACK, escapeHtml, formatInt } = require('./theme');

const WIDTH = 1200;
const DAY = 86400000;
// Snapshots are nightly, so a hole of more than two weeks is a period nothing
// was recorded, not a stretch where the rating held still. Drawing a straight
// line across it would invent data, so the line breaks there instead.
const GAP_BREAK_DAYS = 14;

const SVG = { width: 1136, height: 420, left: 64, right: 92, top: 16, bottom: 40 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CSS = `
${BASE_CSS}
.card { width: ${WIDTH}px; padding: 32px; }
.label { color: ${TOKENS.inkMuted}; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.top { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 20px; }
.hero { font-size: 64px; font-weight: 700; line-height: 1; margin-top: 6px; }
.delta { font-size: 17px; margin-top: 10px; }
.delta .icon { margin-right: 6px; }
.who { text-align: right; }
.who .name { font-size: 22px; color: ${TOKENS.ink}; }
.who .sub { font-size: 14px; color: ${TOKENS.inkSecondary}; margin-top: 6px; }
svg text { font-family: ${FONT_STACK}; }
.footer { margin-top: 12px; color: ${TOKENS.inkMuted}; font-size: 12px; text-align: right; }
`;

/** A tick step from a readable ladder, giving roughly `target` ticks across `range`. */
function niceStep(range, target = 6) {
    const raw = range / target;
    return [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000].find((s) => s >= raw) ?? 5000;
}

function formatDay(t, withYear = true) {
    const d = new Date(t);
    const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    return withYear ? `${base}, ${d.getUTCFullYear()}` : base;
}

/** [{t, label}] across [t0, t1]: weekly for short spans, otherwise aligned month boundaries. */
function timeTicks(t0, t1) {
    const spanDays = (t1 - t0) / DAY;
    const ticks = [];
    if (spanDays <= 70) {
        const step = (spanDays <= 21 ? 7 : 14) * DAY;
        for (let t = t0; t <= t1; t += step) ticks.push({ t, label: formatDay(t, false) });
        return ticks;
    }
    const start = new Date(t0);
    for (const stepMonths of [1, 2, 3, 6, 12]) {
        ticks.length = 0;
        let y = start.getUTCFullYear();
        let m = start.getUTCMonth() + 1; // first boundary after the first point
        for (;;) {
            if (m > 11) {
                y += Math.floor(m / 12);
                m %= 12;
            }
            const t = Date.UTC(y, m, 1);
            if (t > t1) break;
            if (m % stepMonths === 0) {
                ticks.push({ t, label: `${MONTHS[m]} ${y}` });
            }
            m++;
        }
        if (ticks.length <= 7) break;
    }
    return ticks;
}

/** Splits ascending points into runs wherever the gap exceeds GAP_BREAK_DAYS. */
function splitRuns(points) {
    const runs = [];
    for (const p of points) {
        const run = runs[runs.length - 1];
        if (run && p.t - run[run.length - 1].t <= GAP_BREAK_DAYS * DAY) run.push(p);
        else runs.push([p]);
    }
    return runs;
}

/**
 * @param {object} model
 * @param {string} model.playerName
 * @param {Array<{t: number, rating: number}>} model.points  ascending, one per day
 */
function buildRatingChartHtml({ playerName, points, excluded = 0 }) {
    const first = points[0];
    const last = points[points.length - 1];
    let peak = points[0];
    for (const p of points) if (p.rating > peak.rating) peak = p;
    const lowest = Math.min(...points.map((p) => p.rating));

    const t0 = first.t;
    const t1 = Math.max(last.t, t0 + 7 * DAY);
    const range = Math.max(peak.rating - lowest, 10);
    const step = niceStep(range * 1.1);
    const yMin = Math.floor((lowest - range * 0.05) / step) * step;
    const yMax = Math.ceil((peak.rating + range * 0.05) / step) * step;

    const plotW = SVG.width - SVG.left - SVG.right;
    const plotH = SVG.height - SVG.top - SVG.bottom;
    const x = (t) => SVG.left + ((t - t0) / (t1 - t0)) * plotW;
    const y = (v) => SVG.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const baseline = y(yMin);

    const grid = [];
    for (let v = yMin; v <= yMax; v += step) {
        grid.push(
            `<line x1="${SVG.left}" x2="${SVG.left + plotW}" y1="${y(v)}" y2="${y(v)}" stroke="${v === yMin ? TOKENS.axis : TOKENS.grid}" stroke-width="1"/>` +
                `<text class="tabular" x="${SVG.left - 10}" y="${y(v) + 4}" text-anchor="end" fill="${TOKENS.inkMuted}" font-size="12">${formatInt(v)}</text>`
        );
    }
    const xLabels = timeTicks(t0, t1).map(
        (tick) =>
            `<text class="tabular" x="${x(tick.t)}" y="${baseline + 24}" text-anchor="middle" fill="${TOKENS.inkMuted}" font-size="12">${escapeHtml(tick.label)}</text>`
    );

    const runs = splitRuns(points);
    const marks = runs.map((run) => {
        if (run.length === 1) {
            return `<circle cx="${x(run[0].t)}" cy="${y(run[0].rating)}" r="4" fill="${TOKENS.series1}"/>`;
        }
        const line = run
            .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.rating).toFixed(1)}`)
            .join(' ');
        const area = `${line} L${x(run[run.length - 1].t).toFixed(1)} ${baseline} L${x(run[0].t).toFixed(1)} ${baseline} Z`;
        return (
            `<path d="${area}" fill="${TOKENS.series1}" fill-opacity="0.10"/>` +
            `<path d="${line}" fill="none" stroke="${TOKENS.series1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
        );
    });

    // Direct labels, sparingly: ink in text colours, identity from the mark beside it.
    const ring = (p) =>
        `<circle cx="${x(p.t)}" cy="${y(p.rating)}" r="5" fill="${TOKENS.series1}" stroke="${TOKENS.surface}" stroke-width="2"/>`;
    const labels = [ring(last)];
    labels.push(
        `<text class="tabular" x="${x(last.t) + 12}" y="${y(last.rating) + 5}" fill="${TOKENS.ink}" font-size="15" font-weight="600">${formatInt(last.rating)}</text>`
    );
    if (points.length > 1) {
        labels.push(
            ring(first),
            `<text class="tabular" x="${x(first.t) + 4}" y="${y(first.rating) + 26}" fill="${TOKENS.inkSecondary}" font-size="13">${formatInt(first.rating)}</text>`
        );
    }
    if (
        peak.t !== last.t &&
        peak.t !== first.t &&
        peak.rating > last.rating &&
        x(last.t) - x(peak.t) > 70
    ) {
        labels.push(
            ring(peak),
            `<text class="tabular" x="${x(peak.t)}" y="${y(peak.rating) - 14}" text-anchor="middle" fill="${TOKENS.inkSecondary}" font-size="13">Peak ${formatInt(peak.rating)}</text>`
        );
    }

    const change = last.rating - first.rating;
    const deltaColor = change > 0 ? TOKENS.good : change < 0 ? '#d03b3b' : TOKENS.inkSecondary;
    const deltaIcon = change > 0 ? '▲' : change < 0 ? '▼' : '■';
    const deltaText =
        points.length > 1
            ? `${change > 0 ? '+' : change < 0 ? '−' : ''}${formatInt(Math.abs(change))} since ${formatDay(first.t)}`
            : 'only one snapshot recorded';
    const hasGaps = runs.length > 1;

    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="card">
  <div class="top">
    <div>
      <div class="label">Rating history</div>
      <div class="hero">${formatInt(last.rating)}</div>
      <div class="delta" style="color:${deltaColor}"><span class="icon">${deltaIcon}</span>${escapeHtml(deltaText)}</div>
    </div>
    <div class="who">
      <div class="name">${escapeHtml(playerName)}</div>
      <div class="sub">${escapeHtml(formatDay(first.t))} – ${escapeHtml(formatDay(last.t))} · ${points.length} day${points.length === 1 ? '' : 's'} recorded</div>
    </div>
  </div>
  <svg width="${SVG.width}" height="${SVG.height}" viewBox="0 0 ${SVG.width} ${SVG.height}" xmlns="http://www.w3.org/2000/svg">
    ${grid.join('')}${xLabels.join('')}${marks.join('')}${labels.join('')}
  </svg>
  <div class="footer">${hasGaps ? 'Breaks in the line are stretches with no recorded snapshot. ' : ''}${excluded > 0 ? `${excluded} snapshot${excluded === 1 ? '' : 's'} with a sudden drop that recovered within days ${excluded === 1 ? 'was' : 'were'} left out as likely scrape errors. ` : ''}Generated by Atri</div>
</div>
</body></html>`;
}

module.exports = { buildRatingChartHtml, WIDTH, GAP_BREAK_DAYS, splitRuns, niceStep, timeTicks };
