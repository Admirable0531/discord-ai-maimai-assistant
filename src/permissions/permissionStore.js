const fs = require('fs');
const path = require('path');
const { and, eq } = require('drizzle-orm');
const logger = require('../utils/logger');
const { config } = require('../config/env');
const { getDb } = require('../database/client');
const { permissionGrants } = require('../database/schema');
const { sqliteTimestamp } = require('../database/timestamp');

/**
 * The tool categories access can be scoped to (see toolDefinitions.js's
 * TOOL_SCOPES for which tool needs which). Fixed and small on purpose —
 * per-individual-tool scoping would be finer-grained but harder for an
 * owner to reason about when granting access ("web" vs "read_webpage vs
 * search_web vs list_maimai_fandom_wiki_pages vs...").
 */
const VALID_SCOPES = ['web', 'account', 'leaderboard', 'memory', 'knowledge'];

/**
 * 'memory' is baseline, not granted: each user's memories are stored and
 * read strictly under their own userId, so letting everyone remember things
 * about themselves exposes nothing of anyone else's. Gating it meant only
 * the owner ever had a single memory saved, and the bot could not tell
 * anyone else apart from one conversation to the next.
 */
const BASELINE_SCOPES = ['web', 'memory'];

/**
 * Grants live in the permission_grants table: one row per user or server,
 * with scopes as a JSON array, or NULL for full access. OWNER_USER_ID is
 * always allowed and isn't stored. A user has at most one grant — granting
 * scoped access to someone with full access downgrades them (see allowUser),
 * since "full but also limited" isn't meaningful.
 *
 * A server grant applies to every member of that server at once; a member's
 * actual access is the UNION of their personal grant (if any) and their
 * server's grant (see getAllowedScopes), so a server-wide "web" grant plus
 * one member's personal "leaderboard" grant gives that member both.
 *
 * These used to live in data/permissions.json, a stopgap from before SQLite;
 * importLegacyJson() moves any such file into the table once.
 */
const LEGACY_JSON_PATH = path.resolve(__dirname, '../../data/permissions.json');

/** Full access -> 'all', otherwise the granted scope array; null when there's no grant. */
function readGrant(subjectType, subjectId) {
    if (!subjectId) return null;
    const row = getDb()
        .select()
        .from(permissionGrants)
        .where(
            and(
                eq(permissionGrants.subjectType, subjectType),
                eq(permissionGrants.subjectId, subjectId)
            )
        )
        .get();
    if (!row) return null;
    return row.scopes === null ? 'all' : JSON.parse(row.scopes);
}

/** Upserts a grant (scopes null = full access). Returns true if there was no grant before. */
function writeGrant(subjectType, subjectId, scopes) {
    const isNew = readGrant(subjectType, subjectId) === null;
    const value = scopes === null ? null : JSON.stringify(scopes);
    getDb()
        .insert(permissionGrants)
        .values({ subjectType, subjectId, scopes: value })
        .onConflictDoUpdate({
            target: [permissionGrants.subjectType, permissionGrants.subjectId],
            set: { scopes: value, updatedAt: sqliteTimestamp() },
        })
        .run();
    return isNew;
}

/** Returns true if a grant was removed. */
function deleteGrant(subjectType, subjectId) {
    const result = getDb()
        .delete(permissionGrants)
        .where(
            and(
                eq(permissionGrants.subjectType, subjectType),
                eq(permissionGrants.subjectId, subjectId)
            )
        )
        .run();
    return result.changes > 0;
}

function listGrants(subjectType) {
    return getDb()
        .select()
        .from(permissionGrants)
        .where(eq(permissionGrants.subjectType, subjectType))
        .all()
        .map((row) => ({
            id: row.subjectId,
            scopes: row.scopes === null ? null : JSON.parse(row.scopes),
        }));
}

/**
 * Moves data/permissions.json into the table, once: grants already in the
 * table win, and the file is renamed so it isn't imported again (or mistaken
 * for the live store).
 */
