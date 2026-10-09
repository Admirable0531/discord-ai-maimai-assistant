const { SlashCommandBuilder } = require('discord.js');
const circleRankings = require('../../../tools/getCircleRankings');
const { createOutputs } = require('../../../utils/outputs');
const {
    denyWithoutScope,
    tooSoon,
    toAttachments,
    describeFailure,
} = require('../../commandHelpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('circles')
        .setDescription('Draw the circle (team) points ranking')
        .addIntegerOption((opt) =>
            opt
                .setName('top')
                .setDescription('How many circles to show (default 20)')
                .setMinValue(3)
                .setMaxValue(50)
        ),

    async execute(interaction) {
        if (await denyWithoutScope(interaction, 'leaderboard', 'the circle rankings')) return;
        if (await tooSoon(interaction)) return;
        await interaction.deferReply();

        const outputs = createOutputs();
        const result = await circleRankings.execute(
            { limit: interaction.options.getInteger('top') || 20, as_image: true },
            { outputs }
        );
        if (!result.success) {
            await interaction.editReply(describeFailure(result));
            return;
        }
        const first = result.rankings[0];
        const lines = [
            first
                ? `**#1 ${first.groupName}** — ${first.points.toLocaleString('en-US')} points`
                : 'No circles recorded yet.',
        ];
        if (result.image_error) lines.push(`(Couldn't draw the chart: ${result.image_error})`);
        await interaction.editReply({
            content: lines.join('\n'),
            files: toAttachments(outputs.files),
        });
    },
};
