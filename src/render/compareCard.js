// The comparison card: two players' best 50s side by side. A header with both ratings and the gap, a stats table, the
// charts they share with a diverging bar for who is ahead and by how much (in achievement and in rating points), and the
// charts only one of them has with the score the other would need to get them into their own best 50.
// Pure: data in, HTML out (see browserRenderer.js for the PNG).
const {
    TOKENS,
    BASE_CSS,
    footerHtml,
    escapeHtml,
    displayName,
    formatInt,
    coverUrl,
} = require('./theme');
const { difficultyPill, PARTS_CSS } = require('./parts');

// Wide enough for the three-part chart rows (title, diverging bar, rating gap); Discord shrinks it to the chat width.
const WIDTH = 680;
const SHARED_ROWS = 8;
const ONLY_ROWS = 4;
const BAR_HALF = 100; // px of bar on each side of the centre line
const BAR_FULL_GAP = 1; // an achievement gap of this many percentage points fills the bar

const A_COLOR = TOKENS.series1;
const B_COLOR = TOKENS.series2;

const CSS = `
${BASE_CSS}
${PARTS_CSS}
.card { width: ${WIDTH}px; padding: 30px 28px 24px; }
.label { color: ${TOKENS.inkMuted}; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.duel { display: grid; grid-template-columns: 1fr auto 1fr; gap: 20px; align-items: end; margin-top: 10px; }
.side.b { text-align: right; }
.who { display: flex; align-items: center; gap: 8px; font-size: 21px; font-weight: 600; min-width: 0; }
.side.b .who { justify-content: flex-end; }
.who span.n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { flex: none; width: 12px; height: 12px; border-radius: 50%; }
.hero { font-size: 54px; font-weight: 700; line-height: 1.05; margin-top: 6px; }
.mid { text-align: center; padding-bottom: 6px; }
.mid .gap { font-size: 26px; font-weight: 700; }
.mid .gapnote { color: ${TOKENS.inkSecondary}; font-size: 13px; margin-top: 2px; }
.banner { display: flex; align-items: flex-start; gap: 8px; margin-top: 14px; padding: 9px 12px; border: 1px solid ${TOKENS.warning}; border-radius: 6px; font-size: 14px; line-height: 1.35; }
.banner .icon { color: ${TOKENS.warning}; font-weight: 700; }
.section { margin-top: 26px; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.section-head .name { font-size: 19px; font-weight: 600; }
.section-head .sum { color: ${TOKENS.inkSecondary}; font-size: 14px; text-align: right; }
.stats { background: ${TOKENS.raised}; border-radius: 8px; padding: 4px 14px; }
.stat { display: grid; grid-template-columns: 1fr 170px 1fr; align-items: center; height: 40px; border-bottom: 1px solid ${TOKENS.grid}; font-size: 19px; }
.stat:last-child { border-bottom: 0; }
.stat .k { text-align: center; color: ${TOKENS.inkMuted}; font-size: 14px; letter-spacing: 0.04em; }
.stat .v.b { text-align: right; }
.stat .v.lead { font-weight: 700; }
.stat .v.dim { color: ${TOKENS.inkSecondary}; }
.rows { display: flex; flex-direction: column; gap: 8px; }
.crow { display: grid; grid-template-columns: 52px 1fr ${BAR_HALF * 2 + 8}px 52px; gap: 10px; align-items: center; background: ${TOKENS.raised}; border-radius: 8px; padding: 6px 10px 6px 6px; min-height: 64px; }
.cover { width: 52px; height: 52px; border-radius: 6px; background: ${TOKENS.axis}; overflow: hidden; }
.cover img { display: block; width: 52px; height: 52px; object-fit: cover; }
.info { min-width: 0; }
.title { font-size: 17px; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.vals { display: flex; justify-content: space-between; font-size: 14px; color: ${TOKENS.inkSecondary}; margin-bottom: 4px; white-space: nowrap; }
.vals .lead { color: ${TOKENS.ink}; font-weight: 700; }
.bar { position: relative; height: 12px; }
.bar .axis { position: absolute; left: 50%; top: -2px; width: 1px; height: 16px; background: ${TOKENS.axis}; }
.bar .fill { position: absolute; top: 2px; height: 8px; border-radius: 4px; }
.delta { text-align: right; font-size: 18px; font-weight: 700; }
.delta small { display: block; color: ${TOKENS.inkMuted}; font-size: 11px; font-weight: 600; }
.orow { display: grid; grid-template-columns: 52px 1fr; gap: 10px; align-items: center; background: ${TOKENS.raised}; border-radius: 8px; padding: 6px 10px 6px 6px; min-height: 64px; }
.own { font-size: 15px; color: ${TOKENS.inkSecondary}; margin-top: 3px; }
.chase { font-size: 14.5px; line-height: 1.35; margin-top: 3px; }
.chase b { font-weight: 700; }
.empty { color: ${TOKENS.inkMuted}; font-size: 15px; padding: 6px 0; }
.legend { display: flex; gap: 16px; align-items: center; color: ${TOKENS.inkMuted}; font-size: 12px; margin-top: 8px; }
`;

