const { SlashCommandBuilder } = require('discord.js');
const chartPreview = require('../../../tools/getMaimaiChartPreview');
const { createOutputs } = require('../../../utils/outputs');
const { tooSoon, toAttachments, describeFailure, MAX_REPLY } = require('../../commandHelpers');

const DIFFICULTIES = [
    ['Basic', 'basic'],
    ['Advanced', 'advanced'],
    ['Expert', 'expert'],
    ['Master', 'master'],
    ['Re:Master', 'remaster'],
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('preview')
        .setDescription("A song's cover, chart details and where to watch the chart")
        .addStringOption((opt) =>
            opt.setName('song').setDescription('Song title or nickname').setRequired(true)
        )
        .addStringOption((opt) =>
            opt
                .setName('difficulty')
                .setDescription('Which chart (default: Master)')
                .addChoices(...DIFFICULTIES.map(([name, value]) => ({ name, value })))
        )
        .addStringOption((opt) =>
            opt
                .setName('type')
                .setDescription('DX or standard chart (default: DX)')
                .addChoices({ name: 'DX', value: 'dx' }, { name: 'Standard', value: 'std' })
        ),

    async execute(interaction) {
        // Public song data, so no scope — but it runs a web search and fetches an image.
        if (await tooSoon(interaction)) return;
        await interaction.deferReply();

        const outputs = createOutputs();
        const result = await chartPreview.execute(
            {
                song: interaction.options.getString('song', true),
                difficulty: interaction.options.getString('difficulty') || undefined,
                type: interaction.options.getString('type') || undefined,
            },
            { outputs }
        );
        if (!result.success) {
            await interaction.editReply(
                result.matches
                    ? `${result.error}\n${result.matches.map((m) => `• ${m.title} — ${m.artist}`).join('\n')}`.slice(
                          0,
                          MAX_REPLY
                      )
                    : describeFailure(result)
            );
            return;
        }

        const c = result.chart;
        const best = result.videos.find((v) => v.title_matches);
        const lines = [
            `**${result.title}** — ${result.artist} · BPM ${result.bpm}`,
            `${c.type.toUpperCase()} ${c.difficulty} ${c.level}${c.constant ? ` (${c.constant})` : ''}${c.note_designer && c.note_designer !== '-' ? ` · ${c.note_designer}` : ''}${c.notes ? ` · ${c.notes.total} notes` : ''}`,
        ];
        // A bare URL on its own line is what makes Discord embed the video.
        if (best) lines.push('', best.url);
        else lines.push('', `No matching video found — search: <${result.youtube_search_url}>`);
        if (result.remywiki_url) lines.push(`RemyWiki: <${result.remywiki_url}>`);
        await interaction.editReply({
            content: lines.join('\n').slice(0, MAX_REPLY),
            files: toAttachments(outputs.files),
        });
    },
};
