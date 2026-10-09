const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getSongRating, findMinAchvForRating } = require('../../../web/maimaiRatingMath');
const { TOKENS } = require('../../../render/theme');

// The brackets players actually aim for.
const MILESTONES = [
    ['SSS+', 100.5],
    ['SSS', 100.0],
    ['SS+', 99.5],
    ['SS', 99.0],
    ['S+', 98.0],
    ['S', 97.0],
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rating')
        .setDescription('How much rating a score is worth, and what the next point costs')
        .addNumberOption((opt) =>
            opt
                .setName('constant')
                .setDescription('Chart constant, e.g. 14.8')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(15.9)
        )
        .addNumberOption((opt) =>
            opt
                .setName('achievement')
                .setDescription('Achievement %, e.g. 100.5')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(101)
        ),

    async execute(interaction) {
        const constant = interaction.options.getNumber('constant', true);
        const achievement = interaction.options.getNumber('achievement', true);
        const score = getSongRating(constant, achievement);
        if (!score) {
            await interaction.reply({
                content: "That achievement doesn't map to a rank.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const next = findMinAchvForRating(constant, score.rating + 1);
        const nextText = next
            ? `**${next.achv_needed.toFixed(4)}%** (${next.rank}) for ${score.rating + 1}`
            : "Can't go higher — this chart is already maxed at that rating.";
        const table = MILESTONES.map(([rank, achv]) => {
            const worth = getSongRating(constant, achv).rating;
            return `${rank.padEnd(4)} ${achv.toFixed(4).padStart(8)}%  ${String(worth).padStart(3)}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor(parseInt(TOKENS.series1.slice(1), 16))
            .setTitle(`${constant.toFixed(1)} @ ${achievement.toFixed(4)}%`)
            .setDescription(`**${score.rank}** → **${score.rating}** rating`)
            .addFields(
                { name: 'Next rating point', value: nextText },
                {
                    name: `At common targets (${constant.toFixed(1)})`,
                    value: `\`\`\`\n${table}\n\`\`\``,
                }
            )
            .setFooter({ text: 'Per-chart rating; achievement above 100.5% adds nothing.' });
        await interaction.reply({ embeds: [embed] });
    },
};
