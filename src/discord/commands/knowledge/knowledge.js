const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
    addEntry,
    listEntries,
    removeEntry,
    searchEntries,
} = require('../../../database/repositories/knowledgeRepository');
const { isAllowed, getAllowedScopes } = require('../../../permissions/permissionStore');

/** True for the owner, or anyone granted the 'knowledge' scope (see toolDefinitions.js's save_knowledge_base gating — same rule, both entry points). */
function canWrite(userId, guildId) {
    const scopes = getAllowedScopes(userId, guildId);
    return scopes === 'all' || scopes.includes('knowledge');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('knowledge')
        .setDescription("Manage the bot's shared AI knowledge base (global, all servers)")
        .addSubcommand((sub) =>
            sub
                .setName('add')
                .setDescription('Add or update a knowledge base entry (requires "knowledge" access)')
                .addStringOption((opt) =>
                    opt.setName('title').setDescription('Short label for the entry').setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('content')
                        .setDescription('The fact / answer to save')
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt.setName('category').setDescription('Optional category label').setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub.setName('list').setDescription('List every knowledge base entry')
        )
        .addSubcommand((sub) =>
            sub
                .setName('search')
                .setDescription('Search the knowledge base')
                .addStringOption((opt) =>
                    opt.setName('query').setDescription('Text to search for').setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('remove')
                .setDescription('Remove a knowledge base entry (requires "knowledge" access)')
                .addStringOption((opt) =>
                    opt.setName('title').setDescription('The entry title to delete').setRequired(true)
                )
        ),

    async execute(interaction) {
        if (!isAllowed(interaction.user.id, interaction.guildId)) {
            await interaction.reply({
                content: "You don't have permission to use this bot.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        // Global and shared, unlike memories — writes require the
        // 'knowledge' scope (owner has it by default, others must be
        // granted it) so a random allowed user can't poison it. The AI's
        // save_knowledge_base tool is gated by the exact same scope check.
        if ((sub === 'add' || sub === 'remove') && !canWrite(interaction.user.id, guildId)) {
            await interaction.reply({
                content:
                    'You need "knowledge" access to edit the knowledge base. Ask the bot owner to grant it.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (sub === 'add') {
            const title = interaction.options.getString('title', true);
            const content = interaction.options.getString('content', true);
            const category = interaction.options.getString('category') || null;

            const result = addEntry({
                guildId,
                title,
                content,
                category,
                createdBy: interaction.user.id,
            });

            if (!result.success) {
                await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
                return;
            }

            const verb = result.updated ? 'Updated' : 'Added';
            await interaction.reply({
                content: `${verb} knowledge base entry "${result.title}".`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (sub === 'remove') {
            const title = interaction.options.getString('title', true);
            const result = removeEntry(title);
            await interaction.reply({
                content: result.success ? `Removed "${result.title}".` : result.error,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (sub === 'list') {
            const entries = listEntries(50);
            if (entries.length === 0) {
                await interaction.reply({
                    content: 'The knowledge base is empty.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const lines = entries.map(
                (e) => `• **${e.title}** — ${e.content}${e.category ? ` _(${e.category})_` : ''}`
            );
            await interaction.reply({ content: lines.join('\n').slice(0, 2000), flags: MessageFlags.Ephemeral });
            return;
        }

        if (sub === 'search') {
            const query = interaction.options.getString('query', true);
            const entries = searchEntries(query, 5);
            if (entries.length === 0) {
                await interaction.reply({
                    content: `No knowledge base entries matched "${query}".`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const lines = entries.map(
                (e) => `• **${e.title}** — ${e.content}${e.category ? ` _(${e.category})_` : ''}`
            );
            await interaction.reply({ content: lines.join('\n').slice(0, 2000), flags: MessageFlags.Ephemeral });
        }
    },
};
