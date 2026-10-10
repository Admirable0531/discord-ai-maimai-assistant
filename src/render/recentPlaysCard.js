// Recent plays: grouped by day, with a run of the same chart collapsed into one
// session row — the number of attempts, a sparkline of how the score moved, and
// the best of them. 16 attempts at one song is one row, not sixteen lines of
// text. Pure: data in, HTML out.
const {
    TOKENS,
    BASE_CSS,
    footerHtml,
    escapeHtml,
    displayName,
    formatInt,
    coverUrl,
} = require('./theme');
const { PARTS_CSS, difficultyPill, badgePills, sparkline } = require('./parts');

const WIDTH = 1100;

const CSS = `
${BASE_CSS}
${PARTS_CSS}
.card { width: ${WIDTH}px; padding: 32px; }
.label { color: ${TOKENS.inkMuted}; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.hero { font-size: 64px; font-weight: 700; line-height: 1; margin-top: 6px; }
.who { color: ${TOKENS.inkSecondary}; font-size: 20px; margin-top: 10px; }
.sub { color: ${TOKENS.inkSecondary}; font-size: 15px; margin-top: 6px; }
.day { margin-top: 28px; }
.day-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
.day-head .date { font-size: 18px; font-weight: 600; }
.day-head .count { color: ${TOKENS.inkSecondary}; font-size: 14px; }
.rows { display: flex; flex-direction: column; gap: 6px; }
.row { display: flex; align-items: center; gap: 14px; height: 64px; padding: 8px 16px 8px 8px; background: ${TOKENS.raised}; border-radius: 8px; }
.cover { flex: 0 0 48px; width: 48px; height: 48px; border-radius: 6px; background: ${TOKENS.axis}; overflow: hidden; }
.cover img { display: block; width: 48px; height: 48px; object-fit: cover; }
.song { flex: 1; min-width: 0; }
.song .title { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.song .meta { margin-top: 4px; display: flex; align-items: center; gap: 6px; }
.time { color: ${TOKENS.inkMuted}; font-size: 12px; }
.attempts { flex: 0 0 200px; display: flex; align-items: center; gap: 10px; color: ${TOKENS.inkSecondary}; font-size: 13px; }
.attempts .n { font-size: 15px; font-weight: 700; color: ${TOKENS.ink}; min-width: 38px; }
.best { flex: 0 0 120px; text-align: right; }
.best .achv { font-size: 20px; font-weight: 700; }
.best .new { color: ${TOKENS.inkSecondary}; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; }
.rank { flex: 0 0 52px; color: ${TOKENS.inkSecondary}; font-size: 15px; font-weight: 600; }
.badges { flex: 0 0 128px; text-align: right; white-space: nowrap; }
`;

const timeOf = (stamp) => (stamp || '').split(' ')[1] || '';

function sessionRow(s, covers) {
    const best = s.best;
    const cover = coverUrl(covers.get(s.title));
    const span = s.count > 1 ? `${timeOf(s.first_at)}–${timeOf(s.last_at)}` : timeOf(s.last_at);
    const attempts =
        s.count > 1
            ? `<span class="n tabular">×${s.count}</span>${sparkline(s.attempts)}`
            : best.dx_score
              ? `<span class="tabular">DX ${formatInt(best.dx_score.got)} / ${formatInt(best.dx_score.max)}${best.dx_stars ? ` · ★${best.dx_stars}` : ''}</span>`
              : '';
    return `<div class="row">
  <div class="cover">${cover ? `<img src="${escapeHtml(cover)}" onerror="this.style.display='none'">` : ''}</div>
  <div class="song"><div class="title">${escapeHtml(s.title)}</div><div class="meta">${difficultyPill(s.difficulty, s.level)}<span class="tag">${s.chart_type === 'dx' ? 'DX' : s.chart_type === 'std' ? 'STD' : ''}</span><span class="time tabular">${escapeHtml(span)}</span></div></div>
  <div class="attempts">${attempts}</div>
  <div class="best"><div class="achv tabular">${best.achievement.toFixed(4)}%</div>${s.new_best ? '<div class="new">★ NEW BEST</div>' : ''}</div>
  <div class="rank">${escapeHtml(best.rank || '')}</div>
  <div class="badges">${badgePills(best.clear, best.sync)}</div>
</div>`;
}

/**
 * @param {object} model
 * @param {string} model.playerName
 * @param {number} model.totalPlays
 * @param {number} model.totalSessions
 * @param {number} model.totalSongs
 * @param {Array<{date, plays, songs, sessions}>} model.days    newest first
 * @param {Map<string,string>} model.covers   title -> cover image name
 */
function buildRecentPlaysHtml({
    playerName,
    totalPlays,
    totalSessions,
    totalSongs,
    days,
    covers = new Map(),
}) {
    const first = days[days.length - 1]?.date;
    const last = days[0]?.date;
    const dayHtml = days
        .map(
            (d) =>
                `<div class="day"><div class="day-head"><span class="date tabular">${escapeHtml(d.date.replace(/\//g, '-'))}</span><span class="count">${d.plays} play${d.plays === 1 ? '' : 's'} · ${d.songs} song${d.songs === 1 ? '' : 's'}</span></div><div class="rows">${d.sessions.map((s) => sessionRow(s, covers)).join('')}</div></div>`
        )
        .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="card">
  <div class="label">Recent plays</div>
  <div class="hero tabular">${totalPlays} plays</div>
  <div class="who">${escapeHtml(displayName(playerName))}</div>
  <div class="sub">${totalSongs} song${totalSongs === 1 ? '' : 's'} · ${totalSessions} session${totalSessions === 1 ? '' : 's'} · ${escapeHtml((first || '').replace(/\//g, '-'))}${first !== last ? ` to ${escapeHtml((last || '').replace(/\//g, '-'))}` : ''}</div>
  ${dayHtml}
  ${footerHtml('The game keeps the last 50 plays · a run of the same chart is one session; the line shows how the score moved')}
</div>
</body></html>`;
}

module.exports = { buildRecentPlaysHtml, WIDTH };
