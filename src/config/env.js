const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Every environment variable the bot reads, read here and nowhere else, so
// there is one place to see what can be configured and one place that checks
// it. Built at require time (modules read it as they load); loadEnv() is what
// validates it, once, at startup.

const env = process.env;

/** A positive number, or the fallback (empty, non-numeric and 0 all mean "unset"). */
function num(name, fallback) {
    return Number(env[name]) || fallback;
}

/** Like num(), but 0 is a real value — for budgets where 0 means "off". */
function numAllowZero(name, fallback) {
    return env[name] !== undefined && env[name] !== '' ? Number(env[name]) : fallback;
}

function rate(name) {
    const n = Number(env[name]);
    return env[name] !== undefined && env[name] !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}

const config = {
    discordToken: env.DISCORD_TOKEN,
    ownerUserId: env.OWNER_USER_ID,
    httpPort: num('HTTP_PORT', 3002),
    // Warnings and errors are mirrored here (see utils/discordLog.js); '' turns it off.
    logChannelId: env.LOG_CHANNEL_ID ?? '1557778665729691759',

    maxHistoryMessages: num('MAX_HISTORY_MESSAGES', 4),
    replyCooldownMs: num('REPLY_COOLDOWN_MS', 3000),
    conversationRetentionDays: num('CONVERSATION_RETENTION_DAYS', 30),

    ai: {
        provider: (env.AI_PROVIDER || 'deepseek').toLowerCase(),
        // Set to "" to disable fallback entirely.
        fallback:
            env.AI_PROVIDER_FALLBACK !== undefined
                ? env.AI_PROVIDER_FALLBACK.toLowerCase()
                : 'gemini',
        // A tool result longer than this (as JSON) is cut down before the model
        // sees it — see ai/toolResultCap.js.
        toolResultMaxChars: num('TOOL_RESULT_MAX_CHARS', 24000),
        deepseek: {
            apiKey: env.DEEPSEEK_API_KEY,
            model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
            timeoutMs: num('DEEPSEEK_TIMEOUT_MS', 30000),
            continuationTimeoutMs: num('DEEPSEEK_CONTINUATION_TIMEOUT_MS', 120000),
            maxOutputTokens: num('DEEPSEEK_MAX_OUTPUT_TOKENS', 4096),
            boostedMaxOutputTokens: num('DEEPSEEK_MAX_OUTPUT_TOKENS_BOOSTED', 8192),
            toolBudget: {
                base: num('DEEPSEEK_MAX_TOOL_ITERATIONS', 6),
                hard: num('DEEPSEEK_MAX_TOOL_ITERATIONS_HARD', 16),
                step: num('DEEPSEEK_TOOL_BUDGET_EXTEND_STEP', 4),
            },
            costPer1M: {
                input: rate('DEEPSEEK_COST_PER_1M_INPUT'),
                output: rate('DEEPSEEK_COST_PER_1M_OUTPUT'),
            },
        },
        gemini: {
            apiKey: env.GEMINI_API_KEY,
            model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
            maxOutputTokens: num('GEMINI_MAX_OUTPUT_TOKENS', 2048),
            boostedMaxOutputTokens: num('GEMINI_MAX_OUTPUT_TOKENS_BOOSTED', 4096),
            thinkingBudget: numAllowZero('GEMINI_THINKING_BUDGET', 1024),
            continuationThinkingBudget: numAllowZero('GEMINI_CONTINUATION_THINKING_BUDGET', 128),
            toolBudget: {
                base: num('GEMINI_MAX_TOOL_ITERATIONS', 6),
                hard: num('GEMINI_MAX_TOOL_ITERATIONS_HARD', 16),
                step: num('GEMINI_TOOL_BUDGET_EXTEND_STEP', 4),
            },
            costPer1M: {
                input: rate('GEMINI_COST_PER_1M_INPUT'),
                output: rate('GEMINI_COST_PER_1M_OUTPUT'),
            },
        },
        groq: {
            apiKey: env.GROQ_API_KEY,
            model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            timeoutMs: num('GROQ_TIMEOUT_MS', 30000),
            maxOutputTokens: num('GROQ_MAX_OUTPUT_TOKENS', 2048),
            boostedMaxOutputTokens: num('GROQ_MAX_OUTPUT_TOKENS_BOOSTED', 4096),
            toolBudget: {
                base: num('GROQ_MAX_TOOL_ITERATIONS', 6),
                hard: num('GROQ_MAX_TOOL_ITERATIONS_HARD', 16),
                step: num('GROQ_TOOL_BUDGET_EXTEND_STEP', 4),
            },
            costPer1M: {
                input: rate('GROQ_COST_PER_1M_INPUT'),
                output: rate('GROQ_COST_PER_1M_OUTPUT'),
            },
        },
    },

    tools: {
        // maimaiscrape's Express API (friend leaderboards, circle rankings, top scores).
        maimaiApiUrl: env.MAIMAI_API_URL || 'http://localhost:3000',
        // The Admirable0531 fork, not upstream: it syncs with upstream daily and
        // fills in charts upstream's song data doesn't have yet. Same default as
        // maimaiscrape.
        maiToolsScriptUrl:
            env.MAI_TOOLS_SCRIPT_URL ||
            'https://admirable0531.github.io/mai-tools/scripts/all-in-one.js',
        tavilyApiKey: env.TAVILY_API_KEY,
        maimaiLogin: { sid: env.MAIMAI_LOGIN_SID || '', password: env.MAIMAI_LOGIN_PASSWORD || '' },
        maimaiAccountIdleTimeoutMs: num('MAIMAI_ACCOUNT_IDLE_TIMEOUT_MS', 5 * 60 * 1000),
        chromeExecutablePath: env.CHROME_EXECUTABLE_PATH || env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        playwrightFallbackEnabled: env.ENABLE_PLAYWRIGHT_FALLBACK !== 'false',
        playwrightIdleTimeoutMs: num('PLAYWRIGHT_IDLE_TIMEOUT_MS', 5 * 60 * 1000),
    },
};

