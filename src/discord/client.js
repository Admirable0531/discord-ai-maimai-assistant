const { Client, GatewayIntentBits, Partials } = require('discord.js');

/**
 * MessageContent is a privileged intent — it must also be turned on for this
 * bot application in the Discord Developer Portal (Bot -> Privileged Gateway
 * Intents), or every message.content the bot receives will be empty.
 */
function createDiscordClient() {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
            // Reactions drive "continue a reply that hit the output limit"
            // (see messageHandler) — without these the ▶️ is never delivered.
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.DirectMessageReactions,
        ],
        // Reaction/Message partials matter because the message being reacted
        // to is usually older than the current cache, especially after a
        // restart — without them the event arrives with nothing usable on it.
        partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    });
}

module.exports = { createDiscordClient };
