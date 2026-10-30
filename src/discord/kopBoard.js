// The KOP8th ranking board: one message per region in the configured channel,
// each an image of the top players, edited in place whenever SEGA publishes a
// new update — the channel always shows the current ranking instead of
// filling up with copies of it. Which messages are the board, and the ranking
// they last showed (for the movement arrows), survive restarts in data/.
const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { REGIONS, fetchRanking, formatUpdate, withMovement } = require('../web/kopRanking');
const { buildKopHtml, WIDTH } = require('../render/kopCard');
const { renderHtmlToPng } = require('../render/browserRenderer');
const { fetchUsers } = require('../web/maimaiPlayers');
const { normalizeName } = require('../web/maimaiFriendLookup');

const STATE_PATH = path.resolve(__dirname, '../../data/kop-board.json');
const CHECK_EVERY_MS = 10 * 60 * 1000;

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch {
        return { regions: {} };
    }
}

function saveState(state) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/** Normalised names of the tracked account and its friends, to mark them on the board. */
async function ourNames() {
    try {
        return new Set((await fetchUsers()).map((u) => normalizeName(u.name)));
    } catch (err) {
        logger.warn(
            'kop',
            `Could not read the friend list, so no one is highlighted: ${err.message}`
        );
        return new Set();
    }
}

/** Sends the board message, or edits the one already there; returns its id. */
async function publish(channel, messageId, payload) {
    if (messageId) {
        const existing = await channel.messages.fetch(messageId).catch(() => null);
        if (existing) {
            await existing.edit({ ...payload, attachments: [] });
            return existing.id;
        }
    }
    const sent = await channel.send(payload);
    return sent.id;
}

async function refresh(channel, state) {
    const names = await ourNames();
    for (const region of REGIONS) {
        const saved = state.regions[region.key] || {};
        let latest;
        try {
            latest = await fetchRanking(region);
        } catch (err) {
            logger.warn('kop', `Could not fetch the ${region.label} ranking: ${err.message}`);
            continue;
        }
        if (latest.entries.length === 0) continue;
        if (saved.messageId && saved.update === latest.update) continue;

        // Movement is against the last update shown; a restart with the same update keeps the old arrows.
        const previous = saved.update === latest.update ? saved.previous : saved.entries;
        const entries = withMovement(latest.entries, previous);
        const ours = new Set(
            entries.filter((e) => names.has(normalizeName(e.name))).map((e) => e.rank)
        );
        const updated = formatUpdate(latest.update);

        let png;
        try {
            png = await renderHtmlToPng(
                buildKopHtml({ region: region.label, updated, entries, ours }),
                { width: WIDTH, scale: 1.5 }
            );
        } catch (err) {
            logger.warn('kop', `Could not draw the ${region.label} board: ${err.message}`);
            continue;
        }
        const leader = entries[0];
        const payload = {
            content: `**KOP8th maimai — ${region.label}** · updated ${updated} · #1 ${leader.name} (${leader.score.toLocaleString('en-US')}) · <${region.pageUrl}>`,
            files: [new AttachmentBuilder(png, { name: `kop8th-${region.key}.png` })],
            allowedMentions: { parse: [] },
        };
        try {
            const messageId = await publish(channel, saved.messageId, payload);
            state.regions[region.key] = {
                messageId,
                update: latest.update,
                entries: latest.entries,
                previous: saved.update === latest.update ? saved.previous : saved.entries || null,
            };
            saveState(state);
            logger.info('kop', `${region.label} board updated (${updated})`);
        } catch (err) {
            logger.warn('kop', `Could not post the ${region.label} board: ${err.message}`);
        }
    }
}

/** Starts keeping the board in `channelId` current. A missing channel just leaves it off. */
async function startKopBoard(client, channelId) {
    if (!channelId) return;
    let channel;
    try {
        channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) throw new Error('not a text channel');
    } catch (err) {
        logger.warn('kop', `KOP board channel ${channelId} unavailable: ${err.message}`);
        return;
    }
    const state = loadState();
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await refresh(channel, state);
        } catch (err) {
            logger.error('kop', 'KOP board refresh failed', err);
        } finally {
            running = false;
        }
    };
    await tick();
    setInterval(tick, CHECK_EVERY_MS).unref();
}

module.exports = { startKopBoard };
