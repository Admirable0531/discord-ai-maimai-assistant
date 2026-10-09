// Song card: the cover large, the song's details, and every chart with its
// level, exact constant, note count and charter. Replaces the bare cover the
// chart-preview tool used to attach. Pure: data in, HTML out.
const { TOKENS, BASE_CSS, escapeHtml, coverUrl } = require('./theme');
const { DIFFICULTIES } = require('./b50Card');

const WIDTH = 1000;

const CSS = `
${BASE_CSS}
.card { width: ${WIDTH}px; padding: 32px; }
.top { display: flex; gap: 28px; }
.cover { flex: 0 0 220px; width: 220px; height: 220px; border-radius: 12px; background: ${TOKENS.axis}; overflow: hidden; }
.cover img { display: block; width: 220px; height: 220px; object-fit: cover; }
.head { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.label { color: ${TOKENS.inkMuted}; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.title { font-size: 38px; font-weight: 700; line-height: 1.15; margin-top: 6px; overflow-wrap: anywhere; }
.artist { font-size: 20px; color: ${TOKENS.inkSecondary}; margin-top: 8px; }
.facts { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-top: 18px; }
.fact .k { color: ${TOKENS.inkMuted}; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.fact .v { font-size: 16px; margin-top: 2px; }
.regions { margin-top: 14px; font-size: 14px; color: ${TOKENS.inkSecondary}; }
.regions .k { color: ${TOKENS.inkMuted}; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; margin-right: 8px; }
.charts { margin-top: 28px; display: flex; flex-direction: column; gap: 8px; }
.chart { display: flex; align-items: center; gap: 16px; min-height: 58px; padding: 8px 16px; background: ${TOKENS.raised}; border-radius: 8px; }
.chart.on { outline: 2px solid ${TOKENS.series1}; outline-offset: -2px; }
.pill { flex: 0 0 auto; min-width: 74px; text-align: center; padding: 2px 8px; border-radius: 4px; color: #111; font-size: 13px; font-weight: 700; }
.type { width: 30px; color: ${TOKENS.inkMuted}; font-size: 12px; font-weight: 600; }
.lv { width: 52px; font-size: 16px; color: ${TOKENS.inkSecondary}; }
.const { width: 62px; font-size: 24px; font-weight: 700; }
.notes { flex: 1; min-width: 0; }
.notes .total { font-size: 15px; font-weight: 600; }
.notes .split { margin-top: 2px; color: ${TOKENS.inkMuted}; font-size: 12px; }
.designer { width: 200px; text-align: right; color: ${TOKENS.inkSecondary}; font-size: 14px; overflow-wrap: anywhere; }
.footer { margin-top: 20px; color: ${TOKENS.inkMuted}; font-size: 12px; text-align: right; }
`;

function fact(label, value) {
    return value
        ? `<div class="fact"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div></div>`
        : '';
}

/** Which regions have the song, as text with a tick or a cross — never colour alone. */
function regionsLine(availability) {
    if (!availability) return '';
    const text = availability.map((r) => `${escapeHtml(r.label)} ${r.on ? '✓' : '✗'}`).join(' · ');
    return `<div class="regions"><span class="k">Available</span> ${text}</div>`;
}

function chartRow(chart, highlight) {
    const diff = DIFFICULTIES[String(chart.difficulty || '').toLowerCase()] || {
        label: String(chart.difficulty || '?')
            .slice(0, 5)
            .toUpperCase(),
        color: TOKENS.inkMuted,
    };
    const n = chart.notes;
    const split = n
        ? ['tap', 'hold', 'slide', 'touch', 'break']
              .filter((k) => Number.isFinite(n[k]) && n[k] > 0)
              .map((k) => `${k} ${n[k]}`)
              .join(' · ')
        : '';
    const on =
        highlight && highlight.type === chart.type && highlight.difficulty === chart.difficulty;
    const designer = chart.designer && chart.designer !== '-' ? chart.designer : '';
    return `<div class="chart${on ? ' on' : ''}">
  <span class="pill" style="background:${diff.color}">${escapeHtml(diff.label)}</span>
  <span class="type">${escapeHtml(String(chart.type || '').toUpperCase())}</span>
  <span class="lv tabular">${escapeHtml(chart.level)}</span>
  <span class="const tabular">${escapeHtml(chart.constant ?? '?')}</span>
  <div class="notes"><div class="total tabular">${n?.total != null ? `${escapeHtml(n.total)} notes` : ''}</div>${split ? `<div class="split tabular">${escapeHtml(split)}</div>` : ''}</div>
  <div class="designer">${escapeHtml(designer)}</div>
</div>`;
}

/**
 * @param {object} model
 * @param {string} model.title
 * @param {string} model.artist
 * @param {string} model.category
 * @param {number|null} model.bpm
 * @param {string} model.version
 * @param {string|null} model.intlVersion
 * @param {string|null} model.releaseDate
 * @param {string|null} model.cover        image name from the song data
 * @param {Array<{type,difficulty,level,constant,designer,notes}>} model.charts
 * @param {{type,difficulty}|null} model.highlight  the chart the user asked about
 */
function buildSongCardHtml({
    availability,
    title,
    artist,
    category,
    bpm,
    version,
    intlVersion,
    releaseDate,
    cover,
    charts,
    highlight,
}) {
    const img = coverUrl(cover, true);
    const versionText =
        intlVersion && intlVersion !== version
            ? `${version} (International: ${intlVersion})`
            : version;
    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="card">
  <div class="top">
    <div class="cover">${img ? `<img src="${escapeHtml(img)}" onerror="this.style.display='none'">` : ''}</div>
    <div class="head">
      <div class="label">${escapeHtml(category || 'maimai')}</div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="artist">${escapeHtml(artist)}</div>
      <div class="facts">${fact('BPM', bpm != null ? String(bpm) : '')}${fact('Version', versionText)}${fact('Released', releaseDate)}</div>
      ${regionsLine(availability)}
    </div>
  </div>
  <div class="charts">${charts.map((c) => chartRow(c, highlight)).join('')}</div>
  <div class="footer">Constants, notes and covers from arcade-songs · Generated by Atri</div>
</div>
</body></html>`;
}

module.exports = { buildSongCardHtml, WIDTH };
