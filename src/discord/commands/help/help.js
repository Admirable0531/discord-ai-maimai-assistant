const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { TOKENS } = require('../../../render/theme');

module.exports = {
    data: new SlashCommandBuilder().setName('help').setDescription('What I can do and how to ask'),

    async execute(interaction) {
        // Built from the commands that are actually loaded, so it can't drift out of date.
        const commands = [...interaction.client.commands.values()]
            .map((c) => c.data.toJSON())
            .sort((a, b) => a.name.localeCompare(b.name));
        const list = commands.map((c) => `\`/${c.name}\` — ${c.description}`).join('\n');

        const embed = new EmbedBuilder()
            .setColor(parseInt(TOKENS.series1.slice(1), 16))
            .setTitle("I'm Atri — a maimai DX assistant")
            .setDescription(
                'Mention me or use `/ask` and ask in plain language: songs and charts, scores, B50 and rating, ' +
                    'friends and circles, the wiki. I answer in the language you write in. You can also attach a ' +
                    'screenshot (a result screen, a song jacket) and ask about it.'
            )
            .addFields(
                { name: 'Slash commands', value: list.slice(0, 1024) },
                {
                    name: 'Under my replies',
                    value:
                        '🔄 asks the same question again · 👍 / 👎 tells me whether it helped · ' +
                        '▶️ continues an answer that ran long.',
                },
                {
                    name: 'Memory',
                    value:
                        'I remember things you tell me ("call me …", "my main is …"). ' +
                        '`/memories` shows, edits and deletes them.',
                }
            );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
