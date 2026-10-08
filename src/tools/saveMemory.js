const { saveMemory } = require('../database/repositories/memoryRepository');

const declaration = {
    name: 'save_memory',
    description:
        "Save a fact about the user you're talking to, as a key/value pair, under their own Discord id. Call it " +
        'when they ask you to remember something ("remember that X means Y"), or when they tell you a lasting fact ' +
        'about themselves: their in-game name, which tracked account or friend is them, what to call them. Not ' +
        'for casual mentions, and never for facts about someone else. Reusing a key overwrites it.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            key: { type: 'string', description: 'Short label for the memory, e.g. a nickname.' },
            value: {
                type: 'string',
                description: 'What the key refers to / the fact to remember.',
            },
            category: {
                type: 'string',
                description: 'Optional short category, e.g. "song_nickname".',
            },
        },
        required: ['key', 'value'],
    },
};

/** userId/guildId are bound from the real Discord message context, never from a model-supplied argument. */
function execute(args, { userId, guildId }) {
    const key = args?.key;
    const value = args?.value;
    if (typeof key !== 'string' || typeof value !== 'string') {
        return { success: false, error: 'key and value must both be strings.' };
    }
    const category = typeof args?.category === 'string' ? args.category : null;
    return saveMemory({ userId, guildId, key, value, category });
}

module.exports = { declaration, execute };
