const { SlashCommandBuilder } = require('discord.js');
const friendLeaderboard = require('../../../tools/getFriendLeaderboard');
const { createOutputs } = require('../../../utils/outputs');
const {
    denyWithoutScope,
    tooSoon,
    toAttachments,
    describeFailure,
} = require('../../commandHelpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription("Draw the tracked account's friend rating leaderboard")
        .addStringOption((opt) =>
            opt
                .setName('account')
                .setDescription('Which friend list (default: fy)')
                .addChoices({ name: 'fy', value: 'fy' }, { name: 'main', value: 'main' })
        ),

    async execute(interaction) {
        if (await denyWithoutScope(interaction, 'leaderboard', "the friends' ratings")) return;
        if (await tooSoon(interaction)) return;
        await interaction.deferReply();

        const outputs = createOutputs();
        const result = await friendLeaderboard.execute(
            { account_type: interaction.options.getString('account') || 'fy', as_image: true },
            { outputs }
        );
        if (!result.success) {
            await interaction.editReply(describeFailure(result));
            return;
        }
        const top = result.friends[0];
        const lines = [
            `**${result.accountType} account** — ${result.friends.length} friends${top ? ` · #1 ${top.name} (${top.rating.toLocaleString('en-US')})` : ''}`,
        ];
        if (result.is_stale) {
            lines.push(
                `⚠️ Out of date — this snapshot is ${result.snapshot_age_days ?? 'many'} day(s) old.`
            );
        }
        if (result.image_error) lines.push(`(Couldn't draw the chart: ${result.image_error})`);
        await interaction.editReply({
            content: lines.join('\n'),
            files: toAttachments(outputs.files),
        });
    },
};
