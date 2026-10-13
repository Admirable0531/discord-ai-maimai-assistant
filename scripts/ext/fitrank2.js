// Rank players: the lapse rate is set from the real Good rate (a lapse is a Good about half the time), then the timing noise scale is
// found so the Great rate matches the real runs.
//   node scripts/ext/fitrank2.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');
// real Great % and Good % per rank (Good from the S to SS+ runs; SSS and SSS+ taken as 0.35 of the Great rate)
const TARGET = {
    S: [3.11, 1.05],
    'S+': [2.13, 0.84],
    SS: [1.88, 0.66],
    'SS+': [1.3, 0.46],
    SSS: [0.51, 0.18],
    'SSS+': [0.22, 0.08],
};

async function main() {
    const metas = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((m) => m.rank && m.score >= 120 && (m.contrast ?? 2) >= 1.4);
    const charts = [];
    for (const m of metas)
        charts.push(buildChart((await getChartText(m.song, m.difficulty, m.type)).text).events);
    const rate = (f, lapse) => {
        let n = 0;
        let g = 0;
        let gd = 0;
        for (const ev of charts)
            for (let k = 0; k < 2; k++) {
                const r = simulate(
                    ev,
                    { ...STYLES.top, timeSigma: STYLES.top.timeSigma * f, lapse },
                    3 + k * 977
                );
                for (const o of r.outcomes.values()) {
                    n++;
                    if (o.grade === 1) g++;
                    else if (o.grade === 2) gd++;
                }
            }
        return [(100 * g) / n, (100 * gd) / n];
    };
    for (const [rank, [tg, td]] of Object.entries(TARGET)) {
        let lapse = (td / 100 / 0.5) * 0.8; // first guess
        let lo = 0.3;
        let hi = 3;
        let f = 1;
        let got = [0, 0];
        for (let it = 0; it < 7; it++) {
            f = (lo + hi) / 2;
            got = rate(f, lapse);
            if (got[0] < tg) lo = f;
            else hi = f;
        }
        // one correction of the lapse rate towards the Good target
        lapse *= td / Math.max(0.05, got[1]);
        for (let it = 0; it < 5; it++) {
            f = (lo + hi) / 2;
            got = rate(f, lapse);
            if (got[0] < tg) lo = f;
            else hi = f;
        }
        console.log(
            `${rank}: scale ${f.toFixed(2)} lapse ${lapse.toFixed(4)} -> Great ${got[0].toFixed(2)}% (target ${tg}) Good ${got[1].toFixed(2)}% (target ${td})`
        );
    }
}
main();
