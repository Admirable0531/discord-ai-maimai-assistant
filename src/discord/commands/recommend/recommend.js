const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getSongRating, findMinAchvForRating } = require('../../../web/maimaiRatingMath');
const { loadSnapshot, chartKey, freshnessNote } = require('../../../web/maimaiPlayerSnapshot');
const { loadSongData } = require('../../../web/maimaiSongData');
const { isUtageSong } = require('../../../web/maimaiChartLookup');
const { TOKENS } = require('../../../render/theme');
const { denyWithoutScope, describeFailure, suggestPlayers } = require('../../commandHelpers');

const SHOWN_PER_SECTION = 8;
const NEW_COUNT = 15;
const OLD_COUNT = 35;
const DIFFICULTIES = new Set(['expert', 'master', 'remaster']);
const DEFAULT_TARGET = 100.0;

/** "CiRCLE+" (rating pages) and "CiRCLE PLUS" (song data) are the same version. */
function versionKey(version) {
    return String(version || '')
        .toLowerCase()
        .replace(/\+/g, ' plus')
        .replace(/\s+/g, ' ')
        .trim();
}

/** The rating a new chart has to beat to enter this list: the lowest in it, or 0 while the list isn't full yet. */
function cutoff(plays, size) {
    return plays.length >= size ? Math.min(...plays.map((p) => p.rating)) : 0;
}

/**
 * Charts that would displace the lowest entry of the B15 / B35 at a score no
 * higher than `target`, skipping charts already in the best 50. The chart's own
 * score is unknown (only the best 50 is stored), so one the player has
 * already played below the cutoff can show up — it is "worth trying", not
 * "unplayed".
 */
function findCandidates(songs, snapshot, target) {
    const newVersions = new Set(snapshot.newPlays.map((p) => versionKey(p.version)));
    const inBest = new Set(
        [...snapshot.newPlays, ...snapshot.oldPlays].map((p) =>
            chartKey(p.song, p.chartType, p.difficulty)
        )
    );
    const cutoffs = {
        new: cutoff(snapshot.newPlays, NEW_COUNT),
        old: cutoff(snapshot.oldPlays, OLD_COUNT),
    };
    const found = { new: [], old: [] };

    for (const song of songs) {
        if (isUtageSong(song)) continue;
        for (const sheet of song.sheets || []) {
            const level = sheet.internalLevelValue;
            if (!DIFFICULTIES.has(sheet.difficulty) || !Number.isFinite(level)) continue;
            if (sheet.regions?.intl === false) continue; // the tracked account is on the international game
            if (inBest.has(chartKey(song.title, sheet.type, sheet.difficulty))) continue;

            const version = sheet.regionOverrides?.intl?.version || song.version;
            const section = newVersions.has(versionKey(version)) ? 'new' : 'old';
            const need = findMinAchvForRating(level, cutoffs[section] + 1);
            if (!need || need.achv_needed > target) continue;

            const atTarget = getSongRating(level, target)?.rating ?? 0;
            found[section].push({
                title: song.title,
                type: sheet.type,
                difficulty: sheet.difficulty,
                level,
                needed: need.achv_needed,
                gain: atTarget - cutoffs[section],
            });
        }
    }
    return { found, cutoffs };
}

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
