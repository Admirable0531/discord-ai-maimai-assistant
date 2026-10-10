// Discord's typing indicator lasts ~10s and isn't auto-refreshed — a single
// sendTyping() before a multi-tool-call generateReply() (which can easily run
// longer than that) expires mid-work, so it looks like Atri gave up until the
// reply suddenly appears. Re-trigger it on an interval, comfortably under the
// 10s expiry, for as long as the work is in flight.
const TYPING_REFRESH_MS = 8000;

/** Runs `work()` with the channel's typing indicator kept alive until it settles. */
async function whileTyping(channel, work) {
    const interval = setInterval(() => channel.sendTyping().catch(() => {}), TYPING_REFRESH_MS);
    try {
        await channel.sendTyping().catch(() => {});
        return await work();
    } finally {
        clearInterval(interval);
    }
}

module.exports = { whileTyping };
