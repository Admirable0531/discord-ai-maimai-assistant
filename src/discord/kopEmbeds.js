// The KOP8th board as Discord embeds, in the style of the daily circle
// rankings (maimaiscrape's circle_ranking_scraper / daily_points_tracker):
// a framed header, `01.` lines with the change since the last update, and an
// improvers report. Pure: data in, embed objects out.
const { escapeMarkdown } = require('discord.js');
const { displayName } = require('../render/theme');
const { normalizeName } = require('../web/maimaiFriendLookup');

const COLORS = { jp: 0xe60033, intl: 0x3987e5, report: 0x2ecc71 };
const LINES_PER_EMBED = 50;
const TOP_IMPROVERS = 15;
const DIVIDER = '═'.repeat(32);
// Discord's limits: 4,096 characters of description per embed, 6,000 for all
// embeds in one message, and 10 embeds per message.
const MESSAGE_CHARS = 6000;
const MESSAGE_EMBEDS = 10;

/** 3029910 -> "302.9910%" (the score is the summed achievement, in ten-thousandths of a percent). */
function percent(score) {
    return Number.isFinite(score) ? `${(score / 10000).toFixed(4)}%` : '–';
}

/** A score change as "+0.0123%". */
function percentDelta(delta) {
    return `${delta >= 0 ? '+' : '−'}${(Math.abs(delta) / 10000).toFixed(4)}%`;
}

function nameOf(e) {
    return escapeMarkdown(displayName(e.name));
}

function moveIcon(move) {
    if (move === null || move === undefined) return '';
    if (move === 'new') return ' 🆕';
    if (move === 0) return ' ➖';
    return move > 0 ? ` ⬆️${move}` : ` ⬇️${-move}`;
}

/**
 * Each entry with its previous update's score (`before`, or null when the
 * player wasn't in the previous top 100) — `move` is already on the entries.
 */
function withPreviousScore(entries, previous) {
    const before = new Map((previous || []).map((e) => [normalizeName(e.name), e.score]));
    return entries.map((e) => ({ ...e, before: before.get(normalizeName(e.name)) ?? null }));
}

function rankingLine(e, isOurs) {
    const rank = String(e.rank).padStart(2, '0');
    const delta =
        e.before !== null && e.before !== undefined && e.score !== e.before
            ? ` (${percentDelta(e.score - e.before)})`
            : '';
    const name = isOurs ? `⭐ **${nameOf(e)}**` : `**${nameOf(e)}**`;
    return `\`${rank}.\` ${name} — ${percent(e.score)}${delta}${moveIcon(e.move)}`;
}

function embedLength(embed) {
    return (
        (embed.title || '').length +
        (embed.description || '').length +
        (embed.footer?.text || '').length
    );
}

/** Groups embeds into as few messages as Discord's per-message limits allow, in order. */
function packMessages(embeds) {
    const messages = [];
    let current = [];
    let size = 0;
    for (const embed of embeds) {
        const len = embedLength(embed);
        if (current.length && (current.length === MESSAGE_EMBEDS || size + len > MESSAGE_CHARS)) {
            messages.push(current);
            current = [];
            size = 0;
        }
        current.push(embed);
        size += len;
    }
    if (current.length) messages.push(current);
    return messages;
}

/**
 * The embeds for one region's update: the top 100 (50 lines each), then the
 * improvers report when there is a previous update to compare with.
 * @param {object} model
 * @param {{key:string,label:string,pageUrl:string}} model.region
 * @param {string} model.updated   "2026/10/30 07:00 JST"
 * @param {Array} model.entries    best first, with `move` (see withMovement)
 * @param {Array|null} model.previous  the previous update's entries
 * @param {Set<number>} [model.ours]   ranks of players on the friend list
 */
