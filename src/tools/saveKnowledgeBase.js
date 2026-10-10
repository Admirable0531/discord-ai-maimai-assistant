const { addEntry } = require('../database/repositories/knowledgeRepository');

const declaration = {
    name: 'save_knowledge_base',
    description:
        'Add or correct an entry in the shared knowledge base — visible to everyone, in every server and DM (save_memory is the private, per-user one). Only when someone (1) asks to save something for the group, or (2) corrects a fact you gave and clearly means the correction to stick ("that\'s outdated, it\'s X now"). If unsure whether it should persist, ask first. To correct an entry, pass its exact existing title (find it with search_knowledge_base) so it updates in place. If it fails for permission, say only the owner or someone with "knowledge" access can update it.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description:
                    "Short label for the entry. Reuse an existing entry's exact title to update/correct it instead of duplicating it.",
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
