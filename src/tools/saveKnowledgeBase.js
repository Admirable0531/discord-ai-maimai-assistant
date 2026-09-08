const { addEntry } = require('../database/repositories/knowledgeRepository');

const declaration = {
    name: 'save_knowledge_base',
    description:
        'Add or correct an entry in the shared knowledge base — the same store search_knowledge_base ' +
        'reads from. Unlike save_memory (private, per-user), this is visible to everyone, in every ' +
        'server the bot is in and in DMs, so only call it when someone is clearly stating something ' +
        'that should be true for the whole group going forward, not a personal preference or a ' +
        'one-off aside. Two ' +
        'cases: (1) they explicitly ask you to save/remember something for the server/group/everyone, or ' +
        '(2) they correct a fact you just gave (especially one that came from search_knowledge_base) and ' +
        'the correction is clearly meant to stick, e.g. "no, that\'s outdated, it\'s actually X now" or ' +
        '"the rule changed, update it to Y". If you\'re not sure whether it should persist, ask before ' +
        "calling this rather than guessing. If you're correcting an existing entry, pass its exact " +
        "existing title back so this updates it in place instead of creating a duplicate — use " +
        'search_knowledge_base first if you need to find that exact title. You may not have permission to ' +
        'call this even if you have search access; if it fails, just tell the user that only the owner or ' +
        'someone they granted "knowledge" access can update the shared knowledge base.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description:
                    'Short label for the entry. Reuse an existing entry\'s exact title to update/correct it instead of duplicating it.',
            },
            content: {
                type: 'string',
                description: 'The corrected/new fact or answer to save.',
            },
            category: {
                type: 'string',
                description: 'Optional short category, e.g. "house_rule" or "terminology".',
            },
        },
        required: ['title', 'content'],
    },
};

/**
 * userId/guildId are bound from the real Discord message context, never
 * from a model-supplied argument. Permission (the 'knowledge' scope) is
 * enforced upstream in toolDefinitions.js's createToolExecutors, before this
 * ever runs — a rejected call never reaches here.
 */
function execute(args, { userId, guildId }) {
    const title = args?.title;
    const content = args?.content;
    if (typeof title !== 'string' || typeof content !== 'string') {
        return { success: false, error: 'title and content must both be strings.' };
    }
    const category = typeof args?.category === 'string' ? args.category : null;
    return addEntry({ guildId, title, content, category, createdBy: userId });
}

module.exports = { declaration, execute };
