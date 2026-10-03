const logger = require('../utils/logger');
const { getHistory, appendMessage } = require('../conversation/historyStore');
const { generateReply } = require('../ai/agent');
const { isOwner } = require('../permissions/permissionStore');
const { tryHandleAdminCommand } = require('./adminCommands');
const { nextAnswerBudget } = require('../ai/answerBudget');

const DISCORD_MESSAGE_LIMIT = 2000;
// Leaves room for a code fence this splitter may have to re-open on the next
// chunk (see splitForDiscord), so adding one can't push a chunk over the cap.
const CHUNK_LIMIT = DISCORD_MESSAGE_LIMIT - 16;
// A long answer is sent as consecutive messages rather than cut off, but not
// without limit — past this it stops and says so, instead of turning one
// question into a wall of the channel's scrollback.
const MAX_REPLY_MESSAGES = 5;
const REPLY_CONTEXT_MAX_LENGTH = 800;
const CONTINUE_EMOJI = '▶️';
const STOP_EMOJI = '⏹️';

/**
 * Answers that ran out of output budget before they were finished, waiting on
 * the asker to say what to do about it:
 *
 *   noticeMessageId -> { userId, answer, anchor, ctx }
 *
 * Nothing partial has been posted at this point. ▶️ spends the next budget
 * rung and posts the whole thing once it's done; ⏹️ posts what exists right
 * now, with no further API call. In memory on purpose — this is a per-message
 * affordance, and after a restart the asker can still just ask again. Capped
 * so a long-running process can't accumulate them forever.
 */
const pendingAnswers = new Map();
const MAX_PENDING = 200;

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

/** Strips a leading bot mention so it doesn't pollute the prompt sent to the model. */
function stripMention(content, clientUserId) {
    return content.replace(new RegExp(`^<@!?${clientUserId}>\\s*`), '').trim();
}

/**
 * Splits a reply into Discord-sized chunks, preferring line boundaries.
 *
 * This replaces a hard slice at 2000 chars with "...(truncated)" appended —
 * which silently dropped the tail of every long answer, so an answer that the
 * model had finished correctly still reached the channel incomplete. That was
 * the second half of the same complaint as the token cap: one lost the end of
 * the answer to the model's budget, this lost it to Discord's.
 *
 * A fenced code block spanning a split is closed on the way out and re-opened
 * (with its original language) on the way in, so neither half renders as
 * broken markdown.
 */
function splitForDiscord(text) {
    const chunks = [];
    let rest = text.trim();

    while (rest.length > CHUNK_LIMIT) {
        let cut = rest.lastIndexOf('\n', CHUNK_LIMIT);
        // No line break in the back half means one enormous line (a single
        // huge table row, say); splitting mid-line beats not splitting.
        if (cut < CHUNK_LIMIT / 2) cut = CHUNK_LIMIT;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n+/, '');
    }
    if (rest) chunks.push(rest);

    return balanceCodeFences(chunks);
}

/** Closes a code fence left open at the end of a chunk and re-opens it on the next. */
function balanceCodeFences(chunks) {
    const balanced = [];
    let reopen = null;

    for (const chunk of chunks) {
        let body = reopen ? `${reopen}\n${chunk}` : chunk;
        let open = null;
        for (const line of body.split('\n')) {
            if (!line.startsWith('```')) continue;
            open = open ? null : line.trimEnd();
        }
        if (open) {
            body += '\n```';
            reopen = open;
        } else {
            reopen = null;
        }
        balanced.push(body);
    }
    return balanced;
}

/**
 * Posts an answer, as consecutive messages when it doesn't fit in one.
 *
 * The first is a reply to the asker's message; the rest are plain sends so the
 * channel doesn't show five reply chips for one answer. If the anchor message
 * is gone (deleted while the answer was being written), it falls back to a
 * plain channel send rather than losing the answer.
 */
async function sendAnswer(anchor, text) {
    const chunks = splitForDiscord(text);
    const toSend = chunks.slice(0, MAX_REPLY_MESSAGES);

    for (const [index, chunk] of toSend.entries()) {
        if (index === 0) {
            const sent = await anchor
                .reply({ content: chunk, allowedMentions: { repliedUser: false } })
                .catch(() => null);
            if (sent) continue;
            await anchor.channel.send(chunk);
        } else {
            await anchor.channel.send(chunk);
        }
    }

    if (chunks.length > toSend.length) {
        await anchor.channel
            .send(
                `…that answer is longer than the ${MAX_REPLY_MESSAGES} messages I'll post at once — ` +
                    'ask for a narrower slice of it and I can give you the rest.'
            )
            .catch(() => {});
    }
}

/** The offer posted in place of a half-written answer. */
function notEnoughContextNotice(answer, nextBudget) {
    const written = answer.text
        ? `I have about ${answer.text.length} characters of it written.`
        : "I didn't get any of it written before running out.";

    if (!nextBudget) {
        return (
            `Not enough context to finish this request, and I'm already at the largest budget I'll ` +
            `spend on one answer. ${written}\n\nReact ${STOP_EMOJI} to get what I have.`
        );
    }
    return (
        `Not enough context to finish this request — I'd rather not send you half an answer. ${written}\n\n` +
        `React ${CONTINUE_EMOJI} and I'll finish it with more room (${nextBudget.toLocaleString()} tokens) ` +
        `and post the whole thing, or ${STOP_EMOJI} to get what I have right now.`
    );
}

