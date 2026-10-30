// The KOP8th ranking board: for each region, the whole top 100 as two images
// (1–50 and 51–100, one message each — a single 100-row image is too tall to
// read in Discord) in the configured channel, edited in place whenever SEGA
// publishes a new update, so the channel always shows the current ranking
// instead of filling up with copies of it. Which messages are the board, and
// the ranking they last showed (for the movement arrows), survive restarts in
// data/kop-board.json; every update SEGA publishes is also kept, in full, in
// data/kop-history/<region>.jsonl.
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
const HISTORY_DIR = path.resolve(__dirname, '../../data/kop-history');
const PART_SIZE = 50;
const PARTS = [0, PART_SIZE];
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

/** Appends one published update, all of it, to the region's history file. */
function recordHistory(regionKey, update, entries) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.appendFileSync(
        path.join(HISTORY_DIR, `${regionKey}.jsonl`),
        JSON.stringify({ update, fetchedAt: new Date().toISOString(), entries }) + '\n'
    );
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
        if (saved.historyUpdate !== latest.update) {
            try {
                recordHistory(region.key, latest.update, latest.entries);
                saved.historyUpdate = latest.update;
                state.regions[region.key] = saved;
                saveState(state);
            } catch (err) {
                logger.warn('kop', `Could not save the ${region.label} history: ${err.message}`);
            }
        }
        const posted = Array.isArray(saved.messageIds) && saved.messageIds.length === PARTS.length;
        if (posted && saved.update === latest.update) continue;

        // Movement is against the last update shown; a restart with the same update keeps the old arrows.
        const previous = saved.update === latest.update ? saved.previous : saved.entries;
        const entries = withMovement(latest.entries, previous);
        const ours = new Set(
            entries.filter((e) => names.has(normalizeName(e.name))).map((e) => e.rank)
        );
        const updated = formatUpdate(latest.update);

        const leader = entries[0];
        const messageIds = [];
        try {
            for (const [i, from] of PARTS.entries()) {
                const png = await renderHtmlToPng(
                    buildKopHtml({
                        region: region.label,
                        updated,
                        entries,
                        ours,
                        from,
                        maxRows: PART_SIZE,
                        oursBelow: false,
                    }),
                    { width: WIDTH, scale: 1.5 }
                );
                const content =
                    i === 0
                        ? `**KOP8th maimai — ${region.label}** · updated ${updated} · #1 ${leader.name} (${leader.score.toLocaleString('en-US')}) · <${region.pageUrl}>`
                        : `**KOP8th maimai — ${region.label}** · ranks ${from + 1}–${from + PART_SIZE}`;
                messageIds.push(
                    await publish(channel, saved.messageIds?.[i], {
                        content,
                        files: [
                            new AttachmentBuilder(png, {
                                name: `kop8th-${region.key}-${i + 1}.png`,
                            }),
                        ],
                        allowedMentions: { parse: [] },
                    })
                );
            }
        } catch (err) {
            logger.warn('kop', `Could not post the ${region.label} board: ${err.message}`);
            // Keep the ids of any part already posted, so the next try edits it rather than posting another.
            saved.messageIds = [
                ...messageIds,
                ...(saved.messageIds || []).slice(messageIds.length),
            ];
            state.regions[region.key] = saved;
            saveState(state);
            continue;
        }
        state.regions[region.key] = {
            messageIds,
            update: latest.update,
            historyUpdate: saved.historyUpdate,
            entries: latest.entries,
            previous: saved.update === latest.update ? saved.previous : saved.entries || null,
        };
        saveState(state);
        logger.info('kop', `${region.label} board updated (${updated})`);
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
    // The first version posted one message per region; replace those with the
    // two-part boards, posted afresh so the four stay in order.
    for (const saved of Object.values(state.regions)) {
        if (!saved.messageId) continue;
        const old = await channel.messages.fetch(saved.messageId).catch(() => null);
        if (old) await old.delete().catch(() => {});
        delete saved.messageId;
    }
    saveState(state);
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