const PROVIDER_KEY_VARS = {
    deepseek: 'DEEPSEEK_API_KEY',
    gemini: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
};

/**
 * { errors, warnings } for the current config. Errors stop startup;
 * warnings name features that will be unavailable.
 */
function checkConfig() {
    const errors = [];
    const warnings = [];
    if (!config.discordToken) errors.push('DISCORD_TOKEN is not set.');
    // Without an owner nobody can grant anyone access, ever.
    if (!config.ownerUserId) errors.push('OWNER_USER_ID is not set.');

    const { provider, fallback } = config.ai;
    for (const [role, name] of [
        ['AI_PROVIDER', provider],
        ['AI_PROVIDER_FALLBACK', fallback],
    ]) {
        if (!name) continue;
        if (!PROVIDER_KEY_VARS[name]) {
            errors.push(
                `${role}="${name}" is not a known provider (${Object.keys(PROVIDER_KEY_VARS).join(', ')}).`
            );
        } else if (!config.ai[name].apiKey) {
            const message = `${role} is "${name}" but ${PROVIDER_KEY_VARS[name]} is not set.`;
            // Only the primary is fatal: a missing fallback just means no fallback.
            (role === 'AI_PROVIDER' ? errors : warnings).push(message);
        }
    }

    if (!config.tools.tavilyApiKey)
        warnings.push('TAVILY_API_KEY is not set — search_web will fail.');
    if (!config.tools.maimaiLogin.sid || !config.tools.maimaiLogin.password) {
        warnings.push(
            'MAIMAI_LOGIN_SID/MAIMAI_LOGIN_PASSWORD are not set — the live account tools will fail.'
        );
    }
    return { errors, warnings };
}

/** Validates once at startup: exits on anything fatal, warns about the rest. Returns the config. */
function loadEnv() {
    const { errors, warnings } = checkConfig();
    for (const warning of warnings) console.warn(`[config] ${warning}`);
    if (errors.length > 0) {
        console.error(
            `[config] ${errors.join('\n[config] ')}\n[config] Fix .env (see .env.example).`
        );
        process.exit(1);
    }
    return config;
}

module.exports = { config, loadEnv, checkConfig };
