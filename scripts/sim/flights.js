// How far do hands travel to reach a note while the other hand is idle and nearer? (what a viewer sees as a hand "flying")
//   node scripts/sim/flights.js "<song>" <difficulty> <dx|std> [style]
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');
const { noteXY } = require('../../src/sim/handFeatures');

async function main() {
    const [song, diff, type, styleId] = process.argv.slice(2);
    const chart = buildChart((await getChartText(song, diff, type || 'dx')).text);
    const r = simulate(chart.events, STYLES[styleId || 'rankSS'], 5, { record: true });
    const strokes = r.strokes.filter((s) => s.role !== 'transit').sort((a, b) => a.t0 - b.t0);
    const pos = (s) => {
        const n = chart.events[s.id];
        return noteXY(n);
    };
    const last = [null, null];
    const stats = { notes: 0, far: 0, farWhileOtherNearerIdle: 0 };
    const examples = [];
    for (const s of strokes) {
        const p = pos(s);
        const mine = last[s.hand];
        const other = last[1 - s.hand];
        if (mine) {
            stats.notes++;
            const d = Math.hypot(p[0] - mine.p[0], p[1] - mine.p[1]);
            const idle = (h) => h && h.end < s.t0 - 0.03;
            const dOther = other ? Math.hypot(p[0] - other.p[0], p[1] - other.p[1]) : 9;
            if (d > Number(process.env.FAR || 1.1) && s.t0 - mine.end > 0.05) {
                stats.far++;
                if (idle(other) && dOther < d * 0.6) {
                    stats.farWhileOtherNearerIdle++;
                    if (examples.length < 12)
                        examples.push(
                            `${chart.events[s.id].kind} at ${s.t0.toFixed(2)}s hand ${s.hand ? 'R' : 'L'} travels ${d.toFixed(2)} R while the other hand (idle ${(s.t0 - other.end).toFixed(2)} s) is ${dOther.toFixed(2)} R away; gap ${(s.t0 - mine.end).toFixed(2)} s`
                        );
                }
            }
        }
        last[s.hand] = { p, end: s.t1 };
    }
    console.log(JSON.stringify(stats));
    console.log(examples.join('\n'));
}
main();
