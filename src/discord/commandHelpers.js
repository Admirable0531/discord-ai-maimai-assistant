// Shared pieces of the slash commands that call the same tools the chat path
// does (see src/tools): the scope check, attachments, a cooldown for the
// commands that run a browser, and friend-name autocomplete.
const { MessageFlags, AttachmentBuilder } = require('discord.js');
const { hasScope } = require('../permissions/permissionStore');
const { fetchUsers, TRACKED_ID } = require('../web/maimaiPlayers');
const { normalizeName } = require('../web/maimaiFriendLookup');

const MAX_REPLY = 1900;
const HEAVY_COOLDOWN_MS = 10_000;
const USERS_CACHE_MS = 60_000;
const lastHeavyRunByUser = new Map();

/** If the user lacks `scope`, answers privately and returns true. Call before deferring. */
async function denyWithoutScope(interaction, scope, what) {
    if (hasScope(interaction.user.id, interaction.guildId, scope)) return false;
    await interaction.reply({
        content: `You don't have access to ${what}. Only the bot owner can grant it.`,
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

/**
 * Commands that render an image share two browser slots, so one person
 * mashing a command shouldn't queue up everyone else's. Answers privately and
 * returns true when this user ran one too recently.
 */
async function tooSoon(interaction) {
    const last = lastHeavyRunByUser.get(interaction.user.id) || 0;
    const wait = HEAVY_COOLDOWN_MS - (Date.now() - last);
    if (wait > 0) {
        await interaction.reply({
            content: `Slow down — try again in ${Math.ceil(wait / 1000)}s.`,
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    lastHeavyRunByUser.set(interaction.user.id, Date.now());
    return false;
}

function toAttachments(files) {
    return files.map((f) => new AttachmentBuilder(f.data, { name: f.name }));
}

/** A tool's failure as a reply: its message, plus the candidates when a name matched several. */
function describeFailure(result) {
    const matches = Array.isArray(result.matches)
        ? `\nDid you mean: ${result.matches.join(', ')}`
        : '';
    return `${result.error || 'Something went wrong.'}${matches}`.slice(0, MAX_REPLY);
}

let usersCache = null; // { names, expiresAt }

async function friendNames() {
    if (usersCache && Date.now() < usersCache.expiresAt) return usersCache.names;
    const users = await fetchUsers();
    const names = users.filter((u) => u.user !== TRACKED_ID && u.name).map((u) => u.name);
    usersCache = { names, expiresAt: Date.now() + USERS_CACHE_MS };
    return names;
}

/**
 * Autocomplete for a "player" option. Friend names are what the leaderboard
 * scope protects, so someone without it gets no suggestions. Never throws:
 * an autocomplete that errors just shows nothing.
 */
async function suggestPlayers(interaction) {
    try {
        if (!hasScope(interaction.user.id, interaction.guildId, 'leaderboard')) {
            await interaction.respond([]);
            return;
        }
        const typed = normalizeName(interaction.options.getFocused());
        const names = (await friendNames())
            .filter((name) => normalizeName(name).includes(typed))
            .slice(0, 25);
        await interaction.respond(
            names.map((name) => ({ name: name.slice(0, 100), value: name.slice(0, 100) }))
        );
    } catch {
        await interaction.respond([]).catch(() => {});
    }
}

module.exports = {
    denyWithoutScope,
    tooSoon,
    toAttachments,
    describeFailure,
    suggestPlayers,
    MAX_REPLY,
};
