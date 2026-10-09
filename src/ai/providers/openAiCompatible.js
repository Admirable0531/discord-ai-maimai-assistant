// Adapter (see ../agentLoop.js) for OpenAI-style chat-completions APIs —
// DeepSeek and Groq both speak it, and differ only in the knobs passed below.
const { estimateCostUsd } = require('../pricing');
const { logUsage } = require('../../database/repositories/usageRepository');
const logger = require('../../utils/logger');

/**
 * @param {object} spec
 * @param {string} spec.name          display name for logs and errors ("DeepSeek")
 * @param {string} spec.provider      key for usage logging and pricing ("deepseek")
 * @param {string} spec.apiUrl
 * @param {object} spec.settings      that provider's section of config.ai
 * @param {object} [spec.policy]      overrides for initialOptions / afterToolCalls /
 *                                    onTruncated / requestBody (see deepseekProvider.js)
 */
function createOpenAiCompatibleAdapter({ name, provider, apiUrl, settings, policy = {} }) {
    function recordUsage(data) {
        const usage = data?.usage;
        if (!usage) return;
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        try {
            logUsage({
                provider,
                model: settings.model,
                promptTokens,
                completionTokens,
                costUsd: estimateCostUsd(provider, promptTokens, completionTokens),
            });
        } catch (err) {
            logger.error('agent', `Failed to log ${name} usage`, err);
        }
    }

    async function post(body, timeoutMs) {
        if (!settings.apiKey) throw new Error(`${name} has no API key configured.`);
        let response;
        try {
            response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${settings.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (err) {
            throw new Error(`Could not reach the ${name} API: ${err.message}`);
        }
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`${name} API returned HTTP ${response.status}: ${text.slice(0, 300)}`);
        }
        const data = await response.json();
        recordUsage(data);
        return data;
    }

    const adapter = {
        name,
        toolBudget: settings.toolBudget,

        initialOptions({ continuation }) {
            return {
                maxTokens: continuation
                    ? settings.boostedMaxOutputTokens
                    : settings.maxOutputTokens,
                timeoutMs: settings.timeoutMs,
            };
        },
        afterToolCalls(opts) {
            return opts;
        },
        // No wider budget to retry with by default: flag it for continuation.
        onTruncated() {
            return null;
        },
        // Extra request fields for these options (e.g. DeepSeek's reasoning_effort).
        requestBody() {
            return {};
        },

        createConversation({ systemPrompt, history, userMessage, tools }) {
            return {
                tools: tools.map((decl) => ({
                    type: 'function',
                    function: {
                        name: decl.name,
                        description: decl.description,
                        parameters: decl.parametersJsonSchema,
                    },
                })),
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...history.map((entry) => ({
                        role: entry.role === 'assistant' ? 'assistant' : 'user',
                        content: entry.content,
                    })),
                    { role: 'user', content: userMessage },
                ],
            };
        },

        async send(conversation, opts, { forceText }) {
            const data = await post(
                {
                    model: settings.model,
                    messages: conversation.messages,
                    tools: conversation.tools,
                    // Tools stay declared when forcing text: the history already
                    // holds tool calls, and dropping the declarations breaks that.
                    tool_choice: forceText ? 'none' : 'auto',
                    max_tokens: opts.maxTokens,
                    ...adapter.requestBody(opts),
                },
                opts.timeoutMs
            );
            const choice = data.choices?.[0];
            const message = choice?.message;
            return {
                raw: message,
                text: (message?.content || '').trim(),
                toolCalls: (message?.tool_calls || []).map((call) => {
                    let args = {};
                    try {
                        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
                    } catch {
                        // Malformed arguments: run the tool with none and let it say what's missing.
                    }
                    return { id: call.id, name: call.function.name, args };
                }),
                finishReason: choice?.finish_reason,
                truncated: choice?.finish_reason === 'length',
            };
        },

        appendToolResults(conversation, response, results, note) {
            conversation.messages.push(response.raw);
            for (const { call, result } of results) {
                conversation.messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify(result),
                });
            }
            if (note) conversation.messages.push({ role: 'user', content: note });
        },
    };
    return Object.assign(adapter, policy);
}

module.exports = { createOpenAiCompatibleAdapter };
