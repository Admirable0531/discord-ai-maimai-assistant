// Do the notes where real players got a GREAT (events.js) match the notes the simulation finds risky?
//
//   node scripts/ext/validate.js <id> "<song>" <difficulty> <dx|std> [style ids...]
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { monteCarlo, simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');
const RUNS = 60;

async function validate(id, song, difficulty, type, styleIds) {
    const chart = buildChart((await getChartText(song, difficulty, type)).text);
    const great = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.great.json`)));
    const out = {};
    for (const sid of styleIds) {
        const style = STYLES[sid];
        const notes = simulate(chart.events, style, 1).notes;
        const mc = monteCarlo(chart.events, style, RUNS, 11);
        const risk = new Map();
        for (const n of notes) {
            const s = mc.stats.get(n.id);
            risk.set(n.id, s ? 1 - s.grades[0] / s.n : 0);
        }
        const all = [...risk.values()].sort((a, b) => a - b);
        const rankOf = (r) => all.filter((x) => x < r).length / all.length;
        const hits = [];
        for (const e of great) {
            if (!e.matched) continue;
            const m = e.matched;
            const cand = notes.filter(
                (n) =>
                    n.kind === m.kind &&
                    Math.abs(n.t - m.time) < 0.03 &&
                    (!n.lane || `L${n.lane}` === m.key || m.kind === 'slide')
            );
            if (!cand.length) continue;
            const r = risk.get(cand[0].id);
            hits.push({ time: m.time, kind: m.kind, key: m.key, risk: r, percentile: rankOf(r) });
        }
        const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
        out[sid] = {
            notes: notes.length,
            meanRiskAll: mean(all),
            greats: hits.length,
            meanRiskGreats: mean(hits.map((h) => h.risk)),
            meanPercentile: mean(hits.map((h) => h.percentile)),
            hits,
        };
    }
    return out;
}

module.exports = { validate };

if (require.main === module) {
    const [id, song, diff, type, ...styles] = process.argv.slice(2);
    validate(id, song, diff, type || 'dx', styles.length ? styles : ['expert', 'advanced']).then(
        (r) => console.log(JSON.stringify(r, null, 1))
    );
}
