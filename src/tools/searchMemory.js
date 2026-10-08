const { searchMemories } = require('../database/repositories/memoryRepository');

const declaration = {
    name: 'search_memory',
    description:
        "Search the current user's saved memories (nicknames, facts they've asked you to remember) by a " +
        "free-text query. Only ever returns this user's own memories. Their most recent memories are already " +
        'listed in your instructions under "Who you are talking to" — use this only for anything not listed there.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description:
                    'What to search for, e.g. a nickname or topic (matched against saved keys and values).',
            },
        },
        required: ['query'],
    },
};

/** userId is bound from the real Discord message context, never from a model-supplied argument. */
function execute(args, { userId }) {
    const query = typeof args?.query === 'string' ? args.query : '';
    return { success: true, memories: searchMemories(userId, query, 5) };
}

module.exports = { declaration, execute };
