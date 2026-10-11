// A picture of the moments a chart analysis flagged: for each one, the sensor
// ring with every note and slide path inside a short window, so a player can
// see what sits where and in what order. Pure; input is the analysed chart.
const { TOKENS, BASE_CSS, escapeHtml, footerHtml } = require('./theme');
const { slideTracks } = require('../chart/slidePaths');
const { sensorName } = require('../chart/geometry');

const WIDTH = 560;
const SIZE = 330; // ring drawing, px
const HALF_WINDOW = 0.5; // s shown either side of the finding
const R = SIZE / 2 - 14;
const C = SIZE / 2;

const COLORS = {
    tap: '#ff6aa8',
    break: '#ff9a3c',
    hold: '#f5c542',
    touch: '#4fd1c5',
    slide: '#7aa7ff',
    flag: '#ffffff',
};

/** Centre of a sensor on the ring: angles clockwise from the top. */
function sensorXY(name) {
    if (name === 'C') return { x: C, y: C };
    const letter = name[0];
    const n = Number(name.slice(1));
    const aligned = letter === 'A' || letter === 'B';
    const angle = ((aligned ? 22.5 + 45 * (n - 1) : 45 * (n - 1)) * Math.PI) / 180;
    const radius = { A: 0.8, B: 0.5, D: 0.97, E: 0.68 }[letter] * R;
    return { x: C + radius * Math.sin(angle), y: C - radius * Math.cos(angle) };
}

const buttonXY = (lane) => sensorXY(`A${lane}`);
const ms = (s) => `${s >= 0 ? '+' : ''}${Math.round(s * 1000)}`;

function ringSvg(events, at) {
    const near = events.filter((e) =>
        e.kind === 'slide'
            ? e.start - 0.15 <= at + HALF_WINDOW && e.end + 0.15 >= at - HALF_WINDOW
            : Math.abs(e.time - at) <= HALF_WINDOW
    );
    const parts = [];
    parts.push(
        `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${TOKENS.axis}" stroke-width="1.5"/>`
    );
    for (let n = 1; n <= 8; n++) {
        const p = buttonXY(n);
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="13" fill="none" stroke="${TOKENS.axis}"/>`);
        parts.push(
            `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-size="11" fill="${TOKENS.inkMuted}">${n}</text>`
        );
    }
    // Slide paths first so notes draw over them.
    for (const e of near.filter((x) => x.kind === 'slide')) {
        const tracks = slideTracks(e);
        if (!tracks) continue;
        const active = at >= e.start - 0.05 && at <= e.end + 0.05;
        for (const track of tracks) {
            const points = track.map((alts) => sensorXY(alts[0]));
            parts.push(
                `<polyline points="${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${COLORS.slide}" stroke-width="${active ? 3 : 1.5}" stroke-opacity="${active ? 0.9 : 0.45}" stroke-linejoin="round"/>`
            );
            const end = points[points.length - 1];
            parts.push(`<circle cx="${end.x}" cy="${end.y}" r="4" fill="${COLORS.slide}"/>`);
        }
        const head = buttonXY(e.head);
        parts.push(
            `<text x="${head.x}" y="${head.y + 5}" text-anchor="middle" font-size="15" fill="${COLORS.slide}">★</text>`
        );
        parts.push(
            `<text x="${head.x}" y="${head.y - 11}" text-anchor="middle" font-size="10" fill="${TOKENS.inkSecondary}">${ms(e.start - at)}</text>`
        );
    }
    for (const e of near.filter((x) => x.kind !== 'slide')) {
        const place = e.sensor ? sensorXY(sensorName(e)) : buttonXY(e.lane);
        const color = COLORS[e.kind === 'touchHold' ? 'touch' : e.kind] || COLORS.tap;
        const shape = e.sensor
            ? `<rect x="${place.x - 7}" y="${place.y - 7}" width="14" height="14" rx="3" fill="${color}"/>`
            : `<circle cx="${place.x}" cy="${place.y}" r="8" fill="${color}"/>`;
        parts.push(shape);
        parts.push(
            `<text x="${place.x}" y="${place.y + 20}" text-anchor="middle" font-size="10" fill="${TOKENS.inkSecondary}">${ms(e.time - at)}</text>`
        );
        if (e.sensor)
            parts.push(
                `<text x="${place.x}" y="${place.y - 11}" text-anchor="middle" font-size="9" fill="${TOKENS.inkMuted}">${sensorName(e)}</text>`
            );
    }
    return `<svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">${parts.join('')}</svg>`;
}

const CSS = `
${BASE_CSS}
.card { width: ${WIDTH}px; padding: 22px 20px 20px; }
.label { color: ${TOKENS.inkMuted}; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.title { font-size: 24px; font-weight: 700; margin-top: 4px; overflow-wrap: anywhere; }
.moment { margin-top: 18px; padding: 14px; background: ${TOKENS.raised}; border-radius: 10px; }
.head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.sev { font-weight: 700; font-size: 13px; padding: 2px 8px; border-radius: 6px; background: ${TOKENS.axis}; }
.sev3 { background: #7a2c2c; }
.sev2 { background: #6b5a1c; }
.when { color: ${TOKENS.inkSecondary}; font-size: 14px; }
.what { margin-top: 8px; font-size: 15px; line-height: 1.4; color: ${TOKENS.inkSecondary}; }
.ring { display: flex; justify-content: center; margin-top: 8px; }
.legend { margin-top: 16px; font-size: 12px; color: ${TOKENS.inkMuted}; line-height: 1.6; }
`;

/**
 * @param {{title: string, difficulty: string, events: object[], findings: object[], note?: string}} input
 *   `findings` are the ones to draw (from report.summarise's `picked`, with raw time).
 */
function buildChartMomentHtml({ title, difficulty, events, findings }) {
    const moments = findings
        .map(
            (f) => `
<div class="moment">
  <div class="head"><span class="sev sev${f.severity}">${escapeHtml(f.rule)} · severity ${f.severity}</span><span class="when">bar ${f.bar} · ${escapeHtml(f.clock)}</span></div>
  <div class="what">${escapeHtml(f.text)}</div>
  <div class="ring">${ringSvg(events, f.time)}</div>
</div>`
        )
        .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="card">
<div class="label">Chart check · ${escapeHtml(difficulty)}</div>
<div class="title">${escapeHtml(title)}</div>
${moments}
<div class="legend">Numbers are milliseconds from the flagged moment. Pink tap · orange break · yellow hold · teal touch · blue slide (★ is the star). Slide timing assumes even travel.</div>
${footerHtml('Fan transcription of the official chart; it may differ from the game. Risks, not certainties.')}
</div></body></html>`;
}

module.exports = { buildChartMomentHtml, WIDTH };