function importLegacyJson() {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(LEGACY_JSON_PATH, 'utf8'));
    } catch (err) {
        if (err.code !== 'ENOENT') {
            logger.error('permissions', `Could not read ${LEGACY_JSON_PATH} to import it`, err);
        }
        return;
    }
    let imported = 0;
    const importOne = (type, id, scopes) => {
        if (readGrant(type, id) === null) {
            writeGrant(type, id, scopes);
            imported++;
        }
    };
    for (const id of parsed.allowedUserIds || []) importOne('user', id, null);
    for (const [id, scopes] of Object.entries(parsed.scopedUserIds || {}))
        importOne('user', id, scopes);
    for (const id of parsed.allowedGuildIds || []) importOne('guild', id, null);
    for (const [id, scopes] of Object.entries(parsed.scopedGuildIds || {}))
        importOne('guild', id, scopes);
    fs.renameSync(LEGACY_JSON_PATH, `${LEGACY_JSON_PATH}.imported`);
    logger.info('permissions', `Imported ${imported} grant(s) from permissions.json into SQLite`);
}

let legacyChecked = false;
function ensureImported() {
    if (legacyChecked) return;
    legacyChecked = true;
    importLegacyJson();
}

function getOwnerId() {
    return config.ownerUserId;
}

function isOwner(userId) {
    return userId === getOwnerId();
}

function getGuildScopes(guildId) {
    ensureImported();
    return readGrant('guild', guildId) || [];
}

function isAllowed(userId, guildId) {
    ensureImported();
    if (isOwner(userId) || readGrant('user', userId) !== null) return true;
    const guildScopes = getGuildScopes(guildId);
    return guildScopes === 'all' || guildScopes.length > 0;
}

/**
 * 'all' for the owner, a fully-allowed user, or a fully-allowed guild;
 * otherwise an array of granted scope names — always including
 * BASELINE_SCOPES, plus the union of the user's own grant and their
 * server's grant, if any. Callers gating a specific tool should treat 'all'
 * as "every scope granted" rather than comparing arrays.
 */
function getAllowedScopes(userId, guildId) {
    ensureImported();
    if (isOwner(userId)) return 'all';
    const userGrant = readGrant('user', userId);
    if (userGrant === 'all') return 'all';
    const guildScopes = getGuildScopes(guildId);
    if (guildScopes === 'all') return 'all';
    return [...new Set([...BASELINE_SCOPES, ...(userGrant || []), ...guildScopes])];
}

function hasScope(userId, guildId, scope) {
    const scopes = getAllowedScopes(userId, guildId);
    return scopes === 'all' || scopes.includes(scope);
}

/**
 * Grants access. `scopes` omitted/null grants full access; a non-empty array
 * grants only those scopes and replaces any existing full access. Returns
 * true if this is a new grant, false if it only updated an existing one
 * (still applied either way).
 */
function allowUser(userId, scopes = null) {
    ensureImported();
    return writeGrant('user', userId, scopes);
}

/** Returns true if the user was removed, false if they didn't have access. */
function revokeUser(userId) {
    ensureImported();
    return deleteGrant('user', userId);
}

/** Same semantics as allowUser, but grants every member of `guildId` access at once. */
function allowGuild(guildId, scopes = null) {
    ensureImported();
    return writeGrant('guild', guildId, scopes);
}

/** Returns true if the guild's grant was removed, false if it didn't have one. Individual members' own grants are untouched. */
function revokeGuild(guildId) {
    ensureImported();
    return deleteGrant('guild', guildId);
}

/** { full: userId[], scoped: {id, scopes}[] } — owner always included in full. */
function listAllowedUsers() {
    ensureImported();
    const grants = listGrants('user');
    return {
        full: [getOwnerId(), ...grants.filter((g) => g.scopes === null).map((g) => g.id)],
        scoped: grants.filter((g) => g.scopes !== null),
    };
}

/** { full: guildId[], scoped: {id, scopes}[] } */
function listAllowedGuilds() {
    ensureImported();
    const grants = listGrants('guild');
    return {
        full: grants.filter((g) => g.scopes === null).map((g) => g.id),
        scoped: grants.filter((g) => g.scopes !== null),
    };
}

module.exports = {
    isAllowed,
    isOwner,
    allowUser,
    revokeUser,
    listAllowedUsers,
    allowGuild,
    revokeGuild,
    listAllowedGuilds,
    getAllowedScopes,
    hasScope,
    getOwnerId,
    VALID_SCOPES,
    BASELINE_SCOPES,
};
