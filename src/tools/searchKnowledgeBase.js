const { searchEntries } = require('../database/repositories/knowledgeRepository');

const declaration = {
    name: 'search_knowledge_base',
    description:
        'Search the shared knowledge base — curated facts saved about this group (house rules, ' +
        'terminology, FAQ-style answers, anything specific to this community rather than general maimai ' +
        'knowledge). Unlike search_memory (private, per-user), these entries are shared and visible to ' +
        'everyone, in every server the bot is in and in DMs — one global knowledge base, not per-server. ' +
        "Use it before answering a question that might be covered by this group's own conventions rather " +
        'than general knowledge.',
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

/** The knowledge base is global (see knowledgeRepository.js), so this needs no Discord context to scope by. Writes go through save_knowledge_base / the /knowledge command, both gated on the "knowledge" scope, so chat from an unprivileged user can't poison what everyone reads here. */
function execute(args) {
    const query = typeof args?.query === 'string' ? args.query : '';
    return { success: true, entries: searchEntries(query, 5) };
}

module.exports = { declaration, execute };
