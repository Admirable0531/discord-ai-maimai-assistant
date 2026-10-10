// Getting a finished reply onto Discord: splitting it across the 2000-character
// limit, attaching the files tools drew, editing it into the "working on it"
// message when there is one, and putting the buttons under it. A reply that hit
// the output-token cap is held back and offered as ▶️ Continue / ⏹️ Stop instead
// (see sendReply); buttonHandlers (replyButtons.js) acts on those choices.
const logger = require('../utils/logger');
const { isTruncated, stripTruncationMarker } = require('../ai/truncation');
const { continueRow, answerRow } = require('./replyComponents');

const DISCORD_MESSAGE_LIMIT = 2000;
const NOT_ENOUGH_CONTEXT_NOTICE =
    "Not enough context budget to finish this in one go. Press ▶️ Continue and I'll keep going, " +
    "or ⏹️ Stop here to send what I've got so far.";

/**
 * Notices offering to pick up a reply that stopped at the output-token limit:
 * botMessageId -> { userId, channelId, guildId, accumulated }.
 * `accumulated` is everything generated so far with the cut-off marker
 * stripped, kept off Discord until the answer is either finished (▶️) or
 * the asker settles for what's there (⏹️). In memory on purpose — this is a
 * convenience affordance, and after a restart the user can still just ask
 * again. Capped so a long-running process can't accumulate them forever.
 */
const continuable = new Map();

/**
 * Finished answers that can be asked again: botMessageId -> { userId,
 * channelId, guildId, promptText, speaker, reply }. Same trade-offs as above.
 */
const regenerable = new Map();

const MAX_REMEMBERED = 200;

