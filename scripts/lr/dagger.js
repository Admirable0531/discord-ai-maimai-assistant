// Imitation learning that corrects for its own mistakes (DAgger).
//
// A model trained only on the human's own situations meets different ones once it plays: after one
// wrong hand, the "what each hand did last" inputs no longer look like a person's. Here the planner
// plays each video's chart with the current model, the situations it actually reaches are labelled
// with the hand the human used, added to the data, and the forest is trained again.
//
//   node scripts/lr/dagger.js [rounds] [heldOut]   heldOut: how many videos to keep out to measure (default 4)
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');
const { FEATURES } = require('../../src/sim/handFeatures');
const { fitForest } = require('../../src/sim/ml');
const { withHands } = require('./summary');
const { rowsOf, classOf } = require('./train');

const DIR = path.join(__dirname, '..', '..', 'data', 'lr');
// FOREST=1: the 12-tree forest (more accurate); otherwise ONE readable tree of TREE_DEPTH levels
const FOREST = process.env.FOREST === '1';
const OPTS = FOREST
    ? { features: FEATURES, depth: 8, minLeaf: 25, trees: 12 }
    : { features: FEATURES, depth: Number(process.env.TREE_DEPTH) || 5, minLeaf: 40, trees: 1 };
const OUT = FOREST ? 'handModel.json' : 'handRules.json';

async function load() {
    const files = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.json') && !f.includes('capture') && f !== 'run.log');
    const out = [];
    for (const f of files) {
        const v = JSON.parse(fs.readFileSync(path.join(DIR, f)));
        if (!v.notes || !v.song) continue;
        const found = await getChartText(v.song, v.difficulty, v.type);
        const chart = buildChart(found.text);
        const human = new Map();
        for (const h of withHands(v))
            human.set(
                `${classOf(h.kind)}@${Math.round(h.time * 1000)}@${h.lane || h.sensor || h.head}`,
                h.hand === 'R' ? 1 : 0
            );
        const labels = new Map();
        chart.events.forEach((e, i) => {
            const where =
                e.kind === 'slide'
                    ? e.head
                    : e.lane || (e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`);
            const h = human.get(`${classOf(e.kind)}@${Math.round(e.time * 1000)}@${where}`);
            if (h !== undefined) labels.set(i, h);
        });
        out.push({ video: v, events: chart.events, labels });
    }
    return out;
}

/** Plays a chart with `model`; returns the situations met (labelled with the human's hand) and the agreement. */
function play(item, model, seed) {
    const record = [];
    const style = {
        ...STYLES.expert,
        posSigma: 0,
        timeSigma: 0,
        record,
        model: { forest: model, features: FEATURES },
    };
    const r = simulate(item.events, style, seed);
    let hit = 0;
    let n = 0;
    const hands = new Map();
    for (const s of r.strokes) if (s.role !== 'transit') hands.set(s.id, s.hand);
    for (const [i, h] of item.labels) {
        if (!hands.has(i)) continue;
        n++;
        if (hands.get(i) === h) hit++;
    }
    const rows = record
        .filter((x) => item.labels.has(x.id))
        .map((x) => ({ y: item.labels.get(x.id), x: x.x }));
    return { rows, hit, n };
}

async function main() {
    const rounds = Number(process.argv[2]) || 3;
    const heldOut = Number(process.argv[3]) || 4;
    const items = await load();
    const test = items
        .filter((_, i) => i % Math.floor(items.length / Math.max(1, heldOut)) === 0)
        .slice(0, heldOut);
    const train = items.filter((i) => !test.includes(i));
    console.log(
        `${train.length} videos to learn from, ${test.length} held out: ${test.map((t) => t.video.song.slice(0, 14)).join(', ')}`
    );
    let data = [];
    for (const it of train) data.push(...(await rowsOf(it.video)));
    let forest = fitForest(data, OPTS);
    const measure = (label) => {
        let hit = 0;
        let n = 0;
        for (const it of test) {
            const r = play(it, forest, 5);
            hit += r.hit;
            n += r.n;
        }
        console.log(
            `${label}: closed-loop agreement on the held-out videos ${((hit / n) * 100).toFixed(1)}% (${n} notes)`
        );
    };
    // for comparison: the old rule-based habits and the plain "right half = right hand" rule
    let rh = 0;
    let rn = 0;
    let sh = 0;
    for (const it of test) {
        const r = simulate(
            it.events,
            { ...STYLES.expert, posSigma: 0, timeSigma: 0, policy: 'rules' },
            5
        );
        const hands = new Map();
        for (const st of r.strokes) if (st.role !== 'transit') hands.set(st.id, st.hand);
        for (const [i, h] of it.labels) {
            if (!hands.has(i)) continue;
            rn++;
            if (hands.get(i) === h) rh++;
            const e = it.events[i];
            const lane = e.lane || e.head;
            const x = lane ? Math.sin(((22.5 + 45 * (lane - 1)) * Math.PI) / 180) : 0;
            if ((x > 0 ? 1 : 0) === h) sh++;
        }
    }
    console.log(
        `baselines on the same notes: rule-based habits ${((rh / rn) * 100).toFixed(1)}%, right half = right hand ${((sh / rn) * 100).toFixed(1)}%`
    );
    measure('round 0 (human situations only)');
    for (let round = 1; round <= rounds; round++) {
        const extra = [];
        for (const it of train) extra.push(...play(it, forest, 5 + round).rows);
        data = data.concat(extra);
        forest = fitForest(data, OPTS);
        measure(`round ${round} (+${extra.length} situations the planner reached)`);
    }
    // final model on every video
    const all = [];
    for (const it of items) all.push(...(await rowsOf(it.video)));
    let full = fitForest(all, OPTS);
    for (let round = 1; round <= rounds; round++) {
        const extra = [];
        for (const it of items) extra.push(...play(it, full, 5 + round).rows);
        all.push(...extra);
        full = fitForest(all, OPTS);
    }
    fs.writeFileSync(
        path.join(__dirname, '..', '..', 'src', 'sim', OUT),
        JSON.stringify({
            features: FEATURES,
            forest: full,
            videos: items.length,
            notes: all.length,
            dagger: rounds,
        })
    );
    console.log(`model written: ${items.length} videos, ${all.length} rows after ${rounds} rounds`);
}

main();
