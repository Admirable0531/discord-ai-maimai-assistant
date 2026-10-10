// The tool-calling loop every provider runs: ask the model, run the tools it
// asks for, feed the results back, repeat until it answers. This used to be
// written out three times, once per provider (~900 lines between them), and
// the copies had drifted: Groq never detected a cut-off answer, only DeepSeek
// retried one, and each change (who's speaking, continuations) had to be made
// in three places. Providers now only adapt the wire format — see
// providers/openAiCompatible.js and providers/geminiProvider.js for the
// adapter interface — and everything else happens here, once.
const { buildSystemPrompt } = require('./systemPrompt');
const { toolDeclarationsFor, createToolExecutors } = require('./toolDefinitions');
const { capToolResult } = require('./toolResultCap');
const { markTruncated } = require('./truncation');
const {
    isUntrustedSource,
    isWriteTool,
    markUntrusted,
    BLOCKED_ERROR,
} = require('./untrustedContent');
const { config } = require('../config/env');
const logger = require('../utils/logger');

const REQUEST_MORE_TOOL_CALLS = 'request_more_tool_calls';

// Handled here (it changes this loop's own budget), not by a tool executor.
const requestMoreToolCallsDeclaration = {
    name: REQUEST_MORE_TOOL_CALLS,
    description:
        'Ask for more tool-call budget for this message. Each Discord message has a limited number of tool ' +
        'calls; you get a low-budget warning in the tool results once you are close to running out. Call this ' +
        'ONLY if you are near/at that limit and genuinely still need more steps to finish (e.g. you are midway ' +
        'through reading several pages or synthesizing a large table) — not speculatively, and not on turn one.',
    parametersJsonSchema: { type: 'object', properties: {} },
};

/** Tells the Discord layer which tools are about to run, for its "working on it" message. Never throws. */
function notifyProgress(context, toolNames) {
    try {
        context.onProgress?.(toolNames);
    } catch (err) {
        logger.warn('agent', 'Progress callback failed', err);
    }
}

const GAVE_UP_REPLY =
    "I looked into this but couldn't put together a complete answer — try rephrasing, or ask about something more specific.";

/**
 * Runs one message to a final answer with `adapter`.
 *
 * The adapter supplies:
 *   name                          for logs ("DeepSeek")
 *   toolBudget {base, hard, step} tool-call round trips: starting budget, absolute
 *                                 ceiling, and how much one request_more_tool_calls adds
 *   initialOptions(turn)          per-request knobs (token cap, effort, …) for the
 *                                 first call; opaque to this loop
 *   afterToolCalls(opts, names)   knobs for the call that reads those tools' results
 *   onTruncated(opts)             knobs for one retry after a cut-off answer, or null
 *                                 to return it flagged for continuation instead
 *   supportsImages                true if createConversation can take `images`
 *   createConversation({systemPrompt, history, userMessage, tools, images})
 *   send(conversation, opts, {forceText}) ->
 *       {text, toolCalls: [{id, name, args}], finishReason, truncated}
 *   appendToolResults(conversation, response, [{call, result}], note)
 */
