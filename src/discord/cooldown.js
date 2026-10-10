// One per-user reply cooldown shared by every way of asking the bot something
// (an @mention, /ask). In memory on purpose — it is a throttle, not state.

/** userId -> last accepted request (ms). */
const lastRequestAtByUser = new Map();

/** True if this user asked too recently; otherwise records now as their latest request and returns false. */
function onCooldown(userId, cooldownMs) {
    const last = lastRequestAtByUser.get(userId);
    if (last !== undefined && Date.now() - last < cooldownMs) return true;
    lastRequestAtByUser.set(userId, Date.now());
    return false;
}

module.exports = { onCooldown };
