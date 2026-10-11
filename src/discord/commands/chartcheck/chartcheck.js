const { SlashCommandBuilder } = require('discord.js');
const analyzeChart = require('../../../tools/analyzeMaimaiChart');
const { createOutputs } = require('../../../utils/outputs');
const { tooSoon, toAttachments, describeFailure, MAX_REPLY } = require('../../commandHelpers');

const DIFFICULTIES = [
    ['Expert', 'expert'],
    ['Master', 'master'],
    ['Re:Master', 'remaster'],
    ['Advanced', 'advanced'],
    ['Basic', 'basic'],
];
const SEVERITY = { 1: '🟡', 2: '🟠', 3: '🔴' };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chartcheck')
        .setDescription(
            'Where a chart splashes, changes rhythm or is hard to read (from the simai wiki)'
        )
        .addStringOption((opt) =>
            opt
                .setName('song')
                .setDescription('Exact song title as on the simai wiki')
                .setRequired(true)
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
        if (await tooSoon(interaction)) return;
        await interaction.deferReply();

        const outputs = createOutputs();
        const result = await analyzeChart.execute(
            {
                song_name: interaction.options.getString('song', true),
                difficulty: interaction.options.getString('difficulty') || 'master',
                chart_type: interaction.options.getString('type') || 'dx',
                as_image: true,
            },
            { outputs }
        );
        if (!result.success) {
            const available = result.available?.length
                ? ` Charts the wiki has for it: ${result.available.join(', ')}.`
                : '';
            await interaction.editReply(`${describeFailure(result)}${available}`);
            return;
        }

        const lines = [
            `**${result.song}** — ${result.difficulty} · ${result.length_seconds}s · ${result.total_findings} findings (top ${result.shown.length} below)`,
            ...result.shown.map(
                (f) =>
                    `${SEVERITY[f.severity] || '•'} bar ${f.bar} · ${f.time} · **${f.name}** — ${f.what}`
            ),
            '',
            '-# Risks read from the wiki chart data, not certainties; thresholds are not calibrated yet.',
        ];
        await interaction.editReply({
            content: lines.join('\n').slice(0, MAX_REPLY),
            files: toAttachments(outputs.files),
        });
    },
};
