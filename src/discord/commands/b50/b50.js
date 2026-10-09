const { SlashCommandBuilder } = require('discord.js');
const renderB50 = require('../../../tools/renderMaimaiB50Image');
const { createOutputs } = require('../../../utils/outputs');
const { formatInt } = require('../../../render/theme');
const {
    denyWithoutScope,
    tooSoon,
    toAttachments,
    describeFailure,
    suggestPlayers,
} = require('../../commandHelpers');

// Runs the same tool the chat path uses, with no model in between: instant,
// and no tokens spent.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('b50')
        .setDescription("Show a player's best 50 as an image")
        .addStringOption((opt) =>
            opt
                .setName('player')
                .setDescription("A friend's name — leave empty for the tracked account")
                .setAutocomplete(true)
        ),

    autocomplete: suggestPlayers,

    async execute(interaction) {
        if (await denyWithoutScope(interaction, 'leaderboard', "players' ratings and scores"))
            return;
        if (await tooSoon(interaction)) return;
        await interaction.deferReply();

        const outputs = createOutputs();
        const player = interaction.options.getString('player') || undefined;
        const result = await renderB50.execute({ player_name: player }, { outputs });
        if (!result.success) {
            await interaction.editReply(describeFailure(result));
            return;
        }

        const stale = result.stale
            ? `\n⚠️ Out of date — this snapshot is ${result.snapshot_age_days ?? 'many'} day(s) old.`
            : '';
        await interaction.editReply({
            content: `**${result.player}** — rating ${formatInt(result.rating)}${stale}`,
            files: toAttachments(outputs.files),
        });
    },
};
