const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { loadSnapshot, chartKey, freshnessNote, sum } = require('../../../web/maimaiPlayerSnapshot');
const { compareSnapshots } = require('../../../web/maimaiCompare');
const { loadCoverMap } = require('../../../web/maimaiCovers');
const { buildCompareHtml, WIDTH } = require('../../../render/compareCard');
const { renderHtmlToPng } = require('../../../render/browserRenderer');
const { formatInt, displayName, TOKENS, COVER_HOST } = require('../../../render/theme');
const { denyWithoutScope, describeFailure, suggestPlayers } = require('../../commandHelpers');
const logger = require('../../../utils/logger');

const BIGGEST_GAPS = 4;

function summarise(snapshot) {
    const all = [...snapshot.newPlays, ...snapshot.oldPlays];
    const levels = all.map((p) => p.level).filter(Number.isFinite);
    return {
        rating: snapshot.rating,
        b15: sum(snapshot.newPlays),
        b35: sum(snapshot.oldPlays),
        avgLevel: levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : null,
        hardest: levels.length ? Math.max(...levels) : null,
        sssPlus: all.filter((p) => p.achievement >= 100.5).length,
    };
}

/** "A · B" for one stat; the higher side is bold. */
function row(label, a, b, format = (v) => String(v)) {
    const fa = a == null ? '—' : format(a);
    const fb = b == null ? '—' : format(b);
    const lead = a != null && b != null && a !== b ? (a > b ? 'a' : 'b') : null;
    return `${label}: ${lead === 'a' ? `**${fa}**` : fa}  ·  ${lead === 'b' ? `**${fb}**` : fb}`;
}

/** Charts both players have in their best 50, with the achievement gap (positive = A ahead). */
function sharedCharts(a, b) {
    const byKey = new Map(
        [...b.newPlays, ...b.oldPlays].map((p) => [chartKey(p.song, p.chartType, p.difficulty), p])
    );
    const shared = [];
    for (const play of [...a.newPlays, ...a.oldPlays]) {
        const other = byKey.get(chartKey(play.song, play.chartType, play.difficulty));
        if (other) shared.push({ play, other, gap: play.achievement - other.achievement });
    }
    return shared;
}

function gapLine(s, aheadName) {
    return (
        `**${s.play.song}** (${s.play.difficulty.slice(0, 3).toUpperCase()} ${s.play.level.toFixed(1)}) — ` +
        `${s.play.achievement.toFixed(2)}% vs ${s.other.achievement.toFixed(2)}% ` +
        `(${aheadName} +${Math.abs(s.gap).toFixed(2)})`
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('compare')
        .setDescription("Compare two players' best 50s")
        .addStringOption((opt) =>
            opt
                .setName('player')
                .setDescription('A friend to compare')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption((opt) =>
            opt
                .setName('versus')
                .setDescription('The other player — leave empty for the tracked account')
                .setAutocomplete(true)
        ),

    autocomplete: suggestPlayers,

    async execute(interaction) {
        if (await denyWithoutScope(interaction, 'leaderboard', "players' ratings and scores"))
            return;
        await interaction.deferReply();

        const [a, b] = await Promise.all([
            loadSnapshot(interaction.options.getString('player', true)),
            loadSnapshot(interaction.options.getString('versus') || undefined),
        ]);
        for (const snapshot of [a, b]) {
            if (!snapshot.success) {
                await interaction.editReply(describeFailure(snapshot));
                return;
            }
        }
        if (a.player.id === b.player.id) {
            await interaction.editReply('Pick two different players.');
            return;
        }

        // The image card is the answer; the text embed below is only what is sent if the card cannot be drawn.
        try {
            const data = compareSnapshots(a, b);
            const shown = [
                ...data.shared.slice(0, 8).map((x) => x.song),
                ...data.onlyA.slice(0, 4).map((x) => x.song),
                ...data.onlyB.slice(0, 4).map((x) => x.song),
            ];
            const html = buildCompareHtml({
                nameA: a.player.name,
                nameB: b.player.name,
                data,
                covers: await loadCoverMap(shown),
                staleNotes: [a, b]
                    .filter((x) => x.stale)
                    .map((x) => `${displayName(x.player.name)} (${x.ageDays ?? '?'}d old)`),
            });
            const png = await renderHtmlToPng(html, {
                width: WIDTH,
                scale: 1.5,
                allowedHosts: [COVER_HOST],
            });
            const gap = (data.sa.rating ?? 0) - (data.sb.rating ?? 0);
            const lead =
                gap === 0
                    ? 'level on rating'
                    : `${displayName(gap > 0 ? a.player.name : b.player.name)} ahead by ${formatInt(Math.abs(gap))}`;
            await interaction.editReply({
                content: `**${displayName(a.player.name)}** ${formatInt(data.sa.rating)} vs **${displayName(b.player.name)}** ${formatInt(data.sb.rating)} — ${lead}`,
                files: [new AttachmentBuilder(png, { name: 'compare.png' })],
            });
            return;
        } catch (err) {
            logger.error('compare', 'Could not draw the comparison card', err);
        }

        const sa = summarise(a);
        const sb = summarise(b);
        const stats = [
            row('Rating', sa.rating, sb.rating, formatInt),
            row('B15', sa.b15, sb.b15, formatInt),
            row('B35', sa.b35, sb.b35, formatInt),
            row('Average constant', sa.avgLevel, sb.avgLevel, (v) => v.toFixed(2)),
            row('Hardest chart', sa.hardest, sb.hardest, (v) => v.toFixed(1)),
            row('SSS+ in best 50', sa.sssPlus, sb.sssPlus),
        ].join('\n');

        const shared = sharedCharts(a, b);
        const aLeads = shared.filter((s) => s.gap > 0).sort((x, y) => y.gap - x.gap);
        const bLeads = shared.filter((s) => s.gap < 0).sort((x, y) => x.gap - y.gap);
        const embed = new EmbedBuilder()
            .setColor(parseInt(TOKENS.series1.slice(1), 16))
            .setTitle(`${a.player.name}  vs  ${b.player.name}`)
            .setDescription(`${stats}\n\n_Left: ${a.player.name} · right: ${b.player.name}_`)
            .setFooter({ text: freshnessNote(a, b) });

        if (shared.length === 0) {
            embed.addFields({ name: 'Shared charts', value: 'No chart is in both best 50s.' });
        } else {
            const lines = [
                ...aLeads.slice(0, BIGGEST_GAPS).map((s) => gapLine(s, a.player.name)),
                ...bLeads.slice(0, BIGGEST_GAPS).map((s) => gapLine(s, b.player.name)),
            ];
            embed.addFields({
                name: `${shared.length} shared chart${shared.length === 1 ? '' : 's'} — ${a.player.name} ahead on ${aLeads.length}, ${b.player.name} on ${bLeads.length}`.slice(
                    0,
                    256
                ),
                value: lines.join('\n').slice(0, 1024) || 'Identical scores on every shared chart.',
            });
        }
        await interaction.editReply({ embeds: [embed] });
    },
};