async function runAgent(adapter, history, userMessage, context) {
    const { userId, continuation } = context;
    const executors = createToolExecutors(context);
    // Images go only to a provider that can see them; any other is told they
    // exist so it says so instead of answering as if there were nothing there.
    const attached = context.images || [];
    const canSee = adapter.supportsImages && attached.length > 0;
    if (attached.length > 0 && !adapter.supportsImages) {
        logger.warn(
            'agent',
            `${adapter.name} can't read images — ${attached.length} attached image(s) left out`
        );
    }
    const conversation = adapter.createConversation({
        systemPrompt: buildSystemPrompt(context),
        history,
        userMessage:
            attached.length > 0 && !canSee
                ? `${userMessage}\n[System note: the image(s) above could not be passed to you, so you cannot see them — say so rather than guessing at their content.]`
                : userMessage,
        tools: [...toolDeclarationsFor(context), requestMoreToolCallsDeclaration],
        images: canSee ? attached : [],
    });
    const { base, hard, step } = adapter.toolBudget;
    let maxIterations = base;
    let opts = adapter.initialOptions({ userId, userMessage, continuation, hasImages: canSee });
    // One retry at most, so a long reply can't ping-pong between retries.
    let retriedAfterTruncation = false;
    // Set once any tool has returned text from the open web; from then on this
    // message may not write memory or knowledge (see untrustedContent.js).
    let readUntrusted = false;

    async function runTool(call) {
        if (call.name === REQUEST_MORE_TOOL_CALLS) {
            if (maxIterations >= hard) {
                return {
                    success: false,
                    granted: false,
                    error: `Already at the hard cap of ${hard} tool calls for this message — answer with what you have.`,
                };
            }
            const before = maxIterations;
            maxIterations = Math.min(hard, maxIterations + step);
            logger.info(
                'agent',
                `${adapter.name} requested more tool-call budget: ${before} -> ${maxIterations}`
            );
            return { success: true, granted: true, new_budget: maxIterations };
        }
        if (readUntrusted && isWriteTool(call.name)) {
            logger.warn(
                'agent',
                `Refused ${call.name} for ${userId}: this message already read web content`
            );
            return { success: false, error: BLOCKED_ERROR };
        }
        const executor = executors[call.name];
        if (!executor) {
            // Includes tools this user isn't offered, if the model guesses one anyway.
            logger.warn('agent', `Unknown tool requested: ${call.name}`);
            return { success: false, error: `Unknown tool: ${call.name}` };
        }
        try {
            const result = capToolResult(
                await executor(call.args || {}),
                config.ai.toolResultMaxChars
            );
            return isUntrustedSource(call.name) ? markUntrusted(result) : result;
        } catch (err) {
            logger.error('agent', `Tool ${call.name} threw`, err);
            return { success: false, error: 'Tool execution failed.' };
        }
    }

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        const response = await adapter.send(conversation, opts, { forceText: false });

        if (response.toolCalls.length === 0) {
            if (!response.text) {
                logger.warn('agent', `${adapter.name} returned no text and no tool calls`, {
                    finishReason: response.finishReason,
                });
                throw new Error(
                    `${adapter.name} returned an empty response (finish reason: ${response.finishReason ?? 'unknown'})`
                );
            }
            // A cut-off answer stopped mid-sentence at the token cap; it isn't
            // finished. Returned as-is, a half-written table reached Discord
            // looking complete. Retry once if the adapter has a wider budget to
            // offer, otherwise flag it so the user is offered a continuation.
            if (response.truncated) {
                const retryOpts = retriedAfterTruncation ? null : adapter.onTruncated(opts);
                if (retryOpts) {
                    retriedAfterTruncation = true;
                    logger.warn(
                        'agent',
                        `${adapter.name} reply hit the token cap mid-answer — retrying with a wider budget`
                    );
                    opts = retryOpts;
                    continue;
                }
                logger.warn(
                    'agent',
                    `${adapter.name} reply was cut off at the token cap — returning it flagged for continuation`
                );
                return markTruncated(response.text);
            }
            return response.text;
        }

        const names = response.toolCalls.map((call) => call.name);
        opts = adapter.afterToolCalls(opts, names);
        logger.info(
            'agent',
            `${adapter.name} requested ${names.length} tool call(s): ${names.join(', ')}`
        );

        // Decided before any of the batch runs: a save that sits in the same turn as a
        // page read is no safer than one after it.
        if (names.some(isUntrustedSource)) readUntrusted = true;
        notifyProgress(context, names);

        // Parallel: several calls in one turn are usually independent network lookups.
        const results = await Promise.all(
            response.toolCalls.map(async (call) => ({ call, result: await runTool(call) }))
        );

        // Nudge the model once its budget is nearly spent, so it knows it can
        // ask for more rather than hitting the forced final answer below.
        const remaining = maxIterations - (iteration + 1);
        const note =
            remaining <= 2 && remaining >= 0
                ? `[System note: ${remaining} of ${maxIterations} tool calls remain for this message. If you still need to keep researching, call ${REQUEST_MORE_TOOL_CALLS} before you run out; otherwise wrap up with what you have.]`
                : null;
        adapter.appendToolResults(conversation, response, results, note);
    }

    // Out of tool calls without an answer. The work already done (and paid
    // for) shouldn't be thrown away: one last call with tools barred makes the
    // model answer with what it has.
    logger.warn(
        'agent',
        `Hit ${maxIterations} tool-call iterations without a final answer — forcing a text-only reply`
    );
    const final = await adapter.send(conversation, opts, { forceText: true });
    if (final.text) return final.text;
    logger.error(
        'agent',
        `${adapter.name} produced no final text even with tool calls disabled (finish reason: ${final.finishReason ?? 'unknown'})`
    );
    return GAVE_UP_REPLY;
}

module.exports = { runAgent };
