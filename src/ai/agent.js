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
    try {
        return await runAgent(loadAdapter(provider), history, userMessage, context);
    } catch (err) {
        if (!fallback || fallback === provider) throw err;
        logger.warn(
            'agent',
            `Primary provider "${provider}" failed, falling back to "${fallback}": ${err.message}`
        );
        return runAgent(loadAdapter(fallback), history, userMessage, context);
    }
}

module.exports = { generateReply };
