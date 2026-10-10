// What the buttons under the bot's replies do (their look is replyComponents.js):
//   ▶️ Continue / ⏹️ Stop here   finish, or cut short, an answer that hit the output limit
//   🔄 Regenerate               ask the same question again
//   👍 / 👎                      record whether the answer was any good
// Only the person who asked can continue, stop or regenerate — otherwise
// anyone in the channel could spend someone else's tokens or cut their answer
// short. Feedback is open to everyone. The offers live in memory (see
// replyDelivery.js), so after a restart they answer "expired" and the user
// just asks again.
const { MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { config } = require('../config/env');
const { generateReply } = require('../ai/agent');
const { CONTINUE_PROMPT } = require('../ai/truncation');
const { getHistory, appendMessage } = require('../conversation/historyStore');
const { removeLastExchange } = require('../database/repositories/conversationRepository');
const { recordFeedback } = require('../database/repositories/feedbackRepository');
const { createOutputs } = require('../utils/outputs');
const { IDS } = require('./replyComponents');
const {
    sendChunked,
    sendReply,
    continuable,
    regenerable,
    DISCORD_MESSAGE_LIMIT,
} = require('./replyDelivery');
const { createMessageProgress } = require('./progress');
const { whileTyping } = require('./typing');
const { describeUser } = require('./speaker');
const { onCooldown } = require('./cooldown');

const EPHEMERAL = MessageFlags.Ephemeral;

function privately(interaction, content) {
    return interaction.reply({ content, flags: EPHEMERAL });
}

/** The state behind a button, or null after telling the user why there isn't one they may use. */
async function claimState(interaction, offers, { cooldown = false } = {}) {
    const state = offers.get(interaction.message.id);
    if (!state) {
        await privately(
            interaction,
            'That one has expired (I may have restarted) — just ask me again.'
        );
        return null;
    }
    if (state.userId !== interaction.user.id) {
        await privately(interaction, 'Only the person who asked can do that.');
        return null;
    }
    if (cooldown && onCooldown(interaction.user.id, config.replyCooldownMs)) {
        await privately(interaction, 'Give it a few seconds first.');
        return null;
    }
    // One action per offer: drop it first so a double-tap can't run it twice, or race a stop against a continue.
    offers.delete(interaction.message.id);
    return state;
}

/**
 * ⏹️ sends the stash as it is. ▶️ goes through the normal generateReply path
 * with `continuation: true` (its own dedicated token budget — see the
 * providers), so the model sees the cut-off answer sitting in its own history
 * and is asked to carry on from where it stopped. A continuation that itself
 * hits the cap gets its own fresh notice, so the same choice is offered again
 * rather than losing the thread.
 */
async function handleContinuation(interaction) {
    const state = await claimState(interaction, continuable);
    if (!state) return;
    await interaction.update({ components: [] });
    const message = interaction.message;
    const { userId, channelId, guildId, accumulated } = state;

    if (interaction.customId === IDS.stop) {
        const finalText = accumulated.trim();
        await sendChunked(
            message,
            finalText
                ? `${finalText}\n\n_(stopped there — that's everything I had ready)_`
                : "I didn't have anything ready yet — try asking again."
        ).catch((err) =>
            logger.error('discord', `Failed to send stopped reply for ${interaction.user.tag}`, err)
        );
        return;
    }

    try {
        await whileTyping(message.channel, async () => {
            const history = getHistory(channelId, userId);
            const member = message.guild?.members.cache.get(interaction.user.id);
            const outputs = createOutputs();
            const reply = await generateReply(history, CONTINUE_PROMPT, {
                userId,
                guildId,
                speaker: describeUser(interaction.user, member),
                continuation: true,
                outputs,
            });

            appendMessage({ userId, guildId, channelId, role: 'user', content: CONTINUE_PROMPT });
            appendMessage({ userId, guildId, channelId, role: 'assistant', content: reply });

            await sendReply(message, reply, {
                userId,
                channelId,
                guildId,
                accumulated,
                files: outputs.files,
            });
        });
    } catch (err) {
        logger.error('discord', `Failed to continue a reply for ${interaction.user.tag}`, err);
        // Whatever went wrong upstream, the work already generated is still
        // worth delivering — losing it here is what made a failed
        // continuation look like the bot silently ignoring the button.
        const fallback = accumulated.trim();
        const notice = fallback
            ? `Sorry, I couldn't finish that one. Here's what I had so far:\n\n${fallback}`
            : "Sorry, I couldn't pick that back up — ask me to continue in a message instead.";
        try {
            await sendChunked(message, notice);
        } catch (sendErr) {
            // Never swallowed: when this failed quietly, the typing indicator
            // just stopped with nothing posted, which from the outside is
            // indistinguishable from the bot ignoring you. reply() can fail on
            // its own (deleted/unreachable target) while a plain channel send
            // still works, so try that too.
            logger.error('discord', 'Could not deliver the continuation fallback', sendErr);
            await message.channel
                .send(notice.slice(0, DISCORD_MESSAGE_LIMIT))
                .catch((lastErr) =>
                    logger.error('discord', 'Could not send to the channel either', lastErr)
                );
        }
    }
}

/** 🔄: the same question again, as a fresh reply to the old answer, with the old exchange taken out of the history. */
async function handleRegenerate(interaction) {
    const state = await claimState(interaction, regenerable, { cooldown: true });
    if (!state) return;
    await interaction.update({ components: [] });
    const message = interaction.message;
    const { userId, channelId, guildId, promptText, speaker, reply: oldReply } = state;

    const removed = removeLastExchange(channelId, userId, oldReply);
    const progress = createMessageProgress(message);
    try {
        await whileTyping(message.channel, async () => {
            const history = getHistory(channelId, userId);
            const outputs = createOutputs();
            const reply = await generateReply(history, promptText, {
                userId,
                guildId,
                speaker,
                outputs,
                onProgress: progress.onProgress,
            });

            appendMessage({ userId, guildId, channelId, role: 'user', content: promptText });
            appendMessage({ userId, guildId, channelId, role: 'assistant', content: reply });

            await sendReply(message, reply, {
                userId,
                channelId,
                guildId,
                files: outputs.files,
                statusMessage: await progress.take(),
                regenerate: { promptText, speaker },
            });
        });
    } catch (err) {
        logger.error('discord', `Failed to regenerate a reply for ${interaction.user.tag}`, err);
        if (removed) {
            appendMessage({ userId, guildId, channelId, role: 'user', content: promptText });
            appendMessage({ userId, guildId, channelId, role: 'assistant', content: oldReply });
        }
        const status = await progress.take().catch(() => null);
        const notice = "Sorry, I couldn't redo that one — try asking again in a moment.";
        if (status) await status.edit({ content: notice, components: [] }).catch(() => {});
        else await message.reply(notice).catch(() => {});
    }
}

async function handleFeedback(interaction) {
    const rating = interaction.customId === IDS.up ? 1 : -1;
    try {
        recordFeedback({
            messageId: interaction.message.id,
            userId: interaction.user.id,
            channelId: interaction.channelId,
            rating,
            excerpt: interaction.message.content,
        });
    } catch (err) {
        logger.error('discord', 'Could not record feedback', err);
        await privately(interaction, "Sorry, I couldn't save that.");
        return;
    }
    await privately(
        interaction,
        rating === 1 ? 'Thanks — glad that helped. 👍' : "Thanks — noted, I'll try to do better. 👎"
    );
}

/** Routes a button press under a reply. Returns false for a button that isn't one of these. */
async function handleReplyButton(interaction) {
    switch (interaction.customId) {
        case IDS.continue:
        case IDS.stop:
            await handleContinuation(interaction);
            return true;
        case IDS.regenerate:
            await handleRegenerate(interaction);
            return true;
        case IDS.up:
        case IDS.down:
            await handleFeedback(interaction);
            return true;
        default:
            return false;
    }
}

module.exports = { handleReplyButton };
