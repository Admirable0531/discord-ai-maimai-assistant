// Caps how much of one tool result reaches the model. Tool results were
// passed through whole, so one large result (every score at a level, a long
// page, 15 songs with note counts) could take most of a request's context —
// paid for on every later round trip of the same message, and enough to
// crowd out the answer. Above the cap the result is cut down, keeping its
// shape where possible: the largest arrays lose items from the end and the
// longest strings are shortened, each with a note of what was dropped, so the
// model knows it saw part of the data and can narrow the query.

const MIN_ARRAY_ITEMS = 3;
const MIN_STRING_CHARS = 500;

function size(value) {
    return JSON.stringify(value)?.length ?? 0;
}

/** The biggest array or string in the result's top two levels, as {holder, key}. */
function findLargest(result) {
    let best = null;
    const consider = (holder, key) => {
        const value = holder[key];
        const shrinkable =
            (Array.isArray(value) && value.length > MIN_ARRAY_ITEMS) ||
            (typeof value === 'string' && value.length > MIN_STRING_CHARS);
        if (!shrinkable) return;
        const s = size(value);
        if (!best || s > best.size) best = { holder, key, size: s };
    };
    for (const key of Object.keys(result)) {
        consider(result, key);
        const value = result[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const inner of Object.keys(value)) consider(value, inner);
        }
    }
    return best;
}

/**
 * `result` if it serializes to at most `maxChars`, otherwise a reduced copy
 * with `_truncated` notes. Never throws; a result that can't be shrunk
 * structurally falls back to a cut JSON string.
 */
function capToolResult(result, maxChars) {
    const original = size(result);
    if (original <= maxChars || !result || typeof result !== 'object') return result;

    // Tool results are plain JSON, so a JSON round trip is a full deep copy.
    const copy = JSON.parse(JSON.stringify(result));
    // What each shrunk field held originally, so the note reports the real
    // total even after a field is halved more than once.
    const cuts = new Map(); // holder -> Map(key -> {originalLength, isArray})
    for (let i = 0; i < 50 && size(copy) > maxChars; i++) {
        const largest = findLargest(copy);
        if (!largest) break;
        const { holder, key } = largest;
        const value = holder[key];
        if (!cuts.has(holder)) cuts.set(holder, new Map());
        if (!cuts.get(holder).has(key)) {
            cuts.get(holder).set(key, { originalLength: value.length, isArray: Array.isArray(value) });
        }
        if (Array.isArray(value)) {
            holder[key] = value.slice(0, Math.max(MIN_ARRAY_ITEMS, Math.floor(value.length / 2)));
        } else {
            const keep = Math.max(MIN_STRING_CHARS, Math.floor(value.length / 2));
            holder[key] = `${value.slice(0, keep)}…`;
        }
    }

    const note =
        `Result was ${original} characters, over the ${maxChars}-character limit, so it was cut down. ` +
        'Narrow the request (filters, a specific section or level) if what you need may be in the part left out.';
    if (size(copy) <= maxChars) {
        const cut = [];
        for (const [holder, fields] of cuts) {
            for (const [key, { originalLength, isArray }] of fields) {
                cut.push(
                    isArray
                        ? `${key}: showing ${holder[key].length} of ${originalLength}`
                        : `${key}: cut to ${holder[key].length - 1} of ${originalLength} characters`
                );
            }
        }
        return { ...copy, _truncated: { note, cut } };
    }
    return {
        _truncated: { note },
        partial_json: JSON.stringify(result).slice(0, Math.max(0, maxChars - 400)),
    };
}

module.exports = { capToolResult };
