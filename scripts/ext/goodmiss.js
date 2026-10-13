// GOOD (green text with a tag) and MISS (grey text) labels per rank, from the second capture (data/ext_goodmiss).
//   node scripts/ext/goodmiss.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { judged } = require('./align');
const { labelEvents, applyRing } = require('./events');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');
const GM = path.join(__dirname, '..', '..', 'data', 'ext_goodmiss');

async function main() {
    const rows = {};
    for (const f of fs.readdirSync(GM).filter((x) => x.endsWith('.lab.json'))) {
        const id = f.replace('.lab.json', '');
        const meta = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.meta.json`)));
        const cap = applyRing(JSON.parse(fs.readFileSync(path.join(GM, f))), meta.ring);
        const notes = judged(
            buildChart((await getChartText(meta.song, meta.difficulty, meta.type)).text)
        ).length;
        const good = labelEvents(cap, 100, 10, 6, true).filter((e) => Math.hypot(e.x, e.y) > 0.5);
        const miss = labelEvents(cap, Number(process.env.MISS_MIN || 100), 10, 7, false).filter(
            (e) => Math.hypot(e.x, e.y) > 0.5 && Math.hypot(e.x, e.y) < 1.15
        );
        const great = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.great.json`))).filter(
            (g) => g.matched && g.matched.distance <= 0.45
        ).length;
        const r = (rows[meta.rank] = rows[meta.rank] || {
            videos: 0,
            notes: 0,
            good: 0,
            miss: 0,
            great: 0,
        });
        r.videos++;
        r.notes += notes;
        r.good += good.length;
        r.miss += miss.length;
        r.great += great;
        console.log(
            id,
            meta.rank,
            meta.song.slice(0, 20).padEnd(20),
            `great ${great} good ${good.length} miss-candidates ${miss.length} of ${notes}`
        );
    }
    for (const [rank, r] of Object.entries(rows))
        console.log(
            rank.padEnd(4),
            `${r.videos} videos, ${r.notes} notes: Great ${((100 * r.great) / r.notes).toFixed(2)}%  Good ${((100 * r.good) / r.notes).toFixed(2)}%  Miss ${((100 * r.miss) / r.notes).toFixed(2)}%`
        );
}
main();
