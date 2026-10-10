// Gemini adapter (see ../agentLoop.js for the interface).
//
// thinkingBudget (config/env.js): -1 = automatic, which has no ceiling, so a
// moderate fixed 1024 caps worst-case spend while leaving room for tool
// selection. Continuations use 128, NOT 0: gemini-3.5-flash-lite rejects
// thinkingBudget 0 with 400 INVALID_ARGUMENT (verified live — 0 fails, 128
// and 1024 succeed), and a rejected request took out the whole continuation.
const { FunctionCallingConfigMode } = require('@google/genai');
const { getGeminiClient } = require('./geminiClient');
const { estimateCostUsd } = require('../pricing');
const { logUsage } = require('../../database/repositories/usageRepository');
const { config } = require('../../config/env');
const logger = require('../../utils/logger');

const settings = config.ai.gemini;

/**
 * Text parts read by hand instead of the SDK's `.text` getter, which —
 * confirmed live — logs a warning and can return '' when the response also
 * holds a non-text part (a stray functionCall), even with real text present.
 */
function extractText(response) {
    const parts = response.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts
        .filter((p) => typeof p.text === 'string')
        .map((p) => p.text)
        .join('')
        .trim();
}

function recordUsage(response, model) {
    const usage = response.usageMetadata;
    if (!usage) return;
    const promptTokens = usage.promptTokenCount || 0;
    const completionTokens = usage.candidatesTokenCount || 0;
    try {
        logUsage({
            provider: 'gemini',
            model,
            promptTokens,
            completionTokens,
            costUsd: estimateCostUsd('gemini', promptTokens, completionTokens),
        });
    } catch (err) {
        logger.error('agent', 'Failed to log Gemini usage', err);
    }
}

const adapter = {
    name: 'Gemini',
    toolBudget: settings.toolBudget,
    supportsImages: true,

    initialOptions({ continuation, hasImages }) {
        // Same picture, same answer: a low temperature, more thinking, and the
        // vision model when one is configured (see config/env.js).
        if (hasImages && !continuation) {
            return {
                // Thinking counts against the output cap, so the larger budget needs the larger cap.
                maxOutputTokens: settings.boostedMaxOutputTokens,
                thinkingBudget: settings.visionThinkingBudget,
                temperature: 0.2,
                ...(settings.visionModel ? { model: settings.visionModel } : {}),
            };
        }
        return continuation
            ? {
                  maxOutputTokens: settings.boostedMaxOutputTokens,
                  thinkingBudget: settings.continuationThinkingBudget,
              }
            : {
                  maxOutputTokens: settings.maxOutputTokens,
                  thinkingBudget: settings.thinkingBudget,
              };
    },
    afterToolCalls(opts) {
        return opts;
    },
    onTruncated() {
        return null;
    },

    /**
     * Stateless generateContent over a contents array we own (rather than
     * ai.chats.create()'s opaque session), so history can come from SQLite
     * and tool round trips append to it.
     */
    createConversation({ systemPrompt, history, userMessage, tools, images = [] }) {
        return {
            systemInstruction: systemPrompt,
            tools: [{ functionDeclarations: tools }],
            contents: [
                ...history.map((entry) => ({
                    role: entry.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: entry.content }],
                })),
                {
                    role: 'user',
                    parts: [
                        ...images.map((image) => ({
                            inlineData: { mimeType: image.mimeType, data: image.data },
                        })),
                        { text: userMessage },
                    ],
                },
            ],
        };
    },

    async send(conversation, opts, { forceText }) {
        const response = await getGeminiClient().models.generateContent({
            model: opts.model || settings.model,
            contents: conversation.contents,
            config: {
                systemInstruction: conversation.systemInstruction,
                // Kept declared even when forcing text, with mode NONE instead:
                // dropping tools while the history holds functionCall turns
                // reproducibly came back with a stray functionCall and no text.
                tools: conversation.tools,
                ...(forceText
                    ? {
                          toolConfig: {
                              functionCallingConfig: { mode: FunctionCallingConfigMode.NONE },
                          },
                      }
                    : {}),
                maxOutputTokens: opts.maxOutputTokens,
                ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
                thinkingConfig: { thinkingBudget: opts.thinkingBudget },
            },
        });
        recordUsage(response, opts.model || settings.model);
        const finishReason = response.candidates?.[0]?.finishReason;
        return {
            raw: response,
            text: extractText(response),
            toolCalls: (response.functionCalls || []).map((call) => ({
                id: call.id,
                name: call.name,
                args: call.args || {},
            })),
            finishReason,
            truncated: finishReason === 'MAX_TOKENS',
        };
    },

    appendToolResults(conversation, response, results, note) {
        // contents must alternate user/model, and Gemini needs to see its own
        // functionCall turn before the matching responses.
        conversation.contents.push(
            response.raw.candidates?.[0]?.content ?? {
                role: 'model',
                parts: results.map(({ call }) => ({
                    functionCall: { name: call.name, args: call.args },
                })),
            }
        );
        const parts = results.map(({ call, result }) => ({
            functionResponse: {
                name: call.name,
                ...(call.id ? { id: call.id } : {}),
                response: result,
            },
        }));
        if (note) parts.push({ text: note });
        conversation.contents.push({ role: 'user', parts });
    },
};

module.exports = { adapter };