const fmtPct = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}%` : '–');
const signed = (n, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

function coverHtml(song, covers) {
    const url = coverUrl(covers.get(song));
    return `<div class="cover">${url ? `<img src="${escapeHtml(url)}" onerror="this.style.display='none'">` : ''}</div>`;
}

/** One stat line: A's value, the label, B's value; the higher side is bold, the lower dimmed. */
function statRow(label, a, b, format) {
    const fa = a == null ? '–' : format(a);
    const fb = b == null ? '–' : format(b);
    const lead = a != null && b != null && a !== b ? (a > b ? 'a' : 'b') : null;
    const cls = (side) => (lead === side ? ' lead' : lead ? ' dim' : '');
    return `<div class="stat tabular"><span class="v a${cls('a')}">${escapeHtml(fa)}</span><span class="k">${escapeHtml(label)}</span><span class="v b${cls('b')}">${escapeHtml(fb)}</span></div>`;
}

function sharedRow(s, covers) {
    const lead = s.gap > 0 ? 'a' : s.gap < 0 ? 'b' : null;
    const width = Math.min(1, Math.abs(s.gap) / BAR_FULL_GAP) * BAR_HALF;
    const fill =
        lead === 'a'
            ? `right:50%;width:${width.toFixed(1)}px;background:${A_COLOR}`
            : lead === 'b'
              ? `left:50%;width:${width.toFixed(1)}px;background:${B_COLOR}`
              : 'display:none';
    const color = lead === 'a' ? A_COLOR : lead === 'b' ? B_COLOR : TOKENS.inkMuted;
    const val = (side, text) =>
        `<span class="${lead === side ? 'lead' : ''}">${escapeHtml(text)}</span>`;
    return `
    <div class="crow">
      ${coverHtml(s.song, covers)}
      <div class="info">
        <div class="title">${escapeHtml(s.song)}</div>
        <div class="meta">${difficultyPill(s.difficulty, s.level.toFixed(1))}<span class="tag">${escapeHtml(s.chartType.toUpperCase())}</span></div>
      </div>
      <div>
        <div class="vals tabular">${val('a', `${fmtPct(s.a.achievement)} ${s.a.rank}`)}${val('b', `${s.b.rank} ${fmtPct(s.b.achievement)}`)}</div>
        <div class="bar"><span class="axis"></span><span class="fill" style="${fill}"></span></div>
      </div>
      <div class="delta tabular" style="color:${color}">${s.ratingGap === 0 ? '0' : signed(Math.abs(s.ratingGap))}<small>${s.ratingGap === 0 ? 'rating' : 'rating'}</small></div>
    </div>`;
}

/** What the other player would have to do to get this chart into their own best 50. */
function chaseText(c, otherName, theirScore) {
    const who = `<b>${escapeHtml(otherName)}</b>`;
    if (c.unreachable) return `${who}: out of reach, it needs more than 100.5%`;
    if (c.needed === null)
        return `${who}: has room, any score adds up to <b>+${formatInt(c.gain)}</b>`;
    const need = `needs <b>${c.needed.toFixed(2)}%</b> ${escapeHtml(c.neededRank || '')} to get in (their weakest there is ${formatInt(c.cutoff)})`;
    return c.gain > 0
        ? `${who}: ${need}; ${escapeHtml(theirScore)} would add <b>+${formatInt(c.gain)}</b>`
        : `${who}: ${need}`;
}

function onlyRow(p, ownerName, otherName, color, covers) {
    return `
    <div class="orow">
      ${coverHtml(p.song, covers)}
      <div class="info">
        <div class="title">${escapeHtml(p.song)}</div>
        <div class="meta">${difficultyPill(p.difficulty, p.level.toFixed(1))}<span class="tag">${escapeHtml(p.chartType.toUpperCase())}</span></div>
        <div class="own tabular" style="color:${color}">${escapeHtml(ownerName)}: ${escapeHtml(fmtPct(p.achievement))} ${escapeHtml(p.rank)} · ${formatInt(p.rating)}</div>
        <div class="chase">${chaseText(p.chase, otherName, fmtPct(p.achievement))}</div>
      </div>
    </div>`;
}

function onlySection(list, ownerName, otherName, color, covers) {
    const rows = list.slice(0, ONLY_ROWS);
    const body = rows.length
        ? `<div class="rows">${rows.map((p) => onlyRow(p, ownerName, otherName, color, covers)).join('')}</div>`
        : `<div class="empty">Every chart in ${escapeHtml(ownerName)}'s best 50 is in ${escapeHtml(otherName)}'s too.</div>`;
    return `
  <div class="section">
    <div class="section-head"><span class="name">Only in ${escapeHtml(ownerName)}'s best 50</span><span class="sum">${list.length} chart${list.length === 1 ? '' : 's'}${list.length > rows.length ? ` · the ${rows.length} that would add most for ${escapeHtml(otherName)}` : ''}</span></div>
    ${body}
  </div>`;
}

/**
 * @param {object} model
 * @param {string} model.nameA                 the first player (left, blue)
 * @param {string} model.nameB                 the second player (right, orange)
 * @param {object} model.data                  compareSnapshots(a, b)
 * @param {Map<string,string>} model.covers    song title -> cover image name
 * @param {string[]} model.staleNotes          e.g. ["Minjin (9d old)"], empty when both are fresh
 * @param {string} [model.snapshotNote]
 */
function buildCompareHtml(model) {
    const { data, covers = new Map(), staleNotes = [] } = model;
    const nameA = displayName(model.nameA);
    const nameB = displayName(model.nameB);
    const { sa, sb } = data;
    const diff = (sa.rating ?? 0) - (sb.rating ?? 0);
    const leader = diff === 0 ? null : diff > 0 ? nameA : nameB;
    const leadColor = diff > 0 ? A_COLOR : diff < 0 ? B_COLOR : TOKENS.inkSecondary;

    const stats = [
        statRow('Best 15 · new', sa.b15, sb.b15, formatInt),
        statRow('Best 35 · old', sa.b35, sb.b35, formatInt),
        statRow('Average constant', sa.avgLevel, sb.avgLevel, (v) => v.toFixed(2)),
        statRow('Hardest chart', sa.hardest, sb.hardest, (v) => v.toFixed(1)),
        statRow('Charts ≥ 14.0', sa.level14, sb.level14, String),
        statRow('Average achievement', sa.avgAchv, sb.avgAchv, fmtPct),
        statRow('SSS or better', sa.sssUp, sb.sssUp, String),
        statRow('SSS+', sa.sssPlus, sb.sssPlus, String),
    ].join('');

    const shared = data.shared;
    const sharedBody = shared.length
        ? `<div class="rows">${shared
              .slice(0, SHARED_ROWS)
              .map((s) => sharedRow(s, covers))
              .join('')}</div>
    <div class="legend"><span><span class="dot" style="display:inline-block;background:${A_COLOR}"></span> ${escapeHtml(nameA)} ahead</span><span><span class="dot" style="display:inline-block;background:${B_COLOR}"></span> ${escapeHtml(nameB)} ahead</span><span>bar: achievement gap, full width = ${BAR_FULL_GAP}%</span></div>`
        : '<div class="empty">No chart is in both best 50s.</div>';
    const net = data.netRating;
    const sharedSum = shared.length
        ? `${data.aAhead} to ${escapeHtml(nameA)} · ${data.bAhead} to ${escapeHtml(nameB)}${net !== 0 ? ` · ${escapeHtml(net > 0 ? nameA : nameB)} +${formatInt(Math.abs(net))} rating on these` : ''}`
        : '';

    const banner = staleNotes.length
        ? `<div class="banner"><span class="icon">⚠</span><span>Out of date: ${escapeHtml(staleNotes.join(', '))}.</span></div>`
        : '';

    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="card">
  <div class="label">Best 50 comparison</div>
  <div class="duel">
    <div class="side a">
      <div class="who"><span class="dot" style="background:${A_COLOR}"></span><span class="n">${escapeHtml(nameA)}</span></div>
      <div class="hero tabular">${formatInt(sa.rating)}</div>
    </div>
    <div class="mid">
      <div class="gap tabular" style="color:${leadColor}">${diff === 0 ? 'Level' : `${signed(Math.abs(diff))}`}</div>
      <div class="gapnote">${leader ? `${escapeHtml(leader)} ahead` : 'same rating'}</div>
    </div>
    <div class="side b">
      <div class="who"><span class="n">${escapeHtml(nameB)}</span><span class="dot" style="background:${B_COLOR}"></span></div>
      <div class="hero tabular">${formatInt(sb.rating)}</div>
    </div>
  </div>
  ${banner}
  <div class="section">
    <div class="section-head"><span class="name">Side by side</span></div>
    <div class="stats">${stats}</div>
  </div>
  <div class="section">
    <div class="section-head"><span class="name">${shared.length} shared chart${shared.length === 1 ? '' : 's'}</span><span class="sum">${sharedSum}</span></div>
    ${sharedBody}
  </div>
  ${onlySection(data.onlyA, nameA, nameB, A_COLOR, covers)}
  ${onlySection(data.onlyB, nameB, nameA, B_COLOR, covers)}
  ${footerHtml(escapeHtml(model.snapshotNote || 'From the latest daily snapshot. Constants and covers from arcade-songs.'))}
</div>
</body></html>`;
}

module.exports = { buildCompareHtml, WIDTH };
