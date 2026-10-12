// Reads a chart's fan-transcribed simai text (simai wiki) and lists where it
// is likely to splash, change rhythm or be hard to read. Findings are risks,
// not certainties, and the chart text is never returned.
const { getChartText } = require('../chart/simaiWiki');
const { buildChart } = require('../chart/chartModel');
const { analyse } = require('../chart/rules');
const { summarise, pickFindings, formatTime } = require('../chart/report');
const { buildViewerHtml } = require('../chart/viewerPage');
const { simulate } = require('../sim/service');
const { agreement } = require('../sim/report');
const { DEFAULT_STYLE_IDS } = require('../sim/styles');
const { attachFile } = require('../utils/outputs');
const { drawCard } = require('../render/drawCard');
const { buildChartMomentHtml, WIDTH } = require('../render/chartMomentCard');

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
            as_page: {
                type: 'boolean',
                description:
                    'Also attach a self-contained HTML page of the whole chart (density timeline, play/scrub sensor ring, all findings). Use for "the full chart" or when many moments matter.',
            },
            simulate: {
                type: 'boolean',
                description:
                    'Also play the chart with virtual hands (full buttons, fingertips, dragging fingers, palm slides, big-hand touch, mixed) and report where an input meant for one note hits or blocks another, with a chance per play style. Takes several seconds. Use for "would a palm slide splash here", "which play style avoids this".',
            },
            as_image: {
                type: 'boolean',
                description:
                    'Also draw the most severe moments as pictures of the sensor ring (notes, slide paths, millisecond offsets) and attach them to the reply.',
            },
        },
        required: ['song_name', 'difficulty'],
    },
};

async function execute(args, context) {
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
    const result = {
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
    if (args?.simulate === true) {
        try {
            const sim = await simulate(`tool:${found.id}:${difficulty}`, chart.events, {
                styleIds: DEFAULT_STYLE_IDS,
                runs: 12,
            });
            result.simulation = {
                styles: sim.styles.map((x) => x.label),
                spots_found: sim.spots.length,
                strongest: [...sim.spots]
                    .sort((a, b) => b.p - a.p)
                    .slice(0, 6)
                    .map((x) => ({ at: formatTime(x.t), bar: x.bar, chance: x.p, what: x.text })),
                rules_confirmed: agreement(findings, sim.spots),
                note: 'Virtual hands with estimated sizes and speeds, not real data; chances rank spots and compare play styles.',
            };
        } catch (err) {
            result.simulation_error = err.message;
        }
    }
    if (args?.as_page === true) {
        const page = buildViewerHtml({
            title: found.title,
            difficulty,
            events: chart.events,
            finish: chart.finish,
            findings,
            tempoChanges: chart.tempoChanges,
        });
        const attached = attachFile(context, {
            name: `${found.title.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'chart'}-${difficulty}.html`,
            data: Buffer.from(page, 'utf8'),
        });
        if (attached.ok) {
            result.page_attached = true;
            result.page_note =
                'A chart page (open the attached .html in a browser) is attached; tell the user it has the full timeline, play and scrub, and every finding.';
        } else {
            result.page_error = attached.reason;
        }
    }
    if (args?.as_image === true) {
        // Findings within 0.3 s are one moment: one picture, all their sentences.
        const moments = [];
        for (const f of pickFindings(
            findings.filter((x) => x.rule[0] === 'A'),
            { limit: 8, perRule: 3 }
        )) {
            const same = moments.find((m) => Math.abs(m.time - f.time) <= 0.3);
            if (same) {
                same.severity = Math.max(same.severity, f.severity);
                same.text += ` ${f.text}`;
            } else if (moments.length < 3) {
                moments.push({ ...f, clock: formatTime(f.time) });
            }
        }
        const drawn = await drawCard(context, {
            html: buildChartMomentHtml({
                title: found.title,
                difficulty,
                events: chart.events,
                findings: moments,
            }),
            width: WIDTH,
            filename: 'chart-check.png',
        });
        if (drawn.ok) {
            result.image_attached = true;
            result.image_note =
                "The picture of the top moments is attached automatically and you can't see it; add a short comment and don't re-list them.";
        } else {
            result.image_error = drawn.error;
        }
    }
    return result;
}

module.exports = { declaration, execute };
