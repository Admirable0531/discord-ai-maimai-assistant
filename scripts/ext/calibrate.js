// Compares the simulation's Great rates (by how crowded the music is, and for touches) with the real SSS runs.
//   node scripts/ext/calibrate.js '[{"style":"expert","stressNoise":0.3}, ...]'
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');
const BINS = [
    [0, 4],
    [4, 6],
    [6, 8],
    [8, 99],
];
const REAL = [0.22, 0.23, 0.43, 1.11];

async function main() {
    const metas = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((m) => m.score >= 80);
    metas.push(
        { song: 'LiftOff', difficulty: 'master', type: 'dx' },
        { song: 'Paradisoda', difficulty: 'master', type: 'dx' }
    );
    const charts = [];
    for (const m of metas)
        charts.push(buildChart((await getChartText(m.song, m.difficulty, m.type)).text));
    for (const cfg of JSON.parse(process.argv[2] || '[{"style":"expert"}]')) {
        const { style: id, ...over } = cfg;
        const bins = BINS.map(() => [0, 0]);
        const touch = [0, 0];
        let great = 0;
        let bad = 0;
        let notes = 0;
        for (const chart of charts) {
            for (let k = 0; k < 6; k++) {
                const r = simulate(chart.events, { ...STYLES[id], ...over }, 3 + k * 977);
                const times = [...new Set(r.notes.map((n) => Math.round(n.t * 500)))].sort(
                    (a, b) => a - b
                );
                const near = (t) => {
                    const c = Math.round(t * 500);
                    let n = 0;
                    for (const x of times) if (Math.abs(x - c) <= 250) n++;
                    return n;
                };
                for (const n of r.notes) {
                    const o = r.outcomes.get(n.id);
                    if (!o) continue;
                    const d = near(n.t);
                    const bi = BINS.findIndex(([lo, hi]) => d >= lo && d < hi);
                    bins[bi][1]++;
                    notes++;
                    if (o.grade === 1) {
                        bins[bi][0]++;
                        great++;
                    } else if (o.grade > 1) bad++;
                    if (n.kind === 'touch') {
                        touch[1]++;
                        if (o.grade === 1) touch[0]++;
                    }
                }
            }
        }
        const pct = (a) => ((100 * a[0]) / (a[1] || 1)).toFixed(2);
        console.log(
            JSON.stringify(cfg),
            `| Greats ${((100 * great) / notes).toFixed(2)}% (real 0.36), Good/Miss ${((100 * bad) / notes).toFixed(2)}%`,
            `| by crowd ${bins.map(pct).join(' / ')} (real ${REAL.join(' / ')}) | touch ${pct(touch)} (real 1.07)`
        );
    }
}
main();