function remember(map, messageId, state) {
    if (map.size >= MAX_REMEMBERED) map.delete(map.keys().next().value); // drop the oldest
    map.set(messageId, state);
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

/**
 * Fixes an unbalanced ``` in model text, which Discord shows as a broken block.
 * A stray fence that ends the message is dropped; an unclosed block that runs to
 * the end is closed. Balanced text — including a reply that ends in a finished
 * code block — is returned unchanged.
 */
function balanceCodeFences(text) {
    if (((text.match(/```/g) || []).length & 1) === 0) return text;
    const trimmed = text.trimEnd();
    return trimmed.endsWith('```') ? trimmed.slice(0, -3).trimEnd() : `${text}\n\`\`\``;
}

/** discord.js attachment objects for files a tool produced (see utils/outputs.js). */
function toDiscordFiles(files) {
    return files.map((f) => ({ attachment: f.data, name: f.name }));
}

// Discord error codes for "can't upload this": missing Attach Files permission,
// and the file being over the upload limit.
const FILE_REFUSED_CODES = new Set([50013, 40005]);
const FILES_REFUSED_NOTE =
    "\n\n_(I couldn't attach the image — I may be missing the Attach Files permission here.)_";

/**
 * Sends (possibly long) text as one or more messages, replying with the first
 * (which carries any files). Empty text would otherwise split into zero
 * chunks and send nothing at all, which reaches the user as silence rather
 * than as an error — unless there are files to send, which is a reply on its
 * own. If Discord refuses the files, the text still goes out, with a note.
 *
 * `components` (button rows) go on the last message. `statusMessage`, the
 * "working on it" reply (see progress.js), is edited into the first message
 * instead of posting a new one; if it was deleted meanwhile, a normal reply
 * is sent. Returns the last message sent.
 */
async function sendChunked(message, text, files = [], { components, statusMessage } = {}) {
    const chunks = splitForDiscord(balanceCodeFences(text));
    if (chunks.length === 0 && files.length === 0) {
        logger.warn('discord', 'Refusing to send an empty reply — nothing to say');
        if (statusMessage) await statusMessage.delete().catch(() => {});
        return null;
    }
    const replyOptions = { allowedMentions: { repliedUser: false } };
    const attachments = toDiscordFiles(files);
    let status = statusMessage || null;

    // The first message: edited into the status message when there is one.
    async function deliverFirst(payload) {
        if (status) {
            try {
                return await status.edit({ ...payload, content: payload.content || '' });
            } catch (err) {
                if (FILE_REFUSED_CODES.has(err.code)) throw err;
                logger.warn('discord', 'Could not edit the status message — replying instead', err);
                status = null;
            }
        }
        return message.reply({ ...replyOptions, ...payload });
    }

    async function replyFirst(content, rows) {
        const payload = {
            ...(content ? { content } : {}),
            ...(attachments.length ? { files: attachments } : {}),
            ...(rows ? { components: rows } : status ? { components: [] } : {}),
        };
        try {
            return await deliverFirst(payload);
        } catch (err) {
            if (!attachments.length || !FILE_REFUSED_CODES.has(err.code)) throw err;
            logger.warn(
                'discord',
                'Discord refused the attachment — sending the text without it',
                err
            );
            return deliverFirst({
                content: ((content || '') + FILES_REFUSED_NOTE)
                    .trim()
                    .slice(0, DISCORD_MESSAGE_LIMIT),
                ...(rows ? { components: rows } : status ? { components: [] } : {}),
            });
        }
    }

    const lastIndex = chunks.length - 1;
    let sent = await replyFirst(chunks[0], lastIndex <= 0 ? components : undefined);
    for (let i = 1; i < chunks.length; i++) {
        sent = await message.channel.send({
            content: chunks[i],
            ...(i === lastIndex && components ? { components } : {}),
        });
    }
    return sent;
}

/**
 * Delivers a reply. A finished answer (this reply plus anything accumulated
 * from earlier cut-off segments) goes straight to Discord in full, however
 * many messages that takes — never trimmed — with 👍/👎 (and 🔄 when it can be
 * asked again, i.e. `regenerate` is given) under it. A reply that hit the
 * output-token cap is NOT sent as-is: showing half a table and calling it done
 * is exactly what this is trying to avoid. Instead its (marker-stripped) text
 * is folded into the hidden `accumulated` stash, and a short notice goes out
 * offering ▶️ Continue or ⏹️ Stop here. Only that notice gets buttons — a
 * finished answer needs neither.
 *
 * `regenerate`: { promptText, speaker } — what it takes to ask the same
 * question again. Left out for replies it would not reproduce (a
 * continuation, or a question with images).
 */
async function sendReply(
    message,
    reply,
    { userId, channelId, guildId, accumulated = '', files = [], statusMessage, regenerate = null }
) {
    if (!isTruncated(reply)) {
        const text = accumulated + reply;
        const sent = await sendChunked(message, text, files, {
            components: [answerRow({ canRegenerate: Boolean(regenerate) })],
            statusMessage,
        });
        if (sent && regenerate) {
            remember(regenerable, sent.id, {
                userId,
                channelId,
                guildId,
                promptText: regenerate.promptText,
                speaker: regenerate.speaker,
                reply,
            });
        }
        return sent;
    }

    const nextAccumulated = accumulated + stripTruncationMarker(reply) + '\n\n';
    // Any image goes out with the notice: it would otherwise wait on a
    // continuation that rebuilds the text from scratch and has no file.
    const notice = await sendChunked(message, NOT_ENOUGH_CONTEXT_NOTICE, files, {
        components: [continueRow()],
        statusMessage,
    });
    if (notice) {
        remember(continuable, notice.id, {
            userId,
            channelId,
            guildId,
            accumulated: nextAccumulated,
        });
    } else {
        // Nothing to press — send what's ready instead of stranding it.
        await sendChunked(message, nextAccumulated.trim());
    }
    return notice;
}

module.exports = {
    sendChunked,
    sendReply,
    splitForDiscord,
    balanceCodeFences,
    continuable,
    regenerable,
    DISCORD_MESSAGE_LIMIT,
};
