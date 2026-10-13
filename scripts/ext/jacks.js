// Greats on taps that repeat the same lane within 140 ms (jacks): real runs against the simulated player of the same rank.
//   node scripts/ext/jacks.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');
const RANKID = {
    S: 'rankS',
    'S+': 'rankSp',
    SS: 'rankSS',
    'SS+': 'rankSSp',
    SSS: 'rankSSS',
    'SSS+': 'rankSSSp',
};

async function main() {
    const metas = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((m) => m.rank && m.score >= 120 && (m.contrast ?? 2) >= 1.4);
    const real = { jack: [0, 0], other: [0, 0] };
    const sim = { jack: [0, 0], other: [0, 0] };
    const simDetail = {};
    for (const m of metas) {
        const chart = buildChart((await getChartText(m.song, m.difficulty, m.type)).text);
        const taps = chart.events.filter((e) => e.kind === 'tap' || e.kind === 'break');
        const jackOf = new Set();
        for (const e of taps)
            if (
                taps.some(
                    (x) =>
                        x !== e &&
                        x.lane === e.lane &&
                        e.time - x.time > 0.002 &&
                        e.time - x.time < 0.14
                )
            )
                jackOf.add(e);
        const got = new Set(
            JSON.parse(fs.readFileSync(path.join(DIR, `${m.id}.great.json`)))
                .filter(
                    (g) => g.matched && g.matched.kind !== 'slide' && g.matched.distance <= 0.45
                )
                .map((g) => `${g.matched.key}@${g.matched.time}`)
        );
        for (const e of taps) {
            const b = jackOf.has(e) ? 'jack' : 'other';
            real[b][1]++;
            if (got.has(`L${e.lane}@${Math.round(e.time * 1000) / 1000}`)) real[b][0]++;
        }
        for (let k = 0; k < 3; k++) {
            const r = simulate(
                chart.events,
                {
                    ...STYLES[RANKID[m.rank]],
                    ...(process.env.DRIFT ? { timeDrift: Number(process.env.DRIFT) } : {}),
                },
                3 + k * 977
            );
            for (const n of r.notes) {
                if (n.kind !== 'tap') continue;
                const e = chart.events[n.id];
                const b = jackOf.has(e) ? 'jack' : 'other';
                const o = r.outcomes.get(n.id);
                sim[b][1]++;
                if (o && o.grade === 1) {
                    sim[b][0]++;
                    if (b === 'jack') simDetail[o.kind] = (simDetail[o.kind] || 0) + 1;
                }
            }
        }
    }
    const f = (a) => `${a[0]} of ${a[1]} = ${((100 * a[0]) / a[1]).toFixed(2)}%`;
    console.log('real jack taps', f(real.jack), '| other taps', f(real.other));
    console.log(
        'sim  jack taps',
        f(sim.jack),
        '| other taps',
        f(sim.other),
        '| jack Greats by cause',
        JSON.stringify(simDetail)
    );
}
main();
