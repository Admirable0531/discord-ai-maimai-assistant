// Atri in a voice channel: listens to the people who opted in with /voice
// join, cuts their speech into utterances at each pause, transcribes them,
// and answers the ones that start with "hey Atri" in the voice channel's own
// text chat — the same agent, tools and permissions as a typed question.
// Nobody else in the channel is recorded, and clips are never stored.
const {
    joinVoiceChannel,
    entersState,
    VoiceConnectionStatus,
    EndBehaviorType,
} = require('@discordjs/voice');
const prism = require('prism-media');
const logger = require('../utils/logger');
const { config } = require('../config/env');
const { generateReply } = require('../ai/agent');
const { isTruncated, stripTruncationMarker } = require('../ai/truncation');
const { getHistory, appendMessage } = require('../conversation/historyStore');
const { createOutputs } = require('../utils/outputs');
const { splitForDiscord, balanceCodeFences } = require('../discord/replyDelivery');
const { toAttachments } = require('../discord/commandHelpers');
const { whileTyping } = require('../discord/typing');
const { describeUser } = require('../discord/speaker');
const { downsampleToMono16k, durationSeconds, rmsLevel, toWav } = require('./wav');
const { parseWakePhrase, tidyTranscript } = require('./wakeWord');
const { transcribe } = require('./transcribe');

const MIN_CLIP_SECONDS = 0.5;
const MAX_CLIP_SECONDS = 30;
const MAX_CLIP_BYTES = MAX_CLIP_SECONDS * 48000 * 4;
// Quieter than this is breathing, a keyboard or a fan, not someone talking.
const MIN_LEVEL = 0.01;
// After a bare "hey Atri", the next thing they say within this long is the request.
const WAKE_FOLLOW_UP_MS = 10_000;

const VOICE_NOTE =
    '[Said aloud in voice chat and transcribed automatically, so words — song titles especially — ' +
    'may be misheard; if a title looks wrong, search for what it sounds like. Your reply is posted ' +
    "in the voice channel's text chat.]";

/** guildId -> session */
const sessions = new Map();

function getSession(guildId) {
    return sessions.get(guildId) || null;
}

function resetIdleTimer(session) {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
        logger.info('voice', `Leaving ${session.channel.name}: idle`);
        leave(session.guildId);
    }, config.voice.idleTimeoutMs);
}

/**
 * Joins `channel` (or reuses the session already there) and starts
 * listening to `member`. Returns { ok, error?, joined? }.
 */
async function join(channel, member) {
    const guildId = channel.guild.id;
    const existing = sessions.get(guildId);
    if (existing && existing.channel.id !== channel.id) {
        return { ok: false, error: `I'm already in ${existing.channel.name} on this server.` };
    }
    if (existing) {
        existing.listeners.add(member.id);
        resetIdleTimer(existing);
        return { ok: true, joined: false };
    }

    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
    });
    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
        connection.destroy();
        logger.warn('voice', `Could not connect to ${channel.name}`, err);
        return { ok: false, error: "I couldn't connect to that voice channel." };
    }

    const session = {
        guildId,
        channel,
        connection,
        listeners: new Set([member.id]),
        capturing: new Set(),
        busy: new Set(),
        awaitingRequest: new Map(),
        idleTimer: null,
    };
    sessions.set(guildId, session);
    resetIdleTimer(session);

    connection.receiver.speaking.on('start', (userId) => {
        if (session.listeners.has(userId) && !session.capturing.has(userId)) {
            capture(session, userId);
        }
    });

    // A region move or a brief network drop shows up as Disconnected; give it a moment to
    // reconnect by itself before giving up (the pattern @discordjs/voice recommends).
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
        } catch {
            leave(guildId);
        }
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => {
        if (sessions.get(guildId) === session) cleanup(session);
    });
    connection.on('error', (err) => logger.warn('voice', 'Voice connection error', err));

    logger.info('voice', `Joined ${channel.name} in ${channel.guild.name}`);
    return { ok: true, joined: true };
}

function cleanup(session) {
    clearTimeout(session.idleTimer);
    sessions.delete(session.guildId);
}

/** Leaves the guild's voice channel. Returns whether there was one to leave. */
function leave(guildId) {
    const session = sessions.get(guildId);
    if (!session) return false;
    cleanup(session);
    try {
        session.connection.destroy();
    } catch {
        // Already destroyed.
    }
    logger.info('voice', `Left ${session.channel.name}`);
    return true;
}

/** Stops listening to one person; leaves when nobody is left to listen to. */
function stopListening(guildId, userId) {
    const session = sessions.get(guildId);
    if (!session) return;
    session.listeners.delete(userId);
    session.awaitingRequest.delete(userId);
    if (session.listeners.size === 0) leave(guildId);
}

