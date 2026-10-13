// Does the simulation find the places where real players got Greats? For every real video the rank's simulated player
// plays the chart 24 times; each note gets the share of runs in which it was not Perfect. The real Great notes are then
// ranked among all notes of the chart by that share (0.5 = no better than chance, 1 = always at the top).
//   node scripts/ext/validate2.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { monteCarlo, simulate } = require('../../src/sim/run');
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
    let metas = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((m) => m.rank && m.score >= 120 && (m.contrast ?? 2) >= 1.4);
    if (process.env.LIMIT) metas = metas.slice(0, Number(process.env.LIMIT));
    const scores = [];
    const byKind = {};
    for (const m of metas) {
        const chart = buildChart((await getChartText(m.song, m.difficulty, m.type)).text);
        const style = STYLES[RANKID[m.rank]];
        const notes = simulate(chart.events, style, 1).notes;
        const mc = monteCarlo(chart.events, style, Number(process.env.RUNS || 24), 11);
        const risk = new Map();
        for (const n of notes) {
            const s = mc.stats.get(n.id);
            risk.set(n.id, s ? 1 - s.grades[0] / s.n : 0);
        }
        const all = [...risk.values()];
        const rank = (r) =>
            (all.filter((x) => x < r).length + 0.5 * all.filter((x) => x === r).length) /
            all.length;
        const great = JSON.parse(fs.readFileSync(path.join(DIR, `${m.id}.great.json`))).filter(
            (g) => g.matched && g.matched.distance <= 0.45
        );
        for (const g of great) {
            const k = g.matched;
            const cand = notes.find(
                (n) =>
                    n.kind === k.kind &&
                    Math.abs(n.t - k.time) < 0.03 &&
                    (!n.lane || `L${n.lane}` === k.key || k.kind === 'slide')
            );
            if (!cand) continue;
            const p = rank(risk.get(cand.id));
            scores.push(p);
            (byKind[k.kind] = byKind[k.kind] || []).push(p);
        }
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    console.log(
        `${scores.length} real Greats from ${metas.length} videos: mean rank among the chart's notes ${mean(scores).toFixed(3)} (0.5 = chance)`
    );
    for (const [k, v] of Object.entries(byKind))
        console.log(' ', k.padEnd(9), v.length, mean(v).toFixed(3));
}
main();
