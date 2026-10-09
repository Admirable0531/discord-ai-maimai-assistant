// Who a "player" is for the tools that draw cards: either the tracked account
// (the owner's own — id 'ryan' in maimaiscrape's API) or one of its friends,
// found by name the same forgiving way the other friend tools do.
const { normalizeName } = require('./maimaiFriendLookup');
const { config } = require('../config/env');

const API_URL = config.tools.maimaiApiUrl;
const TIMEOUT_MS = 15000;
const TRACKED_ID = 'ryan';

/** Asked-for names that mean the tracked account rather than a friend. */
const TRACKED_WORDS = new Set(['', 'me', 'my', 'myself', 'self', 'tracked', 'owner', 'main']);

async function fetchUsers() {
    const response = await fetch(`${API_URL}/users`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status} from /users`);
    return response.json();
}

/**
 * Resolves `name` to { player: {id, name, isTracked} }, or { error, matches? }
 * when there's no such friend or several. No name means the tracked account.
 */
async function findPlayer(name) {
    const asked = typeof name === 'string' ? name.trim() : '';
    const users = await fetchUsers();

    if (TRACKED_WORDS.has(asked.toLowerCase())) {
        const self = users.find((u) => u.user === TRACKED_ID);
        return {
            player: { id: TRACKED_ID, name: self?.name || 'Tracked account', isTracked: true },
        };
    }

    const target = normalizeName(asked);
    const friends = users.filter((u) => u.user !== TRACKED_ID && u.name);
    const exact = friends.find((u) => normalizeName(u.name) === target);
    const partial = friends.filter((u) => normalizeName(u.name).includes(target));
    const found = exact || (partial.length === 1 ? partial[0] : null);
    if (found) return { player: { id: found.user, name: found.name, isTracked: false } };
    if (partial.length > 1) {
        return {
            error: `Multiple friends match "${asked}" — be more specific.`,
            matches: partial.map((u) => u.name),
        };
    }
    return { error: `No friend matching "${asked}" found on this account's friend list.` };
}

module.exports = { findPlayer, fetchUsers, TRACKED_ID, API_URL, TIMEOUT_MS };
