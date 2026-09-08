const logger = require('../utils/logger');
const { getHistory, appendMessage } = require('../conversation/historyStore');
const { generateReply } = require('../ai/agent');
const { isOwner } = require('../permissions/permissionStore');
const { tryHandleAdminCommand } = require('./adminCommands');
const { isTruncated, CONTINUE_PROMPT } = require('../ai/truncation');

const DISCORD_MESSAGE_LIMIT = 2000;
const REPLY_CONTEXT_MAX_LENGTH = 800;
const CONTINUE_EMOJI = '▶️';
/**
 * Bot replies that stopped at the output-token limit and can be picked up
 * again: botMessageId -> the user allowed to continue it. In memory on
 * purpose — this is a convenience affordance, and after a restart the user
 * can still just say "continue" in the channel. Capped so a long-running
 * process can't accumulate them forever.
 */
const continuable = new Map();
const MAX_CONTINUABLE = 200;

/** userId -> last reply timestamp (ms). Simple in-memory cooldown, not persisted. */
const lastReplyAtByUser = new Map();

/**
 * Trigger: @-mentioned in a guild channel, or a DM from the owner. DMs from
 * anyone else are ignored — the bot doesn't respond to being messaged
 * directly except for the owner's own admin/chat access.
 */
function shouldRespond(message, clientUserId) {
    if (message.author.bot) return false;
    if (!message.guild) return isOwner(message.author.id);
    return message.mentions.has(clientUserId);
}

function isOnCooldown(userId, cooldownMs) {
    const last = lastReplyAtByUser.get(userId);
    if (last === undefined) return false;
    return Date.now() - last < cooldownMs;
}

/** Strips a leading bot mention so it doesn't pollute the prompt sent to Gemini. */
function stripMention(content, clientUserId) {
    return content.replace(new RegExp(`^<@!?${clientUserId}>\\s*`), '').trim();
}

function truncateForDiscord(text) {
    if (text.length <= DISCORD_MESSAGE_LIMIT) return text;
    return `${text.slice(0, DISCORD_MESSAGE_LIMIT - 20)}\n\n...(truncated)`;
}

/**
 * Sends a reply and, when the model stopped at its output-token limit rather
 * than finishing, offers to pick it up: the bot reacts to its own message
 * with ▶️, and whoever asked can hit that same reaction to get the rest
 * (see registerReactionHandler). Answers that finished normally get no
 * reaction, so the ▶️ is a reliable signal that something is genuinely missing
 * rather than decoration on every reply.
 */
async function sendReply(message, reply, userId) {
    const sent = await message.reply({
        content: truncateForDiscord(reply),
        allowedMentions: { repliedUser: false },
    });

    if (!isTruncated(reply)) return sent;

    try {
        await sent.react(CONTINUE_EMOJI);
        if (continuable.size >= MAX_CONTINUABLE) {
            continuable.delete(continuable.keys().next().value); // drop the oldest
        }
        continuable.set(sent.id, userId);
    } catch (err) {
        // Missing Add Reactions permission shouldn't lose the answer that was
        // already delivered — the reply itself still says it was cut off.
        logger.warn('discord', 'Could not add the continue reaction', err);
    }
    return sent;
}

/**
 * If this message is a Discord reply, fetches the message it replied to and
 * returns {author, content} for quoting into the prompt — null if it isn't
 * a reply, or if the referenced message couldn't be fetched (deleted,
 * permissions, etc.), in which case the caller just proceeds without it
 * rather than failing the whole response.
 */
async function buildReplyContext(message) {
    if (!message.reference?.messageId) return null;
    try {
        const referenced = await message.fetchReference();
        const author =
            referenced.author?.id === message.client.user.id
                ? 'Atri (you)'
                : referenced.author?.tag || 'someone';

        let content = referenced.content?.trim() || '';
        if (!content && referenced.attachments.size > 0) content = '[attachment, no text]';
        else if (!content && referenced.embeds.length > 0) content = '[embed, no text]';
        else if (!content) content = '[no text content]';
        if (content.length > REPLY_CONTEXT_MAX_LENGTH) {
            content = `${content.slice(0, REPLY_CONTEXT_MAX_LENGTH)}...(truncated)`;
        }

        return { author, content };
    } catch (err) {
        logger.warn('discord', 'Could not fetch replied-to message', err);
        return null;
    }
}

