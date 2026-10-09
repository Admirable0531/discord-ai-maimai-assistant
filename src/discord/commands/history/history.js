const { SlashCommandBuilder } = require('discord.js');
const renderHistory = require('../../../tools/renderMaimaiRatingHistory');
const { createOutputs } = require('../../../utils/outputs');
const { formatInt } = require('../../../render/theme');
const {
    denyWithoutScope,
    tooSoon,
    toAttachments,
    describeFailure,
    suggestPlayers,
} = require('../../commandHelpers');

const signed = (n) =>
    n === null || n === undefined
        ? null
        : `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatInt(Math.abs(n))}`;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription("Graph a player's rating over time")
        .addStringOption((opt) =>
            opt
                .setName('player')
                .setDescription("A friend's name — leave empty for the tracked account")
                .setAutocomplete(true)
        )
        .addIntegerOption((opt) =>
            opt
                .setName('days')
                .setDescription('Only the most recent N days (default: everything recorded)')
                .setMinValue(7)
                .setMaxValue(3650)
        ),

    autocomplete: suggestPlayers,

    async execute(interaction) {
        if (await denyWithoutScope(interaction, 'leaderboard', "players' rating history")) return;
        if (await tooSoon(interaction)) return;
        await interaction.deferReply();

        const outputs = createOutputs();
        const result = await renderHistory.execute(
            {
                player_name: interaction.options.getString('player') || undefined,
                days: interaction.options.getInteger('days') || undefined,
            },
            { outputs }
        );
        if (!result.success) {
            await interaction.editReply(describeFailure(result));
            return;
        }

        const recent = [
            ['30d', result.change_last_30_days],
            ['90d', result.change_last_90_days],
            ['1y', result.change_last_365_days],
        ]
            .filter(([, change]) => change !== null && change !== undefined)
            .map(([label, change]) => `${label} ${signed(change)}`);
        const lines = [
            `**${result.player}** — ${formatInt(result.latest_rating)} (${signed(result.change_total)} since ${result.from}) · peak ${formatInt(result.peak_rating)} on ${result.peak_date}`,
        ];
        if (recent.length > 0) lines.push(`Recent: ${recent.join(' · ')}`);
        if (result.latest_snapshot_age_days > 2) {
            lines.push(`⚠️ The last snapshot is ${result.latest_snapshot_age_days} days old.`);
        }
        await interaction.editReply({
            content: lines.join('\n'),
            files: toAttachments(outputs.files),
        });
    },
};
