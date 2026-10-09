const util = require('util');

function timestamp() {
    return new Date().toISOString();
}

// Extra destinations for warnings and errors (see utils/discordLog.js).
const sinks = [];

/** Also send every warn/error line to `sink(level, text)`. The sink must not log through this module. */
function addSink(sink) {
    sinks.push(sink);
}

function log(writer, level, scope, message, meta) {
    const line = `[${timestamp()}] [${scope}] ${message}`;
    if (meta !== undefined) writer(line, meta);
    else writer(line);
    if (level === 'info' || sinks.length === 0) return;
    // Same rendering console uses, so an Error meta keeps its message and stack.
    const text =
        meta !== undefined
            ? `[${scope}] ${message} ${util.inspect(meta, { depth: 3 })}`
            : `[${scope}] ${message}`;
    for (const sink of sinks) {
        try {
            sink(level, text);
        } catch {
            // A broken sink must never take logging (or the caller) down with it.
        }
    }
}

function info(scope, message, meta) {
    log(console.log, 'info', scope, message, meta);
}

function warn(scope, message, meta) {
    log(console.warn, 'warn', scope, message, meta);
}

function error(scope, message, meta) {
    log(console.error, 'error', scope, message, meta);
}

module.exports = { info, warn, error, addSink };
