const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const searchSongs = require('../../../tools/searchMaimaiSongs');
const { loadSongData } = require('../../../web/maimaiSongData');
const { findSongByTitle } = require('../../../web/maimaiChartLookup');
const { coverUrl, TOKENS } = require('../../../render/theme');

const DIFFICULTY_LABELS = {
    basic: 'BAS',
    advanced: 'ADV',
    expert: 'EXP',
    master: 'MAS',
    remaster: 'REM',
};
const MAX_LISTED = 10;

/** One monospaced row per chart: type, difficulty, level, constant, note count, charter. */
function chartTable(charts) {
    const rows = charts.map((chart) => {
        const diff =
            DIFFICULTY_LABELS[chart.difficulty] ||
            String(chart.difficulty).slice(0, 3).toUpperCase();
        const charter =
            chart.noteDesigner && chart.noteDesigner !== '-' ? chart.noteDesigner.slice(0, 16) : '';
        return [
            String(chart.type || '')
                .toUpperCase()
                .padEnd(3),
            diff.padEnd(3),
            String(chart.level).padEnd(4),
            String(chart.internalLevel ?? '?').padEnd(5),
            String(chart.notes?.total ?? '').padStart(4),
            charter,
        ]
            .join(' ')
            .trimEnd();
    });
    return `\`\`\`\nTYP DIF LV   CONST NOTE CHARTER\n${rows.join('\n')}\n\`\`\``;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('song')
        .setDescription('Look up a maimai song: levels, exact constants, BPM, note counts')
        .addStringOption((opt) =>
            opt
                .setName('query')
                .setDescription('Title, artist, nickname or romanised title')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();
        const result = await searchSongs.execute({
            query: interaction.options.getString('query', true),
        });

        if (!result.success) {
            await interaction.editReply(result.error);
            return;
        }
        if (result.songs.length === 0) {
            await interaction.editReply(
                'No song found. Try another spelling, a nickname, or the title in romaji (for example "apoc").'
            );
            return;
        }

        const embed = new EmbedBuilder().setColor(parseInt(TOKENS.series1.slice(1), 16));

        if (result.songs.length > 1) {
            const listed = result.songs.slice(0, MAX_LISTED);
            embed
                .setTitle(`${result.songs.length}${result.truncated ? '+' : ''} songs match`)
                .setDescription(
                    listed.map((s) => `• **${s.title}** — ${s.artist}`).join('\n') +
                        '\n\nRun `/song` again with the exact title for its charts.'
                );
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        const song = result.songs[0];
        const intl = song.intl_version ? ` (International: ${song.intl_version})` : '';
        embed
            .setTitle(song.title)
            .setDescription(`${song.artist} · ${song.category}`)
            .addFields(
                { name: 'BPM', value: String(song.bpm ?? '?'), inline: true },
                { name: 'Version', value: `${song.version}${intl}`, inline: true },
                { name: 'Released', value: song.releaseDate || '?', inline: true },
                { name: 'Charts', value: chartTable(song.charts) }
            );
        if (song.matched_via) embed.setFooter({ text: `Matched via ${song.matched_via}` });

        // The cover isn't part of the search result; look it up the way the cards do.
        try {
            const { songs } = await loadSongData();
            const cover = coverUrl(findSongByTitle(songs, song.title)?.imageName);
            if (cover) embed.setThumbnail(cover);
        } catch {
            // No cover is fine.
        }
        await interaction.editReply({ embeds: [embed] });
    },
};
