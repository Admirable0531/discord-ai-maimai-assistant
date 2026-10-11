const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const logger = require('../../../utils/logger');
const { config } = require('../../../config/env');
const { generateReply } = require('../../../ai/agent');
const { isTruncated, stripTruncationMarker } = require('../../../ai/truncation');
const { getHistory, appendMessage } = require('../../../conversation/historyStore');
const { isOwner } = require('../../../permissions/permissionStore');
const { createOutputs } = require('../../../utils/outputs');
const { answerRow } = require('../../replyComponents');
const { splitForDiscord, balanceCodeFences } = require('../../replyDelivery');
const { createInteractionProgress } = require('../../progress');
const { describeUser } = require('../../speaker');
const { onCooldown } = require('../../cooldown');
const { toAttachments } = require('../../commandHelpers');

const CUT_OFF_NOTE = '\n\n_(That ran long and was cut off — ask me to continue.)_';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Ask me anything, without having to @-mention me')
        .addStringOption((opt) =>
            opt
                .setName('question')
                .setDescription('What do you want to know?')
                .setRequired(true)
                .setMaxLength(1500)
        ),

    // The same path as an @mention — same model, tools, permissions, memory and
    // history — so the answer is the one you'd have got by mentioning me.
    async execute(interaction) {
        const userId = interaction.user.id;
        // Like a DM to the bot: only the owner may use it outside a server.
        if (!interaction.guildId && !isOwner(userId)) {
            await interaction.reply({
                content: 'Ask me in a server I am in, or mention me there.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (onCooldown(userId, config.replyCooldownMs)) {
            await interaction.reply({
                content: 'Give it a few seconds first.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply();

        const question = interaction.options.getString('question', true);
        const { guildId, channelId } = interaction;
        const progress = createInteractionProgress(interaction);
        try {
            const outputs = createOutputs();
            const reply = await generateReply(getHistory(channelId, userId), question, {
                userId,
                guildId,
                speaker: describeUser(interaction.user, interaction.member),
                outputs,
                onProgress: progress.onProgress,
            });
            await progress.finish();

            appendMessage({ userId, guildId, channelId, role: 'user', content: question });
            appendMessage({ userId, guildId, channelId, role: 'assistant', content: reply });

            const text = isTruncated(reply) ? stripTruncationMarker(reply) + CUT_OFF_NOTE : reply;
            const chunks = splitForDiscord(balanceCodeFences(text));
            const rows = [answerRow({ canRegenerate: false })];
            const files = toAttachments(outputs.files);
            // The question goes first so the answer reads as an answer in a shared channel.
            const first = `> ${question.replace(/\n/g, '\n> ')}\n${chunks[0] || ''}`.slice(0, 2000);
            await interaction.editReply({
                content: first,
                files,
                components: chunks.length <= 1 ? rows : [],
            });
            for (let i = 1; i < chunks.length; i++) {
                await interaction.followUp({
                    content: chunks[i],
                    components: i === chunks.length - 1 ? rows : [],
                });
            }
        } catch (err) {
            logger.error('discord', `/ask failed for ${interaction.user.tag}`, err);
            try {
                appendMessage({ userId, guildId, channelId, role: 'user', content: question });
                appendMessage({
                    userId,
                    guildId,
                    channelId,
                    role: 'assistant',
                    content: '(That question failed with an error and was not answered.)',
                });
            } catch (historyErr) {
                logger.warn('discord', 'Could not remember a failed question', historyErr);
            }
            await progress.finish();
            await interaction.editReply({
                content:
                    'Sorry, something went wrong answering that. Please try again in a moment.',
                components: [],
            });
        }
    },
};