function kopEmbeds({ region, updated, entries, previous, ours = new Set() }) {
    const rows = withPreviousScore(entries, previous);
    const compared = Array.isArray(previous) && previous.length > 0;
    const color = COLORS[region.key] ?? COLORS.intl;
    const friends = rows.filter((e) => ours.has(e.rank));
    const last = rows[rows.length - 1];

    const header = [
        DIVIDER,
        `🏆 **KOP8th maimai — ${region.label.toUpperCase()}** 🏆`,
        `📊 **Score attack top ${rows.length}** · updated ${updated}`,
        DIVIDER,
        '',
        `👑 **#1** ${nameOf(rows[0])} — ${percent(rows[0].score)}`,
        last ? `🎯 **#${last.rank} cut-off** — ${percent(last.score)}` : '',
        friends.length
            ? `⭐ **Friends:** ${friends.map((e) => `${nameOf(e)} #${e.rank}`).join(', ')}`
            : '',
        `🔗 [Official ranking](${region.pageUrl})`,
        '',
    ]
        .filter((line, i, all) => line !== '' || (all[i - 1] ?? '') !== '')
        .join('\n');

    const footer = {
        text: `${rows.length} players · ${compared ? '⬆️⬇️ and (+%) vs the previous update' : 'first update — changes appear from the next one'}`,
    };
    const lines = rows.map((e) => rankingLine(e, ours.has(e.rank)));
    const embeds = [];
    for (let i = 0; i < lines.length; i += LINES_PER_EMBED) {
        const chunk = lines.slice(i, i + LINES_PER_EMBED).join('\n');
        embeds.push({
            title:
                i === 0
                    ? `KOP8th maimai — ${region.label} · Top ${rows.length}`
                    : `KOP8th maimai — ${region.label} (ranks ${i + 1}–${Math.min(i + LINES_PER_EMBED, rows.length)})`,
            description: i === 0 ? `${header}\n${chunk}` : chunk,
            color,
            ...(i + LINES_PER_EMBED >= lines.length ? { footer } : {}),
        });
    }

    if (compared) embeds.push(improversEmbed({ region, updated, rows, previous, ours }));
    return embeds;
}

/** Who gained the most score since the previous update, who is new, and who dropped out. */
function improversEmbed({ region, updated, rows, previous, ours }) {
    const improved = rows
        .filter((e) => e.before !== null && e.score > e.before)
        .sort((a, b) => b.score - b.before - (a.score - a.before));
    const newcomers = rows.filter((e) => e.before === null);
    const now = new Set(rows.map((e) => normalizeName(e.name)));
    const dropped = previous.filter((e) => !now.has(normalizeName(e.name)));
    const totalGain = improved.reduce((sum, e) => sum + (e.score - e.before), 0);

    const lines = [
        DIVIDER,
        `📈 **KOP8th ${region.label.toUpperCase()} — IMPROVERS** 📈`,
        DIVIDER,
        '',
        `**📅 Update:** ${updated}`,
        `**🏆 Improved:** ${improved.length} players${improved.length ? ` · total ${percentDelta(totalGain)}` : ''}`,
        `**🆕 New in the top ${rows.length}:** ${newcomers.length}`,
        `**👻 Dropped out:** ${dropped.length}`,
        '',
    ];
    if (improved.length) {
        lines.push('**🏆 BIGGEST IMPROVERS**');
        improved.slice(0, TOP_IMPROVERS).forEach((e, i) => {
            const name = ours.has(e.rank) ? `⭐ **${nameOf(e)}**` : `**${nameOf(e)}**`;
            lines.push(
                `\`${String(i + 1).padStart(2, '0')}.\` ${name} — ${percentDelta(e.score - e.before)} → ${percent(e.score)} (#${e.rank}${moveIcon(e.move)})`
            );
        });
        lines.push('');
    }
    if (newcomers.length) {
        lines.push('**🆕 NEW IN THE TOP 100**');
        lines.push(
            newcomers
                .slice(0, 15)
                .map((e) => `${nameOf(e)} #${e.rank}`)
                .join(' · ') + (newcomers.length > 15 ? ` · +${newcomers.length - 15} more` : '')
        );
        lines.push('');
    }
    if (dropped.length) {
        lines.push('**👻 DROPPED OUT**');
        lines.push(
            dropped
                .slice(0, 15)
                .map((e) => `${nameOf(e)} (was #${e.rank})`)
                .join(' · ') + (dropped.length > 15 ? ` · +${dropped.length - 15} more` : '')
        );
    }
    return {
        title: `📈 KOP8th ${region.label} — improvers since the previous update`,
        description: lines.join('\n').slice(0, 4096),
        color: COLORS.report,
    };
}

module.exports = { kopEmbeds, packMessages, percent, percentDelta, rankingLine, withPreviousScore };
