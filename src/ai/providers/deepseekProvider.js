// DeepSeek: the OpenAI-compatible adapter plus DeepSeek's reasoning-effort
// policy. deepseek-v4-flash is cheaper than Gemini 3.5 Flash-Lite on both
// input and output and benchmarks well on agentic/tool-use tasks — see
// ../agent.js for how it's wired as primary with Gemini as the fallback.
//
// Budget defaults (config/env.js), from live testing:
// - 4096 output tokens: reasoning_tokens alone routinely ate 500-1500+ per
//   round at the old 2048 cap, and DeepSeek returns an EMPTY response
//   (finish_reason "length", no text, no tool_calls) when reasoning eats the
//   whole budget, which burned the turn on a cold fallback to Gemini.
// - 120s for continuations: composing a long answer at the boosted cap takes
//   materially longer than a tool-picking round trip; at 30s those heavy
//   requests timed out and fell through to Gemini's much smaller cap.
const { createOpenAiCompatibleAdapter } = require('./openAiCompatible');
const { isOwner } = require('../../permissions/permissionStore');
const { config } = require('../../config/env');
const logger = require('../../utils/logger');

const settings = config.ai.deepseek;

// Deliberately loose phrasing match, not a fixed command — this is meant to
// fire on natural asks ("can you think harder about this") without the owner
// needing to remember exact syntax. False positives just cost a larger (still
// bounded) token budget, not a wrong answer. Owner-only: reasoning tokens are
// billed, so the wider budget isn't the default for everyone.
const HIGHER_BUDGET_PATTERN = /\b(think|try|dig|look|search|research)\s+(harder|deeper|more)\b/i;

// DeepSeek's own defaults are thinking enabled and reasoning_effort "high" on
// every call, including "hi". Valid values are only low/high/max (medium and
// xhigh map to high server-side). Tools whose results need real
// interpretation (achievement-formula edge cases, AP/AP+ badge logic, rating
// math) get "max" for the turn that reads their output.
const HEAVY_REASONING_TOOLS = new Set([
    'get_maimai_score_breakdown',
    'get_maimai_song_rating',
    'get_maimai_song_ranking',
    'get_maimai_friend_scores',
]);
// Deliberately narrow: a false "low" costs quality, a missed one a few cents.
const TRIVIAL_MESSAGE_PATTERN =
    /^(hi|hey|hello|yo|sup|thanks|thank you|ty|ok|okay|lol|lmao|nice|cool|k)[!.\s]*$/i;

function initialEffort(userMessage) {
    const trimmed = (userMessage || '').trim();
    return trimmed.length > 0 && trimmed.length <= 20 && TRIVIAL_MESSAGE_PATTERN.test(trimmed)
        ? 'low'
        : 'high';
}

const adapter = createOpenAiCompatibleAdapter({
    name: 'DeepSeek',
    provider: 'deepseek',
    apiUrl: 'https://api.deepseek.com/chat/completions',
    settings,
    policy: {
        initialOptions({ userId, userMessage, continuation }) {
            // A continuation is pure composition — the tool results it needs
            // are already in history — so it starts at the full boosted cap,
            // low effort and a longer timeout, instead of repeating the
            // attempt that got the answer cut off.
            if (continuation) {
                logger.info(
                    'agent',
                    `Continuing a cut-off reply — boosted budget (${settings.boostedMaxOutputTokens})`
                );
                return {
                    maxTokens: settings.boostedMaxOutputTokens,
                    effort: 'low',
                    timeoutMs: settings.continuationTimeoutMs,
                };
            }
            const boosted = isOwner(userId) && HIGHER_BUDGET_PATTERN.test(userMessage || '');
            if (boosted) {
                logger.info(
                    'agent',
                    `Owner asked for a deeper look — boosted budget (${settings.boostedMaxOutputTokens})`
                );
            }
            return {
                maxTokens: boosted ? settings.boostedMaxOutputTokens : settings.maxOutputTokens,
                effort: initialEffort(userMessage),
                timeoutMs: settings.timeoutMs,
            };
        },

        afterToolCalls(opts, toolNames) {
            const heavy = toolNames.some((name) => HEAVY_REASONING_TOOLS.has(name));
            return { ...opts, effort: heavy ? 'max' : 'high' };
        },

        // Raising max_tokens alone barely helped: reasoning is billed against
        // the same budget, and at effort "max" the thinking can use most of
        // 8192 before a long table is written. By now the tool results are in
        // and what's left is composing them, so stepping effort down is what
        // actually frees room for the answer. Nothing left to widen once at
        // the boosted cap with low effort.
        onTruncated(opts) {
            if (opts.maxTokens === settings.boostedMaxOutputTokens && opts.effort === 'low')
                return null;
            const effort = opts.effort === 'max' ? 'high' : 'low';
            logger.info(
                'agent',
                `DeepSeek retry: ${settings.boostedMaxOutputTokens} tokens, effort ${opts.effort} -> ${effort}`
            );
            return { ...opts, maxTokens: settings.boostedMaxOutputTokens, effort };
        },

        requestBody(opts) {
            return opts.effort ? { reasoning_effort: opts.effort } : {};
        },
    },
});

module.exports = { adapter };
