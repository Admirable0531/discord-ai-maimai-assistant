const { eq, like, desc, inArray } = require('drizzle-orm');
const { getDb } = require('../client');
const { knowledgeBase } = require('../schema');
const { sqliteTimestamp } = require('../timestamp');
const { searchIds } = require('../textSearch');

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
 * Entries are GLOBAL — one shared knowledge base across every server the bot
 * is in, plus DMs. This is a private bot for one group of people who follow
 * it between servers, so per-guild scoping just meant the same correction had
 * to be re-taught in each place (and anything taught in a DM was invisible
 * everywhere). guild_id is still recorded on write as provenance — where a
 * fact was first taught — it just isn't a filter any more.
 *
 * Titles are therefore unique globally: teaching "B50" in one server and
 * again in another updates the one entry rather than creating a second.
 */

/** SQLite's LIKE is case-insensitive for ASCII by default, so a plain (no wildcard) LIKE is an exact case-insensitive title match. */
function findByTitle(title) {
    const db = getDb();
    return db.select().from(knowledgeBase).where(like(knowledgeBase.title, title.trim())).all()[0];
}

/** Upserts by title, case-insensitive — same "update if the key already exists" behavior as saveMemory. */
function addEntry({ guildId, title, content, category, createdBy }) {
    const error = validate(title, content);
    if (error) return { success: false, error };

    const db = getDb();
    const existing = findByTitle(title);

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

function toResult(row) {
    return { id: row.id, title: row.title, content: row.content, category: row.category };
}

/**
 * Free-text search over title, content and category, across every entry
 * regardless of where it was taught. Matched word by word, best first (see
 * textSearch.js); no query lists the most recently updated.
 */
function searchEntries(query, limit = 5) {
    const db = getDb();
    const trimmedQuery = (query || '').trim();

    if (!trimmedQuery) {
        return db
            .select()
            .from(knowledgeBase)
            .orderBy(desc(knowledgeBase.updatedAt), desc(knowledgeBase.id))
            .limit(limit)
            .all()
            .map(toResult);
    }

    const ids = searchIds(db.$client, {
        table: 'knowledge_base',
        fts: 'knowledge_base_fts',
        columns: ['title', 'content', 'category'],
        query: trimmedQuery,
        limit,
    });
    if (ids.length === 0) return [];
    const byId = new Map(
        db
            .select()
            .from(knowledgeBase)
            .where(inArray(knowledgeBase.id, ids))
            .all()
            .map((row) => [row.id, row])
    );
    return ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map(toResult);
}

function listEntries(limit = 50) {
    return searchEntries(null, limit);
}

function removeEntry(title) {
    const existing = findByTitle(title);
    if (!existing)
        return { success: false, error: `No knowledge base entry found for "${title}".` };

    const db = getDb();
    db.delete(knowledgeBase).where(eq(knowledgeBase.id, existing.id)).run();
    return { success: true, title: existing.title };
}

module.exports = { addEntry, searchEntries, listEntries, removeEntry };