function registerMessageHandler(client, config) {
    client.on('messageCreate', async (message) => {
        if (!shouldRespond(message, client.user.id)) return;

        const userId = message.author.id;
        const guildId = message.guild?.id || null;

        const userText = stripMention(message.content, client.user.id);
        if (!userText) return;

        const replyContext = await buildReplyContext(message);
        const promptText = replyContext
            ? `[Replying to a message from ${replyContext.author}: "${replyContext.content}"]\n${userText}`
            : userText;

        if (isOwner(userId)) {
            const adminReply = tryHandleAdminCommand(userText, guildId);
            if (adminReply !== null) {
                await message
                    .reply({ content: adminReply, allowedMentions: { parse: [] } })
                    .catch((err) =>
                        logger.error('discord', 'Could not send admin command reply', err)
                    );
                return;
            }
        }

        if (isOnCooldown(userId, config.replyCooldownMs)) {
            logger.info('discord', `Ignoring message from ${message.author.tag} (cooldown)`);
            return;
        }
        lastReplyAtByUser.set(userId, Date.now());

        const channelId = message.channel.id;
        const history = getHistory(channelId, userId);

        // Discord's typing indicator lasts ~10s and isn't auto-refreshed — a
        // single sendTyping() before a multi-tool-call generateReply() (which
        // can easily run longer than that) expires mid-work, so it looks like
        // Atri gave up until the reply suddenly appears. Re-trigger it on an
        // interval, comfortably under the 10s expiry, for as long as work is
        // still in flight.
        const typingInterval = setInterval(() => {
            message.channel.sendTyping().catch(() => {});
        }, 8000);

        try {
            await message.channel.sendTyping().catch(() => {});
            const reply = await generateReply(history, promptText, { userId, guildId });

            appendMessage({ userId, guildId, channelId, role: 'user', content: promptText });
            appendMessage({ userId, guildId, channelId, role: 'assistant', content: reply });

            await sendReply(message, reply, userId);
        } catch (err) {
            logger.error('discord', `Failed to answer ${message.author.tag}`, err);
            await message
                .reply('Sorry, something went wrong answering that. Please try again in a moment.')
                .catch((replyErr) =>
                    logger.error('discord', 'Could not send error reply', replyErr)
                );
        } finally {
            clearInterval(typingInterval);
        }
    });
}

/**
 * Picks a cut-off reply back up when the person who asked reacts with ▶️.
 *
 * The continuation goes through the normal generateReply path, so the model
 * sees the truncated answer sitting in its own history and is asked to carry
 * on from where it stopped. A continuation can itself be cut off, in which
 * case it gets its own ▶️ and the same thing works again.
 */
function registerReactionHandler(client, config) {
    client.on('messageReactionAdd', async (reaction, user) => {
        if (user.bot) return;
        // Only the asker may continue their own answer — otherwise anyone in
        // the channel could spend tokens on someone else's conversation.
        const owner = continuable.get(reaction.message.id);
        if (!owner || owner !== user.id) return;

        try {
            if (reaction.partial) await reaction.fetch();
            if (reaction.emoji.name !== CONTINUE_EMOJI) return;
        } catch (err) {
            logger.warn('discord', 'Could not resolve a reaction', err);
            return;
        }

        // One continuation per offer: drop it first so a double-tap (or a
        // remove-and-re-add) can't run the same expensive continuation twice.
        continuable.delete(reaction.message.id);

        const message = reaction.message.partial
            ? await reaction.message.fetch().catch(() => null)
            : reaction.message;
        if (!message) return;

        const channelId = message.channelId;
        const guildId = message.guild?.id || null;
        const userId = user.id;

        const typingInterval = setInterval(() => {
            message.channel.sendTyping().catch(() => {});
        }, 8000);

        try {
            await message.channel.sendTyping().catch(() => {});
            const history = getHistory(channelId, userId);
            const reply = await generateReply(history, CONTINUE_PROMPT, { userId, guildId });

            appendMessage({
                userId,
                guildId,
                channelId,
                role: 'user',
                content: CONTINUE_PROMPT,
            });
            appendMessage({ userId, guildId, channelId, role: 'assistant', content: reply });

            await sendReply(message, reply, userId);
        } catch (err) {
            logger.error('discord', `Failed to continue a reply for ${user.tag}`, err);
            await message.channel
                .send("Sorry, I couldn't pick that back up — ask me to continue in a message instead.")
                .catch(() => {});
        } finally {
            clearInterval(typingInterval);
        }
    });

    // config is accepted for symmetry with registerMessageHandler (and so a
    // future cooldown here can read the same settings); nothing needs it yet.
    void config;
}

module.exports = { registerMessageHandler, registerReactionHandler };
