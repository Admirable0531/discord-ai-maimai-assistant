// Play history for one song: a block per difficulty that has been played, with
// its play count, best achievement, rank, clear and sync badges, when it was
// last played — and the individual scores of recent plays where the game still
// has them. Pure.
//
// What the game's song page stores per difficulty is a play COUNT and the BEST
// score, nothing per play. So "2 plays" can only ever come with one score from
// that page; the scores of single plays exist only in the game's log of the
// last 50 plays, which is where `recent` comes from. A play older than that has
// a count but no score anywhere, and the card says so rather than letting a
// count with one score look like a bug.
//
// Sized for a phone (see leaderboardCard.js): 640px wide, unplayed difficulties
// folded into one line instead of taking a row each.
const { TOKENS, BASE_CSS, escapeHtml, footerHtml, formatInt, coverUrl } = require('./theme');
const { PARTS_CSS, difficultyPill, badgePills } = require('./parts');

const WIDTH = 640;
const MAX_RECENT_SHOWN = 6;

const CSS = `
${BASE_CSS}
${PARTS_CSS}
.card { width: ${WIDTH}px; padding: 24px 22px 22px; }
.top { display: flex; gap: 16px; align-items: center; }
.cover { flex: 0 0 96px; width: 96px; height: 96px; border-radius: 10px; background: ${TOKENS.axis}; overflow: hidden; }
.cover img { display: block; width: 96px; height: 96px; object-fit: cover; }
.label { color: ${TOKENS.inkMuted}; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.title { font-size: 28px; font-weight: 700; line-height: 1.15; margin-top: 4px; overflow-wrap: anywhere; }
.sub { color: ${TOKENS.inkSecondary}; font-size: 16px; margin-top: 6px; line-height: 1.35; }
.rows { margin-top: 20px; display: flex; flex-direction: column; gap: 10px; }
.block { padding: 14px 16px; background: ${TOKENS.raised}; border-radius: 10px; }
.line1 { display: flex; align-items: center; gap: 10px; }
.line1 .pill { font-size: 14px; padding: 2px 9px; }
.ctype { color: ${TOKENS.inkSecondary}; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.achv { font-size: 26px; font-weight: 700; margin-left: auto; }
.rank { color: ${TOKENS.inkSecondary}; font-size: 17px; font-weight: 600; min-width: 36px; }
.line2 { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; font-size: 15px; color: ${TOKENS.inkSecondary}; }
.line2 .bpill { font-size: 13px; }
.stars { font-size: 14px; }
.count { font-weight: 700; color: ${TOKENS.ink}; }
.when { margin-left: auto; color: ${TOKENS.inkMuted}; font-size: 14px; }
.recent { margin-top: 10px; padding-top: 10px; border-top: 1px solid ${TOKENS.axis}; font-size: 14px; color: ${TOKENS.inkSecondary}; line-height: 1.5; }
.recent .h { color: ${TOKENS.inkMuted}; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 2px; }
.recent .p { display: flex; justify-content: space-between; gap: 12px; }
.recent .best { color: ${TOKENS.ink}; font-weight: 700; }
.unplayed { margin-top: 14px; color: ${TOKENS.inkMuted}; font-size: 14px; }
`;

function recentBlock(recent, plays) {
    if (!recent || recent.length === 0) return '';
    const shown = recent.slice(0, MAX_RECENT_SHOWN);
    const top = Math.max(...recent.map((p) => p.achievement));
    const lines = shown
        .map(
            (p) =>
                `<div class="p tabular"><span>${escapeHtml(p.playedAt || '')}</span><span class="${p.achievement === top ? 'best' : ''}">${p.achievement.toFixed(4)}%${p.newRecord ? ' ★ new best' : ''}</span></div>`
        )
        .join('');
    const more =
        recent.length > shown.length
            ? `<div class="p"><span>+ ${recent.length - shown.length} older in the log</span><span></span></div>`
            : '';
    // The count includes plays the game no longer has a score for.
    const missing =
        plays > recent.length
            ? `<div class="p"><span>${plays - recent.length} older play${plays - recent.length === 1 ? '' : 's'} — the game keeps no score for ${plays - recent.length === 1 ? 'it' : 'them'}</span><span></span></div>`
            : '';
    return `<div class="recent"><div class="h">Recent plays</div>${lines}${more}${missing}</div>`;
}

/**
 * @param {object} model
 * @param {string} model.title
 * @param {string|null} model.artist
 * @param {string|null} model.cover
 * @param {Array<{chartType?, difficulty, level, plays, best, rank, clear, sync, stars, lastPlayed, recent?}>} model.rows
 *        easiest first; `recent` is [{achievement, playedAt, newRecord}] newest first, when known
 */
function buildPlayHistoryHtml({ title, artist, cover, rows }) {
    const total = rows.reduce((n, r) => n + (r.plays || 0), 0);
    const played = rows.filter((r) => r.plays > 0 || r.best != null);
    const unplayed = rows.filter((r) => !(r.plays > 0 || r.best != null));
    const img = coverUrl(cover, true);

    const body = played
        .map(
            (r) => `<div class="block">
  <div class="line1">${difficultyPill(r.difficulty, r.level)}${r.chartType ? `<span class="ctype">${r.chartType === 'std' ? 'STD' : 'DX'}</span>` : ''}<span class="rank">${escapeHtml(r.rank || '')}</span><span class="achv tabular">${r.best == null ? '–' : `${r.best.toFixed(4)}%`}</span></div>
  <div class="line2"><span class="count tabular">${formatInt(r.plays || 0)} play${r.plays === 1 ? '' : 's'}</span>${badgePills(r.clear, r.sync)}${r.stars ? `<span class="stars tabular">★${r.stars}</span>` : ''}<span class="when tabular">${escapeHtml(r.lastPlayed ? `last ${r.lastPlayed}` : '')}</span></div>
  ${recentBlock(r.recent, r.plays || 0)}
</div>`
        )
        .join('');
    const unplayedLine =
        unplayed.length > 0
            ? `<div class="unplayed">Not played: ${unplayed.map((r) => `${r.chartType ? `${r.chartType === 'std' ? 'STD' : 'DX'} ` : ''}${escapeHtml(String(r.difficulty).slice(0, 3).toUpperCase())}${r.level ? ` ${escapeHtml(r.level)}` : ''}`).join(' · ')}</div>`
            : '';
    const anyScoreMissing = played.some((r) => (r.plays || 0) > (r.recent?.length || 0));

    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="card">
  <div class="top">
    <div class="cover">${img ? `<img src="${escapeHtml(img)}" onerror="this.style.display='none'">` : ''}</div>
    <div>
      <div class="label">Your play history</div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub">${artist ? `${escapeHtml(artist)}<br>` : ''}${formatInt(total)} play${total === 1 ? '' : 's'} · ${played.length} of ${rows.length} difficult${rows.length === 1 ? 'y' : 'ies'} played</div>
    </div>
  </div>
  <div class="rows">${body}</div>
  ${unplayedLine}
  ${footerHtml(anyScoreMissing ? 'The game stores a play count and the best score per difficulty; single scores exist only for its last 50 plays.' : '')}
</div>
</body></html>`;
}

module.exports = { buildPlayHistoryHtml, WIDTH };
