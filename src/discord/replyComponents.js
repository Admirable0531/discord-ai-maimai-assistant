// The buttons under the bot's replies. Ids are namespaced ("atri:") so the
// interaction router (componentRouter.js) can tell them from other
// components; what each one does lives in replyButtons.js.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const IDS = {
    continue: 'atri:continue',
    stop: 'atri:stop',
    regenerate: 'atri:regen',
    up: 'atri:fb:up',
    down: 'atri:fb:down',
};

/** ▶️ Continue / ⏹️ Stop, under the notice for an answer that hit the output limit. */
function continueRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(IDS.continue)
            .setLabel('Continue')
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(IDS.stop)
            .setLabel('Stop here')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Secondary)
    );
}

/** 🔄 Regenerate (when the question is still around to ask again) and 👍 / 👎, under a finished answer. */
function answerRow({ canRegenerate }) {
    const row = new ActionRowBuilder();
    if (canRegenerate) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(IDS.regenerate)
                .setLabel('Regenerate')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary)
        );
    }
    row.addComponents(
        new ButtonBuilder().setCustomId(IDS.up).setEmoji('👍').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(IDS.down).setEmoji('👎').setStyle(ButtonStyle.Secondary)
    );
    return row;
}

module.exports = { IDS, continueRow, answerRow };
