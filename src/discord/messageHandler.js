const logger = require('../utils/logger');
const { getHistory, appendMessage } = require('../conversation/historyStore');
const { generateReply } = require('../ai/agent');
const { isOwner } = require('../permissions/permissionStore');
const { tryHandleAdminCommand } = require('./adminCommands');
const { collectImages, describeImages, unreadableImagesReply } = require('./imageInputs');
const { createOutputs } = require('../utils/outputs');
const { sendReply } = require('./replyDelivery');
const { createMessageProgress } = require('./progress');
const { whileTyping } = require('./typing');
const { describeUser } = require('./speaker');
const { onCooldown } = require('./cooldown');

const REPLY_CONTEXT_MAX_LENGTH = 800;

const FAILED_NOTE = '(That question failed with an error and was not answered.)';

/** Saves a question that could not be answered, so "try again" retries it rather than an older one. */
function rememberFailedQuestion({ userId, guildId, channelId, promptText }) {
    try {
        appendMessage({ userId, guildId, channelId, role: 'user', content: promptText });
        appendMessage({ userId, guildId, channelId, role: 'assistant', content: FAILED_NOTE });
    } catch (err) {
        logger.warn('discord', 'Could not remember a failed question', err);
    }
}

/** Runs `send` and, if it throws (a network blip reaching Discord), tries once more after a short wait. */
async function withRetry(send) {
    try {
        return await send();
    } catch (err) {
        logger.warn('discord', `Discord send failed, retrying once: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return send();
    }
}

const INTRO =
    "Hi, I'm Atri — ask me anything about maimai: songs and charts, your B50 and rating, scores, " +
    'friends and circles. Mention me with a question, or use `/ask`. `/help` lists everything I can do.';

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

/**
 * Rewrites Discord's raw mention syntax into names the model can use:
 * <@123> -> @Name (<@123>), and the same for roles and channels. The model
 * only ever saw the bare ids, so "what is <@123>" or "should <@123> play
 * valo" got "I can't resolve Discord ids". The id stays alongside the name so
 * the model can still mention that person back. Uses the names Discord sent
 * with the message, so no extra API calls.
 */
function resolveMentions(text, message) {
    if (!text || !message) return text;
    const clientId = message.client?.user?.id;
    return text
        .replace(/<@!?(\d+)>/g, (raw, id) => {
            if (id === clientId) return '@Atri (you)';
            const member = message.mentions?.members?.get(id);
            const user = message.mentions?.users?.get(id);
            const name = member?.displayName || user?.globalName || user?.username;
            return name ? `@${name} (${raw})` : raw;
        })
        .replace(/<@&(\d+)>/g, (raw, id) => {
            const role = message.mentions?.roles?.get(id);
            return role ? `@${role.name} (role)` : raw;
        })
        .replace(/<#(\d+)>/g, (raw, id) => {
            const channel = message.mentions?.channels?.get(id);
            return channel?.name ? `#${channel.name}` : raw;
        });
}

/** Strips a leading bot mention so it doesn't pollute the prompt sent to Gemini. */
function stripMention(content, clientUserId) {
    return content.replace(new RegExp(`^<@!?${clientUserId}>\\s*`), '').trim();
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
        content = resolveMentions(content, referenced);
        if (content.length > REPLY_CONTEXT_MAX_LENGTH) {
            content = `${content.slice(0, REPLY_CONTEXT_MAX_LENGTH)}...(truncated)`;
        }

        return { author, content, referenced };
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
        // An image with no words is still a question ("what song is this?").
        if (!userText && message.attachments.size === 0) {
            // A bare mention: say what this is rather than staying silent.
            if (!onCooldown(userId, config.replyCooldownMs)) {
                await message
                    .reply({ content: INTRO, allowedMentions: { repliedUser: false } })
                    .catch((err) => logger.error('discord', 'Could not send the intro', err));
            }
            return;
        }

        const replyContext = await buildReplyContext(message);
        const resolvedText = resolveMentions(userText, message);

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

        if (onCooldown(userId, config.replyCooldownMs)) {
            logger.info('discord', `Ignoring message from ${message.author.tag} (cooldown)`);
            return;
        }

        // After the cooldown check, so a message that's ignored doesn't cost a download.
        const inputImages = await collectImages([replyContext?.referenced, message]);
        const unreadable = unreadableImagesReply(inputImages);
        if (unreadable) {
            logger.warn('discord', `Not answering ${message.author.tag}: ${unreadable}`);
            await message
                .reply({ content: unreadable, allowedMentions: { repliedUser: false } })
                .catch((err) => logger.error('discord', 'Could not send the image notice', err));
            return;
        }
        const imageNote = describeImages(inputImages);
        const body = [resolvedText || '(no text — just the attachment)', imageNote]
            .filter(Boolean)
            .join('\n');
        const promptText = replyContext
            ? `[Replying to a message from ${replyContext.author}: "${replyContext.content}"]\n${body}`
            : body;

        const channelId = message.channel.id;
        const history = getHistory(channelId, userId);
        const speaker = describeUser(message.author, message.member);
        const progress = createMessageProgress(message);

        try {
            await whileTyping(message.channel, async () => {
                const outputs = createOutputs();
                const reply = await generateReply(history, promptText, {
                    userId,
                    guildId,
                    speaker,
                    images: inputImages.images,
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
                    // The images aren't kept, so an answer that depended on them can't be redone.
                    regenerate: inputImages.images.length === 0 ? { promptText, speaker } : null,
                });
            });
        } catch (err) {
            logger.error('discord', `Failed to answer ${message.author.tag}`, err);
            // Keep the question: otherwise "try again" has nothing to refer to and the
            // model goes back to the last question that DID get answered.
            rememberFailedQuestion({ userId, guildId, channelId, promptText });
            const notice =
                'Sorry, something went wrong answering that. Please try again in a moment.';
            const status = await progress.take().catch(() => null);
            // The status message, if there is one, becomes the apology rather than being left saying "working on it".
            await withRetry(() =>
                status ? status.edit({ content: notice, components: [] }) : message.reply(notice)
            ).catch((replyErr) => logger.error('discord', 'Could not send error reply', replyErr));
        }
    });
}

module.exports = { registerMessageHandler };
