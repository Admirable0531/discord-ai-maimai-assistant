// Reads a chart's fan-transcribed simai text (simai wiki) and lists where it
// is likely to splash, change rhythm or be hard to read. Findings are risks,
// not certainties, and the chart text is never returned.
const { getChartText } = require('../chart/simaiWiki');
const { buildChart } = require('../chart/chartModel');
const { analyse } = require('../chart/rules');
const { summarise } = require('../chart/report');

const declaration = {
    name: 'analyze_maimai_chart',
    description:
        'Analyse a maimai chart (from the simai wiki chart text) for tricky spots: splash risks (a touch ' +
        'beside a tap or hold, a slide passing or ending beside a note, two slides sharing a sensor), rhythm ' +
        'and BPM changes, bursts, jacks and fast neighbouring-button runs. Each finding has a bar, a time and a ' +
        'severity 1-3. For "what should I watch out for in this chart", "where does it splash", "what is hard ' +
        'about X". Findings are risks from the chart data, not certainties; thresholds are uncalibrated, so say ' +
        'so. The wiki only has some charts: if it reports none, say that. Never quote the chart text itself.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: { type: 'string', description: 'Exact song title as on the wiki' },
            difficulty: {
                type: 'string',
                enum: ['basic', 'advanced', 'expert', 'master', 'remaster'],
            },
            chart_type: { type: 'string', enum: ['dx', 'std'] },
        },
        required: ['song_name', 'difficulty'],
    },
};

async function execute(args) {
    const title = String(args?.song_name || '').trim();
    const difficulty = String(args?.difficulty || '').toLowerCase();
    const chartType = args?.chart_type === 'std' ? 'std' : 'dx';
    let found;
    try {
        found = await getChartText(title, difficulty, chartType);
    } catch (err) {
        return { success: false, error: `Could not reach the simai wiki: ${err.message}` };
    }
    if (!found.success) return found;

    let chart;
    try {
        chart = buildChart(found.text);
    } catch (err) {
        return {
            success: false,
            error: `The chart text could not be parsed (${err.name || 'error'}).`,
        };
    }
    const findings = analyse(chart);
    return {
        success: true,
        song: found.title,
        difficulty,
        chart_type: chartType,
        length_seconds: Math.round(chart.finish),
        ...summarise(findings),
        slides_not_covered: findings.unknownSlides || 0,
        notes: [
            'Fan transcription of the official chart; it may differ from the game.',
            'Thresholds are placeholders (splash window 150 ms) and slide timing assumes even travel.',
            'No tips are attached yet; describe the risk and let the player judge.',
            'Bar numbers assume 4 beats per bar.',
        ],
    };
}

module.exports = { declaration, execute };
