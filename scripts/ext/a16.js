// Taps on a slide's start lane shortly after the slide sets off (rule A16): how often did real players and the simulation get a Great there?
//   node scripts/ext/a16.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');

async function main() {
    const metas = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((m) => m.score >= 80);
    metas.push(
        { id: 'tfSN2a3WlpM', song: 'LiftOff', difficulty: 'master', type: 'dx' },
        { id: 'lkmt2q25WJg', song: 'Paradisoda', difficulty: 'master', type: 'dx' }
    );
    const real = { flagged: [0, 0], other: [0, 0] };
    const sim = { flagged: [0, 0], other: [0, 0] };
    for (const m of metas) {
        const chart = buildChart((await getChartText(m.song, m.difficulty, m.type)).text);
        const slides = chart.events.filter((e) => e.kind === 'slide');
        const flag = (t, lane) =>
            slides.some(
                (s) =>
                    s.head === lane &&
                    t - s.start >= -0.06 &&
                    t - s.start <= 0.14 &&
                    t >= s.time + 0.001
            );
        const great = JSON.parse(fs.readFileSync(path.join(DIR, `${m.id}.great.json`)));
        const got = new Set(
            great
                .filter((g) => g.matched && g.matched.kind === 'tap' && g.matched.distance <= 0.45)
                .map((g) => `${g.matched.key}@${g.matched.time}`)
        );
        for (const e of chart.events) {
            if (e.kind !== 'tap') continue;
            const bin = flag(e.time, e.lane) ? 'flagged' : 'other';
            real[bin][1]++;
            if (got.has(`L${e.lane}@${Math.round(e.time * 1000) / 1000}`)) real[bin][0]++;
        }
        for (let k = 0; k < 8; k++) {
            const r = simulate(chart.events, STYLES[process.argv[2] || 'top'], 3 + k * 977);
            for (const n of r.notes) {
                if (n.kind !== 'tap') continue;
                const o = r.outcomes.get(n.id);
                const bin = flag(n.t, n.lane) ? 'flagged' : 'other';
                sim[bin][1]++;
                if (o && o.grade === 1) sim[bin][0]++;
            }
        }
    }
    const f = (a) => `${a[0]} of ${a[1]} = ${((100 * a[0]) / (a[1] || 1)).toFixed(2)}%`;
    console.log(
        'real  taps on a slide start lane:',
        f(real.flagged),
        '| other taps:',
        f(real.other)
    );
    console.log('sim   taps on a slide start lane:', f(sim.flagged), '| other taps:', f(sim.other));
}
main();