function rememberPending(noticeId, entry) {
    if (pendingAnswers.size >= MAX_PENDING) {
        pendingAnswers.delete(pendingAnswers.keys().next().value); // drop the oldest
    }
    pendingAnswers.set(noticeId, entry);
}

/**
 * Delivers a finished answer, or offers more budget for an unfinished one.
 *
 * The history entry is written here rather than at generateReply time, so an
 * answer nobody chose to receive never ends up in the conversation as
 * something the bot said.
 */
async function deliverAnswer(anchor, answer, ctx) {
    if (answer.complete) {
        appendMessage({ ...ctx, role: 'assistant', content: answer.text });
        await sendAnswer(anchor, answer.text);
        return;
    }
    await offerMoreContext(anchor, answer, ctx);
}

/** Posts the "not enough context" offer and arms its two reactions. */
async function offerMoreContext(anchor, answer, ctx) {
    const next = nextAnswerBudget(answer.budget);
    const notice = await anchor
        .reply({
            content: notEnoughContextNotice(answer, next),
            allowedMentions: { repliedUser: false },
        })
        .catch(() => null);

    if (!notice) {
        // Couldn't even post the offer — don't lose the work silently.
        if (answer.text) await sendAnswer(anchor, answer.text);
        return;
    }

    try {
        if (next) await notice.react(CONTINUE_EMOJI);
        await notice.react(STOP_EMOJI);
        rememberPending(notice.id, { userId: ctx.userId, answer, anchor, ctx });
    } catch (err) {
        // Without Add Reactions the offer is a dead end, so fall back to
        // posting what exists rather than leaving the asker with a message
        // telling them to press something they can't press.
        logger.warn('discord', 'Could not arm the continue/stop reactions', err);
        await notice.edit(notEnoughContextNoticeFallback(answer)).catch(() => {});
        if (answer.text) {
            appendMessage({ ...ctx, role: 'assistant', content: answer.text });
            await sendAnswer(anchor, answer.text);
        }
    }
}

function notEnoughContextNoticeFallback(answer) {
    return answer.text
        ? "Not enough context to finish this request, and I can't add reactions here — " +
              'posting what I have instead. Ask me to continue in a message for the rest.'
        : "Not enough context to finish this request, and I couldn't get any of it written. " +
              'Try asking for a narrower slice of it.';
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

/** Keeps the typing indicator alive across work that outlasts its ~10s expiry. */
function keepTyping(channel) {
    channel.sendTyping().catch(() => {});
    return setInterval(() => channel.sendTyping().catch(() => {}), 8000);
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
        // Atri gave up until the reply suddenly appears.
        const typingInterval = keepTyping(message.channel);

        try {
            const answer = await generateReply(history, promptText, { userId, guildId });

            appendMessage({ userId, guildId, channelId, role: 'user', content: promptText });
            await deliverAnswer(message, answer, { userId, guildId, channelId });
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
 * Resolves an unfinished answer when the asker picks one of the two offers.
 *
 * ▶️ spends the next budget rung, continuing from the text already written
 * rather than starting over, and posts the whole answer once it's finished —
 * so the asker never sees a seam, and tokens already paid for aren't
 * re-generated. If even that budget runs out the offer is made again, one
 * rung higher, until the ceiling.
 *
 * ⏹️ posts what exists immediately, with no further API call.
 */
function registerReactionHandler(client, config) {
    client.on('messageReactionAdd', async (reaction, user) => {
        if (user.bot) return;
        // Only the asker may spend budget on their own answer — otherwise
        // anyone in the channel could run up someone else's bill.
        const pending = pendingAnswers.get(reaction.message.id);
        if (!pending || pending.userId !== user.id) return;

        try {
            if (reaction.partial) await reaction.fetch();
        } catch (err) {
            logger.warn('discord', 'Could not resolve a reaction', err);
            return;
        }
        const emoji = reaction.emoji.name;
        if (emoji !== CONTINUE_EMOJI && emoji !== STOP_EMOJI) return;

        // One resolution per offer: drop it first so a double-tap (or a
        // remove-and-re-add) can't pay for the same continuation twice.
        pendingAnswers.delete(reaction.message.id);

        const notice = reaction.message.partial
            ? await reaction.message.fetch().catch(() => null)
            : reaction.message;
        const { answer, anchor, ctx } = pending;

        if (emoji === STOP_EMOJI) {
            await notice?.delete().catch(() => {});
            if (!answer.text) return;
            appendMessage({ ...ctx, role: 'assistant', content: answer.text });
            await sendAnswer(anchor, answer.text);
            return;
        }

        const next = nextAnswerBudget(answer.budget);
        if (!next) {
            // Nothing left to offer — the notice already said so, and ⏹️ is
            // the only honest action, so leave it armed rather than spending.
            rememberPending(reaction.message.id, pending);
            return;
        }

        const typingInterval = keepTyping(anchor.channel);
        try {
            await notice
                ?.edit(`Picking that back up with ${next.toLocaleString()} tokens of room…`)
                .catch(() => {});

            const finished = await answer.resume(next);
            await notice?.delete().catch(() => {});
            await deliverAnswer(anchor, finished, ctx);
        } catch (err) {
            logger.error('discord', `Failed to finish an answer for ${user.tag}`, err);
            await notice
                ?.edit(
                    "I couldn't finish that answer — ask me again, or ask for a narrower slice of it."
                )
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
