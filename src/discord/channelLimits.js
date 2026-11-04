// Servers where Atri only works in certain channels. A server that isn't listed
// here is unrestricted.
const CHANNEL_LIMITS = {
    '1077575390635237396': ['1277972707782299680', '1533808934538973357'],
};

/**
 * Whether Atri may answer in this channel. A thread counts as its parent
 * channel, so threads under an allowed channel still work.
 */
function isChannelAllowed(guildId, channel, limits = CHANNEL_LIMITS) {
    const allowed = guildId && limits[guildId];
    if (!allowed) return true;
    const channelId = channel?.id ?? channel;
    const parentId = channel?.parentId;
    return allowed.includes(channelId) || (!!parentId && allowed.includes(parentId));
}

module.exports = { CHANNEL_LIMITS, isChannelAllowed };
