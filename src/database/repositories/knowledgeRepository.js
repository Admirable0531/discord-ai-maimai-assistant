const { eq, and, like, or, isNull } = require('drizzle-orm');
const { getDb } = require('../client');
const { knowledgeBase } = require('../schema');
const { sqliteTimestamp } = require('../timestamp');

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 4000;

function validate(title, content) {
    if (!title || !title.trim()) return 'Knowledge base title cannot be empty.';
    if (!content || !content.trim()) return 'Knowledge base content cannot be empty.';
    if (title.length > MAX_TITLE_LENGTH)
        return `Title is too long (max ${MAX_TITLE_LENGTH} characters).`;
    if (content.length > MAX_CONTENT_LENGTH)
        return `Content is too long (max ${MAX_CONTENT_LENGTH} characters).`;
    return null;
}

/**
 * Entries are shared server-wide (guildId), not per-user like memories.
 * guildId is nullable to also support DM-only deployments where every entry
 * is effectively global.
 */
function guildFilter(guildId) {
    return guildId ? eq(knowledgeBase.guildId, guildId) : isNull(knowledgeBase.guildId);
}

/** SQLite's LIKE is case-insensitive for ASCII by default, so a plain (no wildcard) LIKE is an exact case-insensitive title match. */
function findByTitle(guildId, title) {
    const db = getDb();
    return db
        .select()
        .from(knowledgeBase)
        .where(and(guildFilter(guildId), like(knowledgeBase.title, title.trim())))
        .all()[0];
}

/** Upserts by (guildId, title), case-insensitive — same "update if the key already exists" behavior as saveMemory. */
function addEntry({ guildId, title, content, category, createdBy }) {
    const error = validate(title, content);
    if (error) return { success: false, error };

    const db = getDb();
    const existing = findByTitle(guildId, title);

    if (existing) {
        db.update(knowledgeBase)
            .set({
                content: content.trim(),
                category: category || existing.category,
                createdBy,
                updatedAt: sqliteTimestamp(),
            })
            .where(eq(knowledgeBase.id, existing.id))
            .run();
        return { success: true, updated: true, title: existing.title };
    }

    db.insert(knowledgeBase)
        .values({
            guildId: guildId || null,
            title: title.trim(),
            content: content.trim(),
            category: category || null,
            createdBy,
        })
        .run();
    return { success: true, updated: false, title: title.trim() };
}

/** Free-text search over title + content, scoped to this guild (or global entries if guildId is falsy). */
function searchEntries(guildId, query, limit = 5) {
    const db = getDb();
    const trimmedQuery = (query || '').trim();

    const rows = trimmedQuery
        ? db
              .select()
              .from(knowledgeBase)
              .where(
                  and(
                      guildFilter(guildId),
                      or(
                          like(knowledgeBase.title, `%${trimmedQuery}%`),
                          like(knowledgeBase.content, `%${trimmedQuery}%`)
                      )
                  )
              )
              .limit(limit)
              .all()
        : db.select().from(knowledgeBase).where(guildFilter(guildId)).limit(limit).all();

    return rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        category: row.category,
    }));
}

function listEntries(guildId, limit = 50) {
    return searchEntries(guildId, null, limit);
}

function removeEntry(guildId, title) {
    const existing = findByTitle(guildId, title);
    if (!existing) return { success: false, error: `No knowledge base entry found for "${title}".` };

    const db = getDb();
    db.delete(knowledgeBase).where(eq(knowledgeBase.id, existing.id)).run();
    return { success: true, title: existing.title };
}

module.exports = { addEntry, searchEntries, listEntries, removeEntry };
