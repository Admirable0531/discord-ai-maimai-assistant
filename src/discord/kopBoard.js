// The KOP8th ranking board: every time SEGA publishes an update (once a day
// per region — International at 02:00 JST, Japan at 07:00 JST), a fresh post
// in the configured channel with the whole top 100 and an improvers report,
// styled like the daily circle rankings (see kopEmbeds.js). The ranking last
// posted and the one before it (for the changes) survive restarts in
// data/kop-board.json; every update is also kept, in full, in
// data/kop-history/<region>.jsonl.
const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');
const { REGIONS, fetchRanking, formatUpdate, withMovement } = require('../web/kopRanking');
const { kopEmbeds, packMessages } = require('./kopEmbeds');
const { fetchUsers } = require('../web/maimaiPlayers');
const { normalizeName } = require('../web/maimaiFriendLookup');

const STATE_PATH = path.resolve(__dirname, '../../data/kop-board.json');
const HISTORY_DIR = path.resolve(__dirname, '../../data/kop-history');
const CHECK_EVERY_MS = 10 * 60 * 1000;
// Bump when the post's layout changes, so the current update is posted again in the new style.
const FORMAT = 3;

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
        if (saved.update === latest.update && saved.format === FORMAT) continue;

        // A new update is compared with the last one posted; the same update posted again
        // (after a layout change) keeps its original comparison.
        const previous = saved.update === latest.update ? saved.previous : saved.entries;
        const entries = withMovement(latest.entries, previous);
        const ours = new Set(
            entries.filter((e) => names.has(normalizeName(e.name))).map((e) => e.rank)
        );
        const updated = formatUpdate(latest.update);
        const embeds = kopEmbeds({ region, updated, entries, previous, ours });
        try {
            for (const group of packMessages(embeds)) {
                await channel.send({ embeds: group, allowedMentions: { parse: [] } });
            }
        } catch (err) {
            logger.warn('kop', `Could not post the ${region.label} board: ${err.message}`);
            continue;
        }
        state.regions[region.key] = {
            format: FORMAT,
            update: latest.update,
            historyUpdate: saved.historyUpdate,
            entries: latest.entries,
            previous: previous || null,
        };
        saveState(state);
        logger.info('kop', `${region.label} board posted (${updated})`);
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
    // Earlier versions kept one board and edited it; that board shows the same
    // update this post will, so remove it rather than leave a copy above the new post.
    for (const saved of Object.values(state.regions)) {
        for (const id of [saved.messageId, ...(saved.messageIds || [])].filter(Boolean)) {
            const old = await channel.messages.fetch(id).catch(() => null);
            if (old) await old.delete().catch(() => {});
        }
        delete saved.messageId;
        delete saved.messageIds;
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
