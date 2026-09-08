// Shared vocabulary for "the model stopped mid-answer because it hit the
// output-token cap", so the providers that detect it and the Discord layer
// that reacts to it agree on one marker instead of sniffing for a magic
// string in two places.
//
// Why this happens often enough to need handling: DeepSeek bills reasoning
// tokens against the SAME max_tokens budget as the visible answer, and
// reasoning_effort is raised to "max" for the tools whose output needs real
// interpretation. A long per-constant table (a dozen rows of CJK song names)
// asked for right after a dozen heavy tool calls can therefore run out of
// budget on reasoning before much text is written — the answer stops in the
// middle of a row, which previously reached Discord looking finished.
const TRUNCATION_MARKER = '…(cut off — react ▶️ to continue)';

/** Appends the marker. Providers call this instead of returning a cut-off answer as if it were whole. */
function markTruncated(text) {
    return `${text}\n\n${TRUNCATION_MARKER}`;
}

/** True if a reply ended mid-answer at the token cap. */
function isTruncated(text) {
    return typeof text === 'string' && text.trimEnd().endsWith(TRUNCATION_MARKER);
}

/** The prompt used to pick an answer back up where it was cut off. */
const CONTINUE_PROMPT =
    'Your previous reply was cut off at the output limit. Continue it from exactly where it stopped — ' +
    'pick up mid-item if it stopped mid-item, and do not repeat anything you already sent or re-introduce ' +
    'the answer. If it was a list or table, just carry on with the remaining rows.';

module.exports = { TRUNCATION_MARKER, markTruncated, isTruncated, CONTINUE_PROMPT };
