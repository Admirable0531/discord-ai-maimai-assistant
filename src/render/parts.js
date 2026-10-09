// Small pieces shared by the play cards: clear / sync badges, a difficulty
// pill, and the attempts sparkline. Pure string builders.
const { TOKENS, escapeHtml } = require('./theme');
const { DIFFICULTIES } = require('./b50Card');

const SYNC_LABEL = { sync: 'SYNC', fs: 'FS', fsp: 'FS+', fdx: 'FDX', fdxp: 'FDX+' };

const PARTS_CSS = `
.pill { padding: 1px 7px; border-radius: 4px; color: #111; font-size: 12px; font-weight: 700; }
.tag { color: ${TOKENS.inkMuted}; font-size: 11px; font-weight: 600; }
.bpill { display: inline-block; padding: 1px 7px; border: 1px solid ${TOKENS.inkMuted}; border-radius: 4px; color: ${TOKENS.ink}; font-size: 12px; font-weight: 700; }
.bpill + .bpill { margin-left: 4px; }
`;

/** Difficulty as a coloured pill that also spells the difficulty out (never colour alone). */
function difficultyPill(difficulty, level) {
    const d = DIFFICULTIES[String(difficulty || '').toLowerCase()] || {
        label: String(difficulty || '?')
            .slice(0, 4)
            .toUpperCase(),
        color: TOKENS.inkMuted,
    };
    return `<span class="pill" style="background:${d.color}">${escapeHtml(d.label)}${level ? ` ${escapeHtml(level)}` : ''}</span>`;
}

/** Clear-type and sync-tier badges; empty when the play has neither. */
function badgePills(clear, sync) {
    return [clear, sync && SYNC_LABEL[sync]]
        .filter(Boolean)
        .map((text) => `<span class="bpill">${escapeHtml(text)}</span>`)
        .join('');
}

/**
 * A word-sized line of `values` (oldest first): no axes, the final value
 * marked with a ringed dot. One series, so the series colour.
 */
function sparkline(values, { w = 120, h = 28 } = {}) {
    if (values.length < 2) return '';
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = 4;
    const x = (i) => pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = (v) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad));
    const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const last = values.length - 1;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="${TOKENS.series1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="4" fill="${TOKENS.series1}" stroke="${TOKENS.raised}" stroke-width="2"/></svg>`;
}

module.exports = { PARTS_CSS, difficultyPill, badgePills, sparkline, SYNC_LABEL };
