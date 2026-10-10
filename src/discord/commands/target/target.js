const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getSongRating, findMinAchvForRating } = require('../../../web/maimaiRatingMath');
const { loadSnapshot, freshnessNote } = require('../../../web/maimaiPlayerSnapshot');
const { TOKENS } = require('../../../render/theme');
const { denyWithoutScope, describeFailure, suggestPlayers } = require('../../commandHelpers');

const SHOWN = 10;
const RATING_CAP = 100.5;

/**
 * For each chart in the best 50: the achievement that would add one rating
 * point to it, and how far that is from the score now. Each chart's rating
 * counts straight into the total, so +1 on any of them is +1 overall — the
 * cheapest ones are where to spend the next attempts.
 */
function nextPointTargets(plays, section) {
    const targets = [];
    for (const play of plays) {
        const now = getSongRating(play.level, play.achievement);
        if (!now) continue;
        const next = findMinAchvForRating(play.level, now.rating + 1);
        if (!next || next.achv_needed > RATING_CAP) continue; // maxed out at this constant
        const gap = next.achv_needed - play.achievement;
        if (gap <= 0) continue;
        targets.push({ play, section, now: now.rating, needed: next.achv_needed, gap });
    }
    return targets;
}

function line(t) {
    const { play } = t;
    const diff = play.difficulty.slice(0, 3).toUpperCase();
    return (
        `**${play.song}** (${play.chartType.toUpperCase()} ${diff} ${play.level.toFixed(1)}) — ` +
        `${play.achievement.toFixed(4)}% → **${t.needed.toFixed(4)}%** ` +
        `(+${t.gap.toFixed(4)}) · ${t.now}→${t.now + 1}`
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('target')
        .setDescription('The cheapest scores to push for +1 rating, from a best-50')
        .addStringOption((opt) =>
            opt
                .setName('player')
                .setDescription("A friend's name — leave empty for the tracked account")
                .setAutocomplete(true)
        ),

    autocomplete: suggestPlayers,

    async execute(interaction) {
        if (await denyWithoutScope(interaction, 'leaderboard', "players' ratings and scores"))
            return;
        await interaction.deferReply();

        const snapshot = await loadSnapshot(interaction.options.getString('player') || undefined);
        if (!snapshot.success) {
            await interaction.editReply(describeFailure(snapshot));
            return;
        }

        const targets = [
            ...nextPointTargets(snapshot.newPlays, 'B15'),
            ...nextPointTargets(snapshot.oldPlays, 'B35'),
        ].sort((a, b) => a.gap - b.gap);
        if (targets.length === 0) {
            await interaction.editReply(
                `${snapshot.player.name} has nothing left to squeeze out of the current best 50.`
            );
            return;
        }

        const top = targets.slice(0, SHOWN);
        const embed = new EmbedBuilder()
            .setColor(parseInt(TOKENS.series1.slice(1), 16))
            .setTitle(`Cheapest +1s — ${snapshot.player.name}`)
            .setDescription(
                top.map((t, i) => `${i + 1}. ${line(t)}`).join('\n') +
                    `\n\nEvery chart in the best 50 counts straight into the total, so each of these is +1 rating. ` +
                    `${targets.length} of ${snapshot.newPlays.length + snapshot.oldPlays.length} charts can still gain a point.`
            )
            .setFooter({ text: freshnessNote(snapshot) });
        await interaction.editReply({ embeds: [embed] });
    },
};
