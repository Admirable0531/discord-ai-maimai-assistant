const { eq, and, like, desc, inArray, sql } = require('drizzle-orm');
const { getDb } = require('../client');
const { memories } = require('../schema');
const { sqliteTimestamp } = require('../timestamp');
const { searchIds } = require('../textSearch');

const MAX_KEY_LENGTH = 200;
const MAX_VALUE_LENGTH = 2000;
// Memory is open to every user (see permissionStore's BASELINE_SCOPES), so
// this bounds what any one of them can pile up. Updating an existing key
// never counts against it.
const MAX_MEMORIES_PER_USER = 50;

function validate(key, value) {
    if (!key || !key.trim()) return 'Memory key cannot be empty.';
    if (!value || !value.trim()) return 'Memory value cannot be empty.';
    if (key.length > MAX_KEY_LENGTH)
        return `Memory key is too long (max ${MAX_KEY_LENGTH} characters).`;
    if (value.length > MAX_VALUE_LENGTH)
        return `Memory value is too long (max ${MAX_VALUE_LENGTH} characters).`;
    return null;
}

/** SQLite's LIKE is case-insensitive for ASCII by default, so a plain (no wildcard) LIKE is an exact case-insensitive key match. */
function findByKey(userId, key) {
    const db = getDb();
    return db
        .select()
        .from(memories)
        .where(and(eq(memories.userId, userId), like(memories.memoryKey, key.trim())))
        .all()[0];
}

/**
 * Upserts by (userId, memoryKey), case-insensitive — matches the spec's
 * "update an existing memory if the same key already exists" rule.
 */
function saveMemory({ userId, guildId, key, value, category }) {
    const error = validate(key, value);
    if (error) return { success: false, error };

    const db = getDb();
    const existing = findByKey(userId, key);

    if (existing) {
        db.update(memories)
            .set({
                memoryValue: value.trim(),
                category: category || existing.category,
                updatedAt: sqliteTimestamp(),
            })
            .where(eq(memories.id, existing.id))
            .run();
        return { success: true, updated: true, key: existing.memoryKey };
    }

    const [{ count }] = db
        .select({ count: sql`count(*)` })
        .from(memories)
        .where(eq(memories.userId, userId))
        .all();
    if (count >= MAX_MEMORIES_PER_USER) {
        return {
            success: false,
            error: `This user already has ${MAX_MEMORIES_PER_USER} memories saved, the limit — update an existing key or /forget one first.`,
        };
    }

    db.insert(memories)
        .values({
            userId,
            guildId: guildId || null,
            memoryKey: key.trim(),
            memoryValue: value.trim(),
            category: category || null,
        })
        .run();
    return { success: true, updated: false, key: key.trim() };
}

function toResult(row) {
    return {
        id: row.id,
        key: row.memoryKey,
        value: row.memoryValue,
        category: row.category,
        updatedAt: row.updatedAt,
    };
}

/**
 * Scoped strictly to userId — never returns another user's memories. A query
 * is matched word by word (full-text index first, substring after — see
 * textSearch.js); no query lists the most recently updated.
 */
function searchMemories(userId, query, limit = 5) {
    const db = getDb();
    const trimmedQuery = (query || '').trim();

    if (!trimmedQuery) {
        return db
            .select()
            .from(memories)
            .where(eq(memories.userId, userId))
            .orderBy(desc(memories.updatedAt), desc(memories.id))
            .limit(limit)
            .all()
            .map(toResult);
    }

    const ids = searchIds(db.$client, {
        table: 'memories',
        fts: 'memories_fts',
        columns: ['memory_key', 'memory_value'],
        scope: { sql: 't.user_id = ?', params: [userId] },
        query: trimmedQuery,
        limit,
    });
    if (ids.length === 0) return [];
    const byId = new Map(
        db
            .select()
            .from(memories)
            .where(and(eq(memories.userId, userId), inArray(memories.id, ids)))
            .all()
            .map((row) => [row.id, row])
    );
    return ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map(toResult);
}

function listMemories(userId, limit = 25) {
    return searchMemories(userId, null, limit);
}

/** One of this user's memories by id, or undefined — the id alone never reaches another user's. */
function getMemoryById(userId, id) {
    const row = getDb()
        .select()
        .from(memories)
        .where(and(eq(memories.userId, userId), eq(memories.id, id)))
        .all()[0];
    return row ? toResult(row) : undefined;
}

function updateMemoryValue(userId, id, value) {
    const existing = getMemoryById(userId, id);
    if (!existing) return { success: false, error: 'That memory no longer exists.' };
    const error = validate(existing.key, value);
    if (error) return { success: false, error };
    getDb()
        .update(memories)
        .set({ memoryValue: value.trim(), updatedAt: sqliteTimestamp() })
        .where(and(eq(memories.userId, userId), eq(memories.id, id)))
        .run();
    return { success: true, key: existing.key };
}

function forgetMemoryById(userId, id) {
    const existing = getMemoryById(userId, id);
    if (!existing) return { success: false, error: 'That memory no longer exists.' };
    getDb()
        .delete(memories)
        .where(and(eq(memories.userId, userId), eq(memories.id, id)))
        .run();
    return { success: true, key: existing.key };
}

/**
 * Memories whose text is the same under different keys ("main chart" and
 * "Main Chart " both saying the same thing, usually from saving a fact twice
 * in different words). Groups of ids, each group newest first.
 */
function findDuplicateGroups(userId) {
    const groups = new Map();
    const rows = getDb()
        .select()
        .from(memories)
        .where(eq(memories.userId, userId))
        .orderBy(desc(memories.updatedAt), desc(memories.id))
        .all();
    for (const row of rows) {
        const signature = row.memoryValue.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!groups.has(signature)) groups.set(signature, []);
        groups.get(signature).push(row);
    }
    return [...groups.values()].filter((group) => group.length > 1);
}

/** Keeps the newest memory of each duplicate group and deletes the rest. Returns the keys it removed. */
function mergeDuplicateMemories(userId) {
    const db = getDb();
    const removed = [];
    for (const [, ...older] of findDuplicateGroups(userId)) {
        for (const row of older) {
            db.delete(memories).where(eq(memories.id, row.id)).run();
            removed.push(row.memoryKey);
        }
    }
    return removed;
}

function forgetMemory(userId, key) {
    const existing = findByKey(userId, key);
    if (!existing) return { success: false, error: `No memory found for "${key}".` };

    const db = getDb();
    db.delete(memories).where(eq(memories.id, existing.id)).run();
    return { success: true, key: existing.memoryKey };
}

module.exports = {
    saveMemory,
    searchMemories,
    listMemories,
    forgetMemory,
    getMemoryById,
    updateMemoryValue,
    forgetMemoryById,
    findDuplicateGroups,
    mergeDuplicateMemories,
    MAX_VALUE_LENGTH,
};
