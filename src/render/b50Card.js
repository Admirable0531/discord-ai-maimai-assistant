// The B50 card: a player's best 15 new-version and best 35 old-version charts
// as a grid of tiles (cover, title, difficulty + constant, achievement, rank,
// rating), under a header with the rating and how fresh the data is.
// Pure: data in, HTML out (see browserRenderer.js for the PNG).
const { TOKENS, BASE_CSS, escapeHtml, formatInt, coverUrl } = require('./theme');

// Wide enough that the bottom row of a tile (achievement, rank, rating) fits next to
// the cover: at 1280 the rating, the number that matters most, was clipped.
const WIDTH = 1400;

// The game's own difficulty colours, as identity marks. The pill also spells the
// difficulty out, so identity is never colour alone.
const DIFFICULTIES = {
    basic: { label: 'BAS', color: '#45c124' },
    advanced: { label: 'ADV', color: '#ffa81e' },
    expert: { label: 'EXP', color: '#ff5e5e' },
    master: { label: 'MAS', color: '#a45bdc' },
    remaster: { label: 'Re:M', color: '#dcc9f7' },
};

const CSS = `
${BASE_CSS}
.card { width: ${WIDTH}px; padding: 32px; }
.header { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; margin-bottom: 28px; }
.label { color: ${TOKENS.inkMuted}; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.hero { font-size: 72px; font-weight: 700; line-height: 1; margin-top: 6px; }
.player { font-size: 22px; color: ${TOKENS.inkSecondary}; margin-top: 10px; }
.stats { display: flex; gap: 40px; }
.stat .value { font-size: 30px; font-weight: 600; margin-top: 4px; }
.meta { color: ${TOKENS.inkMuted}; font-size: 14px; margin-top: 6px; text-align: right; }
.banner { display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 12px; border: 1px solid ${TOKENS.warning}; border-radius: 6px; color: ${TOKENS.ink}; font-size: 14px; }
.banner .icon { color: ${TOKENS.warning}; font-weight: 700; }
.section { margin-top: 24px; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.section-head .name { font-size: 18px; font-weight: 600; }
.section-head .sum { color: ${TOKENS.inkSecondary}; font-size: 15px; }
.grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.tile { display: flex; height: 96px; background: ${TOKENS.raised}; border-radius: 8px; overflow: hidden; }
.cover { position: relative; flex: 0 0 96px; background: ${TOKENS.axis}; }
.cover img { display: block; width: 96px; height: 96px; object-fit: cover; }
.idx { position: absolute; left: 0; top: 0; min-width: 22px; padding: 1px 5px; background: rgba(0,0,0,0.65); color: ${TOKENS.ink}; font-size: 11px; font-weight: 600; border-bottom-right-radius: 6px; text-align: center; }
.info { flex: 1; min-width: 0; padding: 7px 10px; display: flex; flex-direction: column; justify-content: space-between; }
.title { font-size: 13px; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.row1 { display: flex; align-items: center; gap: 6px; }
.pill { padding: 1px 7px; border-radius: 4px; color: #111; font-size: 12px; font-weight: 700; }
.tag { color: ${TOKENS.inkMuted}; font-size: 11px; font-weight: 600; }
.row2 { display: flex; align-items: baseline; gap: 6px; font-size: 12px; white-space: nowrap; }
.achv { color: ${TOKENS.inkSecondary}; min-width: 0; overflow: hidden; }
.rank { color: ${TOKENS.inkSecondary}; font-weight: 600; flex: 0 0 auto; }
.rt { margin-left: auto; flex: 0 0 auto; font-size: 17px; font-weight: 700; }
.footer { margin-top: 24px; color: ${TOKENS.inkMuted}; font-size: 12px; text-align: right; }
`;

function sumRatings(plays) {
    return plays.reduce((total, p) => total + (parseInt(p.Rating, 10) || 0), 0);
}

