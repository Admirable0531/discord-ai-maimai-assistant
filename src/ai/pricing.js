const { config } = require('../config/env');

/**
 * Cost estimation is opt-in and env-driven rather than hardcoded — provider
 * pricing changes over time and guessing a stale number would be worse than
 * just reporting token counts. Set <PROVIDER>_COST_PER_1M_INPUT/OUTPUT to
 * enable it per provider; leaving them unset means costUsd stays null.
 */
function estimateCostUsd(provider, promptTokens, completionTokens) {
    const rate = config.ai[provider]?.costPer1M;
    if (!rate || rate.input === null || rate.output === null) return null;
    return (promptTokens / 1_000_000) * rate.input + (completionTokens / 1_000_000) * rate.output;
}

module.exports = { estimateCostUsd };
