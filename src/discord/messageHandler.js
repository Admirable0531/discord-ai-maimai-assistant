const logger = require('../utils/logger');
const { getHistory, appendMessage } = require('../conversation/historyStore');
const { generateReply } = require('../ai/agent');
const { isOwner } = require('../permissions/permissionStore');
const { tryHandleAdminCommand } = require('./adminCommands');
const { isTruncated, stripTruncationMarker, CONTINUE_PROMPT } = require('../ai/truncation');

const DISCORD_MESSAGE_LIMIT = 2000;
const REPLY_CONTEXT_MAX_LENGTH = 800;
const CONTINUE_EMOJI = '▶️';
const STOP_EMOJI = '⏹️';
const NOT_ENOUGH_CONTEXT_NOTICE =
    "Not enough context budget to finish this in one go. React ▶️ and I'll keep going, " +
    "or ⏹️ to send what I've got so far.";
/**
 * Bot notices offering to pick up a reply that stopped at the output-token
 * limit: botMessageId -> { userId, channelId, guildId, accumulated }.
 * `accumulated` is everything generated so far with the cut-off marker
 * stripped, kept off Discord until the answer is either finished (▶️) or
 * the asker settles for what's there (⏹️). In memory on purpose — this is a
 * convenience affordance, and after a restart the user can still just ask
 * again. Capped so a long-running process can't accumulate them forever.
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

/**
 * Splits text across Discord's 2000-char message limit without dropping any
 * of it — breaking at the last newline that fits so a table row or sentence
 * doesn't get sliced mid-way. Previously anything over the limit was cut
 * off with "...(truncated)", which quietly lost content instead of just
 * spreading it across more messages.
 */
function splitForDiscord(text) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > DISCORD_MESSAGE_LIMIT) {
        let splitAt = remaining.lastIndexOf('\n', DISCORD_MESSAGE_LIMIT);
        if (splitAt <= 0) splitAt = DISCORD_MESSAGE_LIMIT;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).replace(/^\n+/, '');
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

/** Sends (possibly long) text as one or more messages, replying with the first. */
async function sendChunked(message, text) {
    const chunks = splitForDiscord(text);
    let sent;
    for (let i = 0; i < chunks.length; i++) {
        sent =
            i === 0
                ? await message.reply({
                      content: chunks[0],
                      allowedMentions: { repliedUser: false },
                  })
                : await message.channel.send(chunks[i]);
    }
    return sent;
}

function registerContinuable(messageId, state) {
    if (continuable.size >= MAX_CONTINUABLE) {
        continuable.delete(continuable.keys().next().value); // drop the oldest
    }
    continuable.set(messageId, state);
}

/**
 * Delivers a reply. A finished answer (this reply plus anything accumulated
 * from earlier cut-off segments) goes straight to Discord in full, however
 * many messages that takes — never trimmed. A reply that hit the output-token
 * cap is NOT sent as-is: showing half a table and calling it done is exactly
 * what this is trying to avoid. Instead its (marker-stripped) text is folded
 * into the hidden `accumulated` stash, and a short notice goes out offering
 * ▶️ to keep going or ⏹️ to take what's there so far (see
 * registerReactionHandler). Only that notice gets reactions — a finished
 * answer needs neither.
 */
async function sendReply(message, reply, { userId, channelId, guildId, accumulated = '' }) {
    if (!isTruncated(reply)) {
        return sendChunked(message, accumulated + reply);
    }

    const nextAccumulated = accumulated + stripTruncationMarker(reply) + '\n\n';
    const notice = await message.reply({
        content: NOT_ENOUGH_CONTEXT_NOTICE,
        allowedMentions: { repliedUser: false },
    });

    try {
        await notice.react(CONTINUE_EMOJI);
        await notice.react(STOP_EMOJI);
        registerContinuable(notice.id, {
            userId,
            channelId,
            guildId,
            accumulated: nextAccumulated,
        });
    } catch (err) {
        // Missing Add Reactions permission shouldn't lose the answer that's
        // already been generated — fall back to sending what's ready instead
        // of stranding it with no way to reach it.
        logger.warn(
            'discord',
            'Could not add the continue/stop reactions — sending what I have',
            err
        );
        await sendChunked(message, nextAccumulated.trim());
    }
    return notice;
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

            await sendReply(message, reply, { userId, channelId, guildId });
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
 * Reacts to a "not enough context" notice (see sendReply): ▶️ keeps
 * generating and folds the result into what's already stashed, ⏹️ stops
 * there and sends the stash as-is.
 *
 * The ▶️ continuation goes through the normal generateReply path with
 * `continuation: true` (its own dedicated token budget — see the
 * providers), so the model sees the cut-off answer sitting in its own
 * history and is asked to carry on from where it stopped. A continuation
 * that itself hits the cap gets its own fresh notice, so the same choice is
 * offered again rather than losing the thread.
 */
function registerReactionHandler(client, config) {
    client.on('messageReactionAdd', async (reaction, user) => {
        if (user.bot) return;
        // Only the asker may act on their own answer — otherwise anyone in
        // the channel could spend tokens on, or cut short, someone else's.
        const state = continuable.get(reaction.message.id);
        if (!state || state.userId !== user.id) return;

        let emojiName;
        try {
            if (reaction.partial) await reaction.fetch();
            emojiName = reaction.emoji.name;
        } catch (err) {
            logger.warn('discord', 'Could not resolve a reaction', err);
            return;
        }
        if (emojiName !== CONTINUE_EMOJI && emojiName !== STOP_EMOJI) return;

        // One action per offer: drop it first so a double-tap (or a
        // remove-and-re-add) can't run the same continuation twice, or race
        // a stop against a continue.
        continuable.delete(reaction.message.id);

        const message = reaction.message.partial
            ? await reaction.message.fetch().catch(() => null)
            : reaction.message;
        if (!message) return;

        if (emojiName === STOP_EMOJI) {
            const finalText = state.accumulated.trim();
            await sendChunked(
                message,
                finalText
                    ? `${finalText}\n\n_(stopped there — that's everything I had ready)_`
                    : "I didn't have anything ready yet — try asking again."
            ).catch((err) =>
                logger.error('discord', `Failed to send stopped reply for ${user.tag}`, err)
            );
            return;
        }

        const { userId, channelId, guildId, accumulated } = state;
        const typingInterval = setInterval(() => {
            message.channel.sendTyping().catch(() => {});
        }, 8000);

        try {
            await message.channel.sendTyping().catch(() => {});
            const history = getHistory(channelId, userId);
            const reply = await generateReply(history, CONTINUE_PROMPT, {
                userId,
                guildId,
                continuation: true,
            });

            appendMessage({
                userId,
                guildId,
                channelId,
                role: 'user',
                content: CONTINUE_PROMPT,
            });
            appendMessage({ userId, guildId, channelId, role: 'assistant', content: reply });

            await sendReply(message, reply, { userId, channelId, guildId, accumulated });
        } catch (err) {
            logger.error('discord', `Failed to continue a reply for ${user.tag}`, err);
            const fallback = accumulated.trim();
            await (
                fallback
                    ? sendChunked(
                          message,
                          `Sorry, I couldn't pick that back up. Here's what I had:\n\n${fallback}`
                      )
                    : message.channel.send(
                          "Sorry, I couldn't pick that back up — ask me to continue in a message instead."
                      )
            ).catch(() => {});
        } finally {
            clearInterval(typingInterval);
        }
    });

    // config is accepted for symmetry with registerMessageHandler (and so a
    // future cooldown here can read the same settings); nothing needs it yet.
    void config;
}

module.exports = { registerMessageHandler, registerReactionHandler };
