// Finds, for each rank, how much the top simulated player's timing noise and lapses must be scaled to get the real runs' Great rate.
//   node scripts/ext/fitrank.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');
const TARGET = { S: 3.11, 'S+': 2.13, SS: 1.88, 'SS+': 1.3, SSS: 0.51, 'SSS+': 0.22 };

async function main() {
    const metas = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((m) => m.rank && m.score >= 120 && (m.contrast ?? 2) >= 1.4);
    const charts = [];
    for (const m of metas)
        charts.push(buildChart((await getChartText(m.song, m.difficulty, m.type)).text).events);
    const rate = (f) => {
        let n = 0;
        let g = 0;
        let b = 0;
        for (const ev of charts)
            for (let k = 0; k < 3; k++) {
                const r = simulate(
                    ev,
                    {
                        ...STYLES.top,
                        timeSigma: STYLES.top.timeSigma * f,
                        lapse: STYLES.top.lapse * f,
                    },
                    3 + k * 977
                );
                for (const o of r.outcomes.values()) {
                    n++;
                    if (o.grade === 1) g++;
                    else if (o.grade > 1) b++;
                }
            }
        return [(100 * g) / n, (100 * b) / n];
    };
    const grid = [];
    for (const f of [0.6, 0.8, 1, 1.25, 1.5, 1.8, 2.1, 2.5, 3]) {
        const [g, b] = rate(f);
        grid.push([f, g, b]);
        console.log(`scale ${f}: Greats ${g.toFixed(2)}%  Good/Miss ${b.toFixed(2)}%`);
    }
    for (const [rank, t] of Object.entries(TARGET)) {
        let i = 0;
        while (i < grid.length - 2 && grid[i + 1][1] < t) i++;
        const [f0, g0] = grid[i];
        const [f1, g1] = grid[i + 1];
        const f = f0 + ((t - g0) / (g1 - g0 || 1)) * (f1 - f0);
        console.log(`${rank}: target Greats ${t}% -> scale about ${f.toFixed(2)}`);
    }
}
main();
