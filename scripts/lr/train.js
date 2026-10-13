// Learns which hand a player uses from the L. R. breakdown videos.
//
//   node scripts/lr/train.js [dir]      writes src/sim/handModel.json
//
// For every labelled note the state of the two hands (what each did last, whether it is holding or
// sliding, how far it is from the note), the shape of the moment (how many notes at once, left to
// right order) and the recent pattern are the inputs; the hand is the answer. A forest of trees is
// fitted and judged by leaving one video out at a time.
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { withHands } = require('./summary');
const { FEATURES, featurize, newState, apply, noteXY } = require('../../src/sim/handFeatures');
const { fitForest, predictForest } = require('../../src/sim/ml');

const DIR = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'lr');
const classOf = (k) => (k === 'break' ? 'tap' : k === 'touchHold' ? 'touch' : k);

/** Rows for one video: events in time order with their hand, features seen before each note is played. */
async function rowsOf(video) {
    const found = await getChartText(video.song, video.difficulty, video.type);
    if (!found.success) return [];
    const chart = buildChart(found.text);
    const labelled = withHands(video);
    const key = (kind, time, where) => `${classOf(kind)}@${Math.round(time * 1000)}@${where}`;
    const hands = new Map();
    for (const n of labelled)
        hands.set(key(n.kind, n.time, n.lane || n.sensor || n.head), n.hand === 'R' ? 1 : 0);
    const events = chart.events.filter((e) => e.kind !== 'slide' || e.start !== undefined);
    const rows = [];
    const state = newState();
    for (let i = 0; i < events.length;) {
        let j = i + 1;
        while (j < events.length && Math.abs(events[j].time - events[i].time) < 0.002) j++;
        const group = events.slice(i, j);
        for (const e of group) {
            const where =
                e.kind === 'slide'
                    ? e.head
                    : e.lane || (e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`);
            const h = hands.get(key(e.kind, e.time, where));
            if (h === undefined) continue;
            rows.push({ y: h, x: featurize(e, state, group), t: e.time, title: video.song });
            apply(state, e, h);
        }
        i = j;
    }
    return rows;
}

const accuracy = (forest, rows) => {
    let ok = 0;
    for (const r of rows) if ((predictForest(forest, r.x, FEATURES) > 0.5 ? 1 : 0) === r.y) ok++;
    return ok / rows.length;
};

async function main() {
    const files = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.json') && !f.includes('capture') && f !== 'run.log');
    const videos = files
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((v) => v.notes && v.song);
    const all = [];
    for (const v of videos) {
        const rows = await rowsOf(v);
        console.log(`${v.song.slice(0, 30).padEnd(30)} ${rows.length} labelled notes`);
        all.push({ title: v.song, rows });
    }
    const opts = { features: FEATURES, depth: 8, minLeaf: 25, trees: 12 };
    // leave one video out
    let hit = 0;
    let total = 0;
    let sideHit = 0;
    let lastHit = 0;
    for (const held of all) {
        const train = all.filter((v) => v !== held).flatMap((v) => v.rows);
        const forest = fitForest(train, opts);
        const acc = accuracy(forest, held.rows);
        const side =
            held.rows.filter((r) => (r.x[4] > 0 ? 1 : 0) === r.y).length / held.rows.length;
        const prev =
            held.rows.filter((r) => (r.x[13] === 0.5 ? r.x[4] > 0 : 1 - r.x[13]) == r.y).length /
            held.rows.length;
        console.log(
            `  held out ${held.title.slice(0, 26).padEnd(26)} forest ${(acc * 100).toFixed(1)}%  by side ${(side * 100).toFixed(1)}%  swap hand each note ${(prev * 100).toFixed(1)}%`
        );
        hit += acc * held.rows.length;
        sideHit += side * held.rows.length;
        lastHit += prev * held.rows.length;
        total += held.rows.length;
    }
    console.log(
        `leave-one-video-out: forest ${((hit / total) * 100).toFixed(1)}%, by side ${((sideHit / total) * 100).toFixed(1)}%, alternate ${((lastHit / total) * 100).toFixed(1)}% over ${total} notes`
    );
    const forest = fitForest(
        all.flatMap((v) => v.rows),
        opts
    );
    fs.writeFileSync(
        path.join(__dirname, '..', '..', 'src', 'sim', 'handModel.json'),
        JSON.stringify({ features: FEATURES, forest, videos: all.length, notes: total })
    );
    console.log(`model written: ${all.length} videos, ${total} notes`);
}

if (require.main === module) main();
