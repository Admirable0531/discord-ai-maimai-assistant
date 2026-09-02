const { searchEntries } = require('../database/repositories/knowledgeRepository');

const declaration = {
    name: 'search_knowledge_base',
    description:
        "Search this server's shared knowledge base — curated facts the bot owner has saved about this " +
        'group (house rules, terminology, FAQ-style answers, anything specific to this community rather ' +
        "than general maimai knowledge). Unlike search_memory (private, per-user), these entries are " +
        'shared and visible to everyone. Use it before answering a question that might be covered by ' +
        "this group's own conventions rather than general knowledge.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description:
                    'What to search for, e.g. a topic or term (matched against saved titles and content).',
            },
        },
        required: ['query'],
    },
};

/** guildId is bound from the real Discord message context, never from a model-supplied argument. Entries are read-only via this tool — only the owner can add/remove them, via the /knowledge slash command, to keep shared knowledge from being poisoned by chat instructions from other users. */
function execute(args, { guildId }) {
    const query = typeof args?.query === 'string' ? args.query : '';
    return { success: true, entries: searchEntries(guildId, query, 5) };
}

module.exports = { declaration, execute };
