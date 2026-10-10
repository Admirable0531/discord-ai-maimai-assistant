// Sends every button, select menu and modal submission to the module that
// owns it, by the namespace at the start of its custom id.
const { MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { handleReplyButton } = require('./replyButtons');
const { handleMemoriesInteraction, ID_PREFIX: MEMORIES_PREFIX } = require('./memoriesUi');

async function routeComponent(interaction) {
    const id = interaction.customId;
    try {
        if (id.startsWith('atri:')) {
            if (!(await handleReplyButton(interaction))) {
                logger.warn('bot', `Unknown reply button ${id}`);
            }
        } else if (id.startsWith(`${MEMORIES_PREFIX}:`)) {
            await handleMemoriesInteraction(interaction);
        } else {
            logger.warn('bot', `No handler for component ${id}`);
        }
    } catch (err) {
        logger.error('bot', `Component ${id} failed`, err);
        const payload = {
            content: 'Something went wrong with that.',
            flags: MessageFlags.Ephemeral,
        };
        try {
            if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
            else await interaction.reply(payload);
        } catch (replyErr) {
            logger.error('bot', 'Could not report component failure', replyErr);
        }
    }
}

module.exports = { routeComponent };
