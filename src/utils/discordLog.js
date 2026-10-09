// Mirrors Atri's warnings and errors to a Discord channel (LOG_CHANNEL_ID),
// so a failing provider or tool is visible the day it happens rather than
// only in `docker compose logs`. Same channel and format as maimaiscrape's
// bot. Info lines aren't sent: every tool call logs one, which would bury
// the warnings this exists for.
const logger = require('./logger');

const FLUSH_MS = 5000;
const MAX_MESSAGE = 1900; // under Discord's 2000, leaving room for the code fence
const MAX_QUEUED_CHARS = 20000; // a runaway loop drops lines instead of flooding

let channel = null;
let queue = [];
let queuedChars = 0;
let dropped = 0;
let timer = null;
let sending = false;

function enqueue(level, text) {
    const line = `[${level}] ${text}`;
    if (queuedChars + line.length > MAX_QUEUED_CHARS) {
        dropped++;
        return;
    }
    queue.push(line);
    queuedChars += line.length;
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Packs queued lines into as few code-block messages as fit. */
function takeMessages() {
    const lines = queue;
    queue = [];
    queuedChars = 0;
    if (dropped) {
        lines.push(`[log] ${dropped} more line(s) dropped — see docker compose logs ai-bot`);
        dropped = 0;
    }
    const messages = [];
    let current = '';
    for (let line of lines) {
        if (line.length > MAX_MESSAGE) line = `${line.slice(0, MAX_MESSAGE - 1)}…`;
        if (current && current.length + line.length + 1 > MAX_MESSAGE) {
            messages.push(current);
            current = '';
        }
        current += (current ? '\n' : '') + line;
    }
    if (current) messages.push(current);
    return messages;
}

async function flush() {
    timer = null;
    if (sending || !channel || queue.length === 0) return;
    sending = true;
    try {
        for (const text of takeMessages()) {
            // ``` inside a log line would close the fence early.
            await channel.send('```\n' + text.replace(/```/g, "'''") + '\n```');
        }
    } catch (err) {
        // Straight to the console: logging this through the logger would queue
        // the failure to send and retry it forever.
        console.error('[discordLog] could not post to the log channel:', err.message);
    } finally {
        sending = false;
        if (queue.length && !timer) timer = setTimeout(flush, FLUSH_MS);
    }
}

/** Starts mirroring once the client is ready. A missing or unreachable channel just leaves it off. */
async function startDiscordLog(client, channelId) {
    if (!channelId) return;
    try {
        const fetched = await client.channels.fetch(channelId);
        if (!fetched?.isTextBased()) throw new Error('not a text channel');
        channel = fetched;
    } catch (err) {
        logger.warn(
            'bot',
            `Log channel ${channelId} unavailable (${err.message}) — warnings stay in the console only`
        );
        return;
    }
    logger.addSink(enqueue);
    logger.info('bot', `Mirroring warnings and errors to #${channel.name}`);
}

module.exports = { startDiscordLog, flush };
