// The final message gets its own output-token budget, separate from the one
// the tool-calling rounds run under.
//
// Why the split: DeepSeek bills reasoning tokens against the SAME max_tokens
// budget as the visible answer, and reasoning_effort is raised to "max" for
// the tools whose output needs real interpretation. A long per-constant table
// (a dozen rows of CJK song names) asked for right after a dozen heavy tool
// calls therefore ran out of budget on reasoning before much text was
// written. Sharing one budget between "decide what to do next" and "write the
// answer" means the research phase can starve the answer; giving the answer
// its own budget — spent with tool calls off and reasoning turned down,
// because by then the work left is composition, not thinking — means the
// message is sized on its own terms.
//
// When even that budget runs out, the caller is handed the partial text plus
// a resume() to spend a bigger one, rather than a half-written answer
// dressed up as a finished one. Nothing partial goes to Discord unless the
// person who asked chooses it (see discord/messageHandler.js).

// Deliberately larger than either provider's tool-phase cap: this is spent
// once per message, only when an answer actually needed the room.
const ANSWER_MAX_OUTPUT_TOKENS = Number(process.env.ANSWER_MAX_OUTPUT_TOKENS) || 8192;
// Absolute ceiling across all continuations of one answer. Each ▶️ doubles
// the budget, so this bounds what one Discord message can ever cost even if
// someone keeps tapping the reaction.
const ANSWER_MAX_OUTPUT_TOKENS_CEILING =
    Number(process.env.ANSWER_MAX_OUTPUT_TOKENS_CEILING) || 32768;

/**
 * The next rung of the answer budget ladder, or null when the current budget
 * is already at the ceiling (nothing left to offer — the caller then has only
 * "send me what you have" to fall back on).
 */
function nextAnswerBudget(currentBudget) {
    if (!currentBudget || currentBudget < ANSWER_MAX_OUTPUT_TOKENS) return ANSWER_MAX_OUTPUT_TOKENS;
    if (currentBudget >= ANSWER_MAX_OUTPUT_TOKENS_CEILING) return null;
    return Math.min(currentBudget * 2, ANSWER_MAX_OUTPUT_TOKENS_CEILING);
}

/** The prompt used to pick an answer back up from exactly where the cap stopped it. */
const CONTINUE_PROMPT =
    'Your previous reply was cut off at the output limit. Continue it from exactly where it stopped — ' +
    'pick up mid-item (even mid-word) if it stopped mid-item, and do not repeat anything you already sent ' +
    'or re-introduce the answer. If it was a list or table, just carry on with the remaining rows. Write ' +
    'the remaining content only, with no preamble.';

/**
 * Glues a continuation onto the text it picks up from without inventing a
 * seam: the cut can land mid-word ("14.1" + ": HYP3RTRIBE"), so the chunk's
 * own leading whitespace — or absence of it — is the only correct joint.
 */
function joinContinuation(accumulated, chunk) {
    if (!chunk) return accumulated;
    if (!accumulated) return chunk.trimStart();
    return `${accumulated}${chunk.trimEnd()}`;
}

/**
 * The provider contract (see ai/agent.js). Every generateReply resolves to
 * one of these two shapes instead of a bare string, so the Discord layer can
 * tell a finished answer from one that ran out of room without sniffing the
 * text for a marker.
 */
function completeAnswer(text) {
    return { text, complete: true, budget: null, resume: null };
}

/**
 * @param text  what the model managed to write before the cap (possibly '')
 * @param budget  the answer budget that attempt ran under
 * @param resume  (nextBudget) => Promise<Answer>, continuing from `text`
 */
function partialAnswer(text, { budget, resume }) {
    return { text, complete: false, budget, resume };
}

module.exports = {
    ANSWER_MAX_OUTPUT_TOKENS,
    ANSWER_MAX_OUTPUT_TOKENS_CEILING,
    nextAnswerBudget,
    CONTINUE_PROMPT,
    joinContinuation,
    completeAnswer,
    partialAnswer,
};