/** Records one utterance from `userId` — until they pause — and hands it on. */
function capture(session, userId) {
    session.capturing.add(userId);
    const opus = session.connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: config.voice.silenceMs },
    });
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    const chunks = [];
    let bytes = 0;
    let finished = false;

    const finish = () => {
        if (finished) return;
        finished = true;
        session.capturing.delete(userId);
        opus.destroy();
        const pcm = Buffer.concat(chunks);
        handleUtterance(session, userId, pcm).catch((err) =>
            logger.error('voice', 'Failed to handle a voice request', err)
        );
    };

    decoder.on('data', (chunk) => {
        if (bytes >= MAX_CLIP_BYTES) return;
        chunks.push(chunk);
        bytes += chunk.length;
        // Someone talking without a pause for this long isn't making a request; cut it here.
        if (bytes >= MAX_CLIP_BYTES) finish();
    });
    decoder.on('end', finish);
    decoder.on('error', (err) => {
        logger.warn('voice', 'Could not decode voice audio', err);
        finish();
    });
    opus.on('error', (err) => {
        logger.warn('voice', 'Voice receive stream error', err);
        finish();
    });
    opus.pipe(decoder);
}

async function handleUtterance(session, userId, pcm) {
    if (!sessions.has(session.guildId) || !session.listeners.has(userId)) return;
    if (durationSeconds(pcm) < MIN_CLIP_SECONDS) return;
    const mono = downsampleToMono16k(pcm);
    if (rmsLevel(mono) < MIN_LEVEL) return;

    const transcript = tidyTranscript(await transcribe(toWav(mono)));
    if (!transcript) return;

    let request = parseWakePhrase(transcript);
    const awaitingSince = session.awaitingRequest.get(userId);
    if (request === null && awaitingSince && Date.now() - awaitingSince < WAKE_FOLLOW_UP_MS) {
        request = transcript;
    }
    if (request === null) return;
    if (request === '') {
        session.awaitingRequest.set(userId, Date.now());
        return;
    }
    session.awaitingRequest.delete(userId);

    if (session.busy.has(userId)) {
        logger.info(
            'voice',
            `Ignoring a voice request from ${userId}: still answering the last one`
        );
        return;
    }
    session.busy.add(userId);
    resetIdleTimer(session);
    try {
        await answer(session, userId, request);
    } finally {
        session.busy.delete(userId);
    }
}

async function answer(session, userId, request) {
    const { channel, guildId } = session;
    const member = await channel.guild.members.fetch(userId).catch(() => null);
    const name = member?.displayName || 'someone';
    const promptText = `${VOICE_NOTE}\n${request}`;
    const channelId = channel.id;
    const heard = `> 🎙️ **${name}:** ${request.replace(/\n/g, ' ')}`;
    logger.info('voice', `Voice request from ${name}: ${request}`);

    try {
        await whileTyping(channel, async () => {
            const outputs = createOutputs();
            const reply = await generateReply(getHistory(channelId, userId), promptText, {
                userId,
                guildId,
                speaker: member ? describeUser(member.user, member) : undefined,
                outputs,
            });
            appendMessage({ userId, guildId, channelId, role: 'user', content: promptText });
            appendMessage({ userId, guildId, channelId, role: 'assistant', content: reply });

            const text = isTruncated(reply) ? stripTruncationMarker(reply) : reply;
            const chunks = splitForDiscord(balanceCodeFences(text));
            await channel.send({
                content: `${heard}\n${chunks[0] || ''}`.slice(0, 2000),
                files: toAttachments(outputs.files),
                allowedMentions: { parse: [] },
            });
            for (let i = 1; i < chunks.length; i++) {
                await channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
            }
        });
    } catch (err) {
        logger.error('voice', `Failed to answer a voice request from ${name}`, err);
        await channel
            .send({
                content: `${heard}\nSorry, something went wrong answering that.`,
                allowedMentions: { parse: [] },
            })
            .catch(() => {});
    }
}

/** Stops listening to people who leave the bot's channel, and tidies up if the bot itself is moved or kicked. */
function registerVoiceStateHandler(client) {
    client.on('voiceStateUpdate', (oldState, newState) => {
        const session = sessions.get(newState.guild.id);
        if (!session) return;
        if (newState.id === client.user.id) {
            if (!newState.channelId) leave(session.guildId);
            else if (newState.channelId !== session.channel.id && newState.channel) {
                session.channel = newState.channel;
            }
            return;
        }
        const left =
            oldState.channelId === session.channel.id && newState.channelId !== session.channel.id;
        if (left && session.listeners.has(newState.id)) stopListening(session.guildId, newState.id);
    });
}

module.exports = { join, leave, stopListening, getSession, registerVoiceStateHandler };