function tile(play, index, covers) {
    const diff = DIFFICULTIES[String(play.Diff || '').toLowerCase()] || {
        label: String(play.Diff || '?')
            .slice(0, 4)
            .toUpperCase(),
        color: TOKENS.inkMuted,
    };
    const cover = coverUrl(covers.get(play.Song));
    const chartType = String(play.Chart || '').toUpperCase();
    return `
    <div class="tile">
      <div class="cover">${cover ? `<img src="${escapeHtml(cover)}" onerror="this.style.display='none'">` : ''}<span class="idx">${index + 1}</span></div>
      <div class="info">
        <div class="title">${escapeHtml(play.Song)}</div>
        <div class="row1"><span class="pill" style="background:${diff.color}">${diff.label} ${escapeHtml(play.Level)}</span>${chartType ? `<span class="tag">${escapeHtml(chartType)}</span>` : ''}</div>
        <div class="row2 tabular"><span class="achv">${escapeHtml(play.Achv)}</span><span class="rank">${escapeHtml(play.Rank)}</span><span class="rt">${escapeHtml(play.Rating)}</span></div>
      </div>
    </div>`;
}

function section(name, plays, covers) {
    return `
  <div class="section">
    <div class="section-head"><span class="name">${escapeHtml(name)}</span><span class="sum tabular">${plays.length} charts · ${formatInt(sumRatings(plays))}</span></div>
    <div class="grid">${plays.map((p, i) => tile(p, i, covers)).join('')}</div>
  </div>`;
}

/**
 * @param {object} model
 * @param {string} model.playerName
 * @param {number|null} model.rating        the breakdown's own total at snapshot time
 * @param {number|null} model.segaRating    what SEGA displayed on that run, if it differs
 * @param {string|null} model.snapshotDate
 * @param {number|null} model.ageDays
 * @param {boolean} model.stale
 * @param {Array} model.newPlays            entries: {Song, Chart, Level, Achv, Rank, Rating, Diff}
 * @param {Array} model.oldPlays
 * @param {Map<string,string>} model.covers song title -> cover image name
 */
function buildB50Html(model) {
    const { playerName, rating, segaRating, snapshotDate, ageDays, stale, newPlays, oldPlays } =
        model;
    const covers = model.covers || new Map();
    const total = rating ?? sumRatings(newPlays) + sumRatings(oldPlays);
    const showSega =
        Number.isFinite(segaRating) && Number.isFinite(rating) && segaRating !== rating;

    const age =
        ageDays === null
            ? 'age unknown'
            : ageDays === 0
              ? 'today'
              : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
    const banner = stale
        ? `<div class="banner"><span class="icon">⚠</span><span>Out of date — this snapshot is from ${escapeHtml(snapshotDate || 'an unknown date')} (${escapeHtml(age)}).</span></div>`
        : '';

    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="card">
  <div class="header">
    <div>
      <div class="label">Rating</div>
      <div class="hero">${formatInt(total)}</div>
      <div class="player">${escapeHtml(playerName)}</div>
    </div>
    <div>
      <div class="stats">
        <div class="stat"><div class="label">Best 15 · new</div><div class="value tabular">${formatInt(sumRatings(newPlays))}</div></div>
        <div class="stat"><div class="label">Best 35 · old</div><div class="value tabular">${formatInt(sumRatings(oldPlays))}</div></div>
      </div>
      <div class="meta">Snapshot ${escapeHtml(snapshotDate || '–')} · ${escapeHtml(age)}${showSega ? ` · SEGA showed ${formatInt(segaRating)}` : ''}</div>
      <div style="text-align:right">${banner}</div>
    </div>
  </div>
  ${section('Best 15 — new version', newPlays, covers)}
  ${section('Best 35 — old version', oldPlays, covers)}
  <div class="footer">Generated by Atri · constants and covers from arcade-songs</div>
</div>
</body></html>`;
}

module.exports = { buildB50Html, WIDTH, sumRatings, DIFFICULTIES };
