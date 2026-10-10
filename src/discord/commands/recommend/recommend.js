const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { findCandidates } = require('../../../web/maimaiRatingTargets');
const { loadSnapshot, freshnessNote } = require('../../../web/maimaiPlayerSnapshot');
const { loadSongData } = require('../../../web/maimaiSongData');
const { TOKENS } = require('../../../render/theme');
const { denyWithoutScope, describeFailure, suggestPlayers } = require('../../commandHelpers');

const SHOWN_PER_SECTION = 8;
const DEFAULT_TARGET = 100.0;

function line(c) {
    return (
        `**${c.title}** (${c.type.toUpperCase()} ${c.difficulty.slice(0, 3).toUpperCase()} ${c.level.toFixed(1)}) — ` +
        `≥ ${c.needed.toFixed(4)}% · +${c.gain} at target`
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('recommend')
        .setDescription('Charts that would improve a best-50 at a score you can realistically hit')
        .addStringOption((opt) =>
            opt
                .setName('player')
                .setDescription("A friend's name — leave empty for the tracked account")
                .setAutocomplete(true)
        )
        .addNumberOption((opt) =>
            opt
                .setName('target')
                .setDescription(`The best achievement % you'd aim for (default ${DEFAULT_TARGET})`)
                .setMinValue(97)
                .setMaxValue(100.5)
        )
        .addStringOption((opt) =>
            opt
                .setName('section')
                .setDescription('Which half to fill (default: both)')
                .addChoices(
                    { name: 'Both', value: 'both' },
                    { name: 'New version (B15)', value: 'new' },
                    { name: 'Old versions (B35)', value: 'old' }
                )
        )
        .addStringOption((opt) =>
            opt
                .setName('sort')
                .setDescription('Easiest charts first (default), or the biggest gain first')
                .addChoices(
                    { name: 'Easiest first', value: 'easiest' },
                    { name: 'Biggest gain first', value: 'gain' }
                )
        ),

    autocomplete: suggestPlayers,

    async execute(interaction) {
        if (await denyWithoutScope(interaction, 'leaderboard', "players' ratings and scores"))
            return;
        await interaction.deferReply();

        const target = interaction.options.getNumber('target') ?? DEFAULT_TARGET;
        const section = interaction.options.getString('section') || 'both';
        const sort = interaction.options.getString('sort') || 'easiest';

        const snapshot = await loadSnapshot(interaction.options.getString('player') || undefined);
        if (!snapshot.success) {
            await interaction.editReply(describeFailure(snapshot));
            return;
        }
        let songs;
        try {
            songs = (await loadSongData()).songs;
        } catch (err) {
            await interaction.editReply(`Could not load the song list: ${err.message}`);
            return;
        }

        const { found, cutoffs } = findCandidates(songs, snapshot, target);
        const order =
            sort === 'gain'
                ? (a, b) => b.gain - a.gain || a.level - b.level
                : (a, b) => a.level - b.level || a.needed - b.needed;

        const embed = new EmbedBuilder()
            .setColor(parseInt(TOKENS.series1.slice(1), 16))
            .setTitle(`Charts worth trying — ${snapshot.player.name}`)
            .setDescription(
                `Charts that beat the lowest entry of the best 50 with a score of ${target}% or less ` +
                    `(${sort === 'gain' ? 'biggest gain' : 'easiest'} first). Your best 50 only lists charts that ` +
                    `count, so one you've already played below the cutoff can appear here.`
            )
            .setFooter({ text: freshnessNote(snapshot) });

        const sections = [
            ['new', `New version — beat ${cutoffs.new} (B15)`],
            ['old', `Old versions — beat ${cutoffs.old} (B35)`],
        ].filter(([key]) => section === 'both' || section === key);
        for (const [key, name] of sections) {
            const list = found[key].sort(order);
            embed.addFields({
                name: `${name} · ${list.length} chart${list.length === 1 ? '' : 's'}`.slice(0, 256),
                value:
                    list.slice(0, SHOWN_PER_SECTION).map(line).join('\n').slice(0, 1024) ||
                    `Nothing reaches that at ${target}% or less.`,
            });
        }
        await interaction.editReply({ embeds: [embed] });
    },
};
