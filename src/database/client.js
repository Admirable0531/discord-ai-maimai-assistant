const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '../../data');
// BOT_DB_PATH exists so tests and scratch scripts can use a throwaway database.
const DB_PATH = process.env.BOT_DB_PATH || path.join(DATA_DIR, 'bot.db');

/**
 * Bootstrapped directly with CREATE TABLE IF NOT EXISTS rather than
 * drizzle-kit migrations — there are only a few tables and no schema history
 * to manage yet. If the schema in schema.js changes later, update this SQL
 * to match (and write a manual ALTER for existing databases).
 */
const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    memory_key TEXT NOT NULL,
    memory_value TEXT NOT NULL,
    category TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_memories_user_key ON memories(user_id, memory_key);

CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    channel_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_id, id);

CREATE TABLE IF NOT EXISTS knowledge_base (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_title ON knowledge_base(guild_id, title);

CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    cost_usd REAL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);

CREATE TABLE IF NOT EXISTS permission_grants (
    subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'guild')),
    subject_id TEXT NOT NULL,
    scopes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS reply_feedback (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT,
    rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
    reply_excerpt TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id)
);
`;

/**
 * Full-text indexes over the two tables the model searches by free text.
 * External-content FTS5 tables (no second copy of the text), kept in step by
 * triggers. The trigram tokenizer is deliberate: this community writes in
 * Japanese and Chinese as much as English, and the default tokenizer cannot
 * split CJK text into words — trigram matches any 3+ character substring
 * whatever the language (shorter terms are covered by a LIKE fallback in
 * textSearch.js). A table made on an existing database is filled from the
 * rows already there.
 */
const FTS_INDEXES = [
    { table: 'memories', fts: 'memories_fts', columns: ['memory_key', 'memory_value'] },
    {
        table: 'knowledge_base',
        fts: 'knowledge_base_fts',
        columns: ['title', 'content', 'category'],
    },
];

function ensureFtsIndex(sqlite, { table, fts, columns }) {
    const exists = sqlite.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(fts);
    if (exists) return;

    const list = columns.join(', ');
    const fromNew = columns.map((c) => `new.${c}`).join(', ');
    const fromOld = columns.map((c) => `old.${c}`).join(', ');
    sqlite.exec(`
CREATE VIRTUAL TABLE ${fts} USING fts5(${list}, content='${table}', content_rowid='id', tokenize='trigram');
CREATE TRIGGER ${table}_fts_ai AFTER INSERT ON ${table} BEGIN
    INSERT INTO ${fts}(rowid, ${list}) VALUES (new.id, ${fromNew});
END;
CREATE TRIGGER ${table}_fts_ad AFTER DELETE ON ${table} BEGIN
    INSERT INTO ${fts}(${fts}, rowid, ${list}) VALUES ('delete', old.id, ${fromOld});
END;
CREATE TRIGGER ${table}_fts_au AFTER UPDATE ON ${table} BEGIN
    INSERT INTO ${fts}(${fts}, rowid, ${list}) VALUES ('delete', old.id, ${fromOld});
    INSERT INTO ${fts}(rowid, ${list}) VALUES (new.id, ${fromNew});
END;
INSERT INTO ${fts}(${fts}) VALUES ('rebuild');
`);
    logger.info('database', `Built full-text index ${fts}`);
}

let db = null;

function getDb() {
    if (db) return db;

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const sqlite = new Database(DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.exec(CREATE_TABLES_SQL);
    for (const index of FTS_INDEXES) ensureFtsIndex(sqlite, index);

    db = drizzle(sqlite);
    logger.info('database', `SQLite ready at ${DB_PATH}`);
    return db;
}

module.exports = { getDb };
