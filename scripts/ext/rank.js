// Great rates of real runs by rank (and by how crowded the music is), and the simulated levels next to them.
//   node scripts/ext/rank.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { judged } = require('./align');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');
const MIN_YELLOW = 120;
const MAX_OFF = 0.45;

async function main() {
    const metas = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((m) => m.score >= MIN_YELLOW && (m.contrast ?? 2) >= 1.4);
    for (const [id, song] of [
        ['tfSN2a3WlpM', 'LiftOff'],
        ['lkmt2q25WJg', 'Paradisoda'],
    ])
        metas.push({ id, song, difficulty: 'master', type: 'dx', rank: 'SSS', score: 999 });
    const real = {};
    const simLevels = process.argv[2]
        ? process.argv[2].split(',')
        : ['top', 'expert', 'advanced', 'intermediate'];
    const sim = {};
    for (const m of metas) {
        const gp = path.join(DIR, `${m.id}.great.json`);
        if (!fs.existsSync(gp)) continue;
        const chart = buildChart((await getChartText(m.song, m.difficulty, m.type)).text);
        const notes = judged(chart).length;
        const greats = JSON.parse(fs.readFileSync(gp)).filter(
            (g) => g.matched && g.matched.distance <= MAX_OFF
        ).length;
        const r = (real[m.rank] = real[m.rank] || { videos: 0, notes: 0, greats: 0, per: [] });
        r.videos++;
        r.notes += notes;
        r.greats += greats;
        r.per.push((100 * greats) / notes);
        for (const id of simLevels) {
            const s = (sim[id] = sim[id] || { notes: 0, greats: 0, bad: 0 });
            for (let k = 0; k < 4; k++) {
                const run = simulate(chart.events, STYLES[id], 3 + k * 977);
                for (const o of run.outcomes.values()) {
                    s.notes++;
                    if (o.grade === 1) s.greats++;
                    else if (o.grade > 1) s.bad++;
                }
            }
        }
    }
    console.log('real runs (Great labels only):');
    for (const k of ['S', 'S+', 'SS', 'SS+', 'SSS', 'SSS+']) {
        const r = real[k];
        if (!r) continue;
        const per = r.per.sort((a, b) => a - b);
        console.log(
            ' ',
            k.padEnd(5),
            `${r.videos} videos, ${r.notes} notes, Greats ${((100 * r.greats) / r.notes).toFixed(2)}% (per video ${per[0].toFixed(1)} to ${per[per.length - 1].toFixed(1)}%, median ${per[Math.floor(per.length / 2)].toFixed(2)}%)`
        );
    }
    console.log('simulated levels on the same charts:');
    for (const id of simLevels) {
        const s = sim[id];
        console.log(
            ' ',
            id.padEnd(13),
            `Greats ${((100 * s.greats) / s.notes).toFixed(2)}%  Good/Miss ${((100 * s.bad) / s.notes).toFixed(2)}%`
        );
    }
}
main();
