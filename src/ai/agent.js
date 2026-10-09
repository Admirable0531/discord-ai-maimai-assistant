// Entry point for generating a reply: picks the provider (AI_PROVIDER, with
// AI_PROVIDER_FALLBACK behind it) and runs the shared tool loop
// (agentLoop.js) with that provider's adapter. A new provider is one adapter
// file — see providers/openAiCompatible.js for an OpenAI-style API, or
// providers/geminiProvider.js for the full interface.
const { runAgent } = require('./agentLoop');
const { config } = require('../config/env');
const logger = require('../utils/logger');

const ADAPTERS = {
    gemini: () => require('./providers/geminiProvider').adapter,
    groq: () => require('./providers/groqProvider').adapter,
    deepseek: () => require('./providers/deepseekProvider').adapter,
};

function loadAdapter(name) {
    const factory = ADAPTERS[name];
    if (!factory) {
        throw new Error(
            `Unknown AI provider "${name}" — available: ${Object.keys(ADAPTERS).join(', ')}`
        );
    }
    return factory();
}

/**
 * generateReply(history, userMessage, {userId, guildId, speaker, continuation})
 * -> Promise<string>.
 *
 * Tries the primary provider first; on any failure (missing API key, network
 * error, empty/malformed response — anything that throws) it falls back to
 * the second rather than the message just failing. Only on an actual error,
 * never on answer quality — there's no reliable way to judge that, and
 * guessing would silently double the cost of every reply.
 */
async function generateReply(history, userMessage, context) {
    const { provider, fallback } = config.ai;
    let first = provider;
    let second = fallback && fallback !== provider ? fallback : null;

    // A message with images goes to a provider that can read them first,
    // whichever is the usual primary; the other is the fallback, and is told
    // about the images it can't see (agentLoop.js).
    if (context.images?.length > 0 && second && !loadAdapter(first).supportsImages) {
        if (loadAdapter(second).supportsImages) {
            logger.info(
                'agent',
                `Message has ${context.images.length} image(s) — using "${second}" (vision) instead of "${first}"`
            );
            [first, second] = [second, first];
        }
    }

    try {
        return await runAgent(loadAdapter(first), history, userMessage, context);
    } catch (err) {
        if (!second) throw err;
        logger.warn(
            'agent',
            `Provider "${first}" failed, falling back to "${second}": ${err.message}`
        );
        // Files the failed run already made would otherwise come out twice,
        // once from each run's tool calls.
        if (context.outputs) context.outputs.files.length = 0;
        return runAgent(loadAdapter(second), history, userMessage, context);
    }
}

module.exports = { generateReply };
