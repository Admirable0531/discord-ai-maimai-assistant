const { sqliteTable, integer, text, real, primaryKey } = require('drizzle-orm/sqlite-core');
const { sql } = require('drizzle-orm');

const memories = sqliteTable('memories', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    guildId: text('guild_id'),
    memoryKey: text('memory_key').notNull(),
    memoryValue: text('memory_value').notNull(),
    category: text('category'),
    createdAt: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
});

const conversations = sqliteTable('conversations', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    guildId: text('guild_id'),
    channelId: text('channel_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
});

const knowledgeBase = sqliteTable('knowledge_base', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    category: text('category'),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
});

const aiUsage = sqliteTable('ai_usage', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    costUsd: real('cost_usd'),
    createdAt: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Who may use which tools (see permissions/permissionStore.js). One row per
 * user or server; scopes is a JSON array of scope names, or NULL for full
 * access.
 */
const permissionGrants = sqliteTable(
    'permission_grants',
    {
        subjectType: text('subject_type').notNull(), // 'user' | 'guild'
        subjectId: text('subject_id').notNull(),
        scopes: text('scopes'),
        createdAt: text('created_at')
            .notNull()
            .default(sql`CURRENT_TIMESTAMP`),
        updatedAt: text('updated_at')
            .notNull()
            .default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => [primaryKey({ columns: [table.subjectType, table.subjectId] })]
);

/** 👍/👎 on a reply (the buttons under it — see discord/replyButtons.js). One vote per user per reply. */
const replyFeedback = sqliteTable(
    'reply_feedback',
    {
        messageId: text('message_id').notNull(),
        userId: text('user_id').notNull(),
        channelId: text('channel_id'),
        rating: integer('rating').notNull(), // 1 or -1
        replyExcerpt: text('reply_excerpt'),
        createdAt: text('created_at')
            .notNull()
            .default(sql`CURRENT_TIMESTAMP`),
    },
    (table) => [primaryKey({ columns: [table.messageId, table.userId] })]
);

module.exports = {
    memories,
    conversations,
    aiUsage,
    knowledgeBase,
    permissionGrants,
    replyFeedback,
};
