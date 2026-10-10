// DeepSeek sometimes writes a tool call as text in its own markup instead of
// using the API's structured tool_calls field, e.g.
//
//   <｜｜DSML｜｜ calls>
//   <｜｜DSML｜｜ invoke name="request_more_tool_calls">
//   <｜｜DSML｜｜ parameter name="reason" string="true">Need more steps</｜｜DSML｜｜ parameter>
//   </｜｜DSML｜｜ invoke>
//   </｜｜DSML｜｜ calls>
//
// The adapter used to see "text, no tool calls" and the agent loop returned
// that text as the final answer, so the raw markup was posted to Discord.
// This reads the markup into the calls it stands for. The delimiters have
// varied (one or two full-width bars, a space or no space before the tag
// name), so the match is deliberately loose; `string="false"` marks a value
// that is JSON rather than a string.

const BAR = '[｜|]+';
const TAG = new RegExp(`<\\s*(/?)\\s*${BAR}\\s*DSML\\s*${BAR}\\s*([a-z_]+)\\b([^>]*)>`, 'gi');
const ATTRIBUTE = /([a-z_]+)\s*=\s*"([^"]*)"/gi;

/** True if `text` contains any of this markup. (A fresh non-global regex: a global one keeps its position between calls.) */
function hasDsml(text) {
    return typeof text === 'string' && new RegExp(TAG.source, 'i').test(text);
}

function attributes(source) {
    const found = {};
    for (const [, key, value] of source.matchAll(ATTRIBUTE)) found[key.toLowerCase()] = value;
    return found;
}

/** A parameter's text as the value it stands for: JSON when string="false", else the string. */
function parameterValue(raw, isString) {
    if (isString !== 'false') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/**
 * {calls: [{name, args}], text} — the tool calls written in `content`, and
 * what is left of it once all the markup is removed. A call with no readable
 * name is dropped.
 */
function extractDsml(content) {
    const source = String(content || '');
    const events = [...source.matchAll(TAG)].map((m) => ({
        closing: m[1] === '/',
        tag: m[2].toLowerCase(),
        attrs: attributes(m[3]),
        start: m.index,
        end: m.index + m[0].length,
    }));

    const calls = [];
    let current = null;
    let param = null;
    for (const event of events) {
        if (event.tag === 'invoke' && !event.closing) {
            current = { name: event.attrs.name || '', args: {} };
        } else if (event.tag === 'invoke' && event.closing) {
            if (current?.name) calls.push(current);
            current = null;
        } else if (event.tag === 'parameter' && !event.closing) {
            param = { name: event.attrs.name, isString: event.attrs.string, from: event.end };
        } else if (event.tag === 'parameter' && event.closing && param && current) {
            if (param.name) {
                current.args[param.name] = parameterValue(
                    source.slice(param.from, event.start).trim(),
                    param.isString
                );
            }
            param = null;
        }
    }

    // What is left to say: the text outside every invoke block. If the markup was
    // malformed and produced no call, nothing after its first tag can be trusted
    // to be prose (it may be orphaned parameter values), so only what came before it stays.
    let text;
    if (calls.length === 0) {
        text = events.length > 0 ? source.slice(0, events[0].start) : source;
    } else {
        text = '';
        let cursor = 0;
        let depth = 0;
        for (const event of events) {
            if (depth === 0) text += source.slice(cursor, event.start);
            if (event.tag === 'invoke') depth += event.closing ? -1 : 1;
            cursor = event.end;
        }
        if (depth === 0) text += source.slice(cursor);
    }
    return { calls, text: text.replace(/\n{3,}/g, '\n\n').trim() };
}

module.exports = { hasDsml, extractDsml };
