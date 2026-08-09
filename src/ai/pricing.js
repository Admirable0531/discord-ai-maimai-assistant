/**
 * Cost estimation is opt-in and env-driven rather than hardcoded — provider
 * pricing changes over time and guessing a stale number would be worse than
 * just reporting token counts. Set *_COST_PER_1M_INPUT/OUTPUT to enable it
 * per provider; leaving them unset means costUsd stays null everywhere.
 */
function parseRate(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function getRates() {
    return {
        gemini: {
            input: parseRate(process.env.GEMINI_COST_PER_1M_INPUT),
            output: parseRate(process.env.GEMINI_COST_PER_1M_OUTPUT),
        },
        deepseek: {
            input: parseRate(process.env.DEEPSEEK_COST_PER_1M_INPUT),
            output: parseRate(process.env.DEEPSEEK_COST_PER_1M_OUTPUT),
        },
    };
}

function estimateCostUsd(provider, promptTokens, completionTokens) {
    const rate = getRates()[provider];
    if (!rate || rate.input === null || rate.output === null) return null;
    return (promptTokens / 1_000_000) * rate.input + (completionTokens / 1_000_000) * rate.output;
}

module.exports = { estimateCostUsd };
