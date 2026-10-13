// Touches that lie on the path of a slide being played: how does the simulated player do on them, and the real ones?
//   node scripts/ext/slidetouch.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');
const { slideTracks } = require('../../src/chart/slidePaths');

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
    const real = [0, 0];
    const sim = {};
    for (const m of metas) {
        const chart = buildChart((await getChartText(m.song, m.difficulty, m.type)).text);
        const slides = chart.events.filter((e) => e.kind === 'slide');
        const onPath = new Set();
        chart.events.forEach((e, i) => {
            if (e.kind !== 'touch') return;
            const name = e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`;
            for (const s of slides) {
                if (e.time < s.start - 0.05 || e.time > s.end + 0.05) continue;
                const tr = slideTracks(s);
                if (tr && tr[0].some((step) => step.includes(name))) onPath.add(i);
            }
        });
        const got = new Set(
            JSON.parse(fs.readFileSync(path.join(DIR, `${m.id}.great.json`)))
                .filter(
                    (g) => g.matched && g.matched.kind === 'touch' && g.matched.distance <= 0.45
                )
                .map((g) => `${g.matched.key}@${g.matched.time}`)
        );
        chart.events.forEach((e, i) => {
            if (!onPath.has(i)) return;
            real[1]++;
            const name = e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`;
            if (got.has(`${name}@${Math.round(e.time * 1000) / 1000}`)) real[0]++;
        });
        for (let k = 0; k < 3; k++) {
            const r = simulate(chart.events, STYLES[RANKID[m.rank]], 3 + k * 977);
            for (const n of r.notes) {
                if (n.kind !== 'touch') continue;
                const o = r.outcomes.get(n.id);
                const key = onPath.has(n.id) ? 'on a slide path' : 'other touches';
                const b = (sim[key] = sim[key] || { n: 0, kinds: {} });
                b.n++;
                const lab = o.grade === 0 ? 'perfect' : o.grade === 1 ? 'great' : o.kind;
                b.kinds[lab] = (b.kinds[lab] || 0) + 1;
            }
        }
    }
    console.log('real touches on a slide path:', real[1], 'notes,', real[0], 'Greats');
    for (const [k, v] of Object.entries(sim)) console.log('sim', k, v.n, JSON.stringify(v.kinds));
}
main();
