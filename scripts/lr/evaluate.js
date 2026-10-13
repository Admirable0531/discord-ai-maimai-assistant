// Does the hand model hold up on a video it was not trained on (another player, another chart)?
//   node scripts/lr/evaluate.js <aligned.json> "<song>" <difficulty> <dx|std>
const fs = require('fs');
const { rowsOf } = require('./train');
const { analyse } = require('./summary');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { withHands } = require('./summary');
const { FEATURES } = require('../../src/sim/handFeatures');
const { predictForest } = require('../../src/sim/ml');

const classOf = (k) => (k === 'break' ? 'tap' : k === 'touchHold' ? 'touch' : k);

async function main() {
    const [file, song, difficulty, type = 'dx'] = process.argv.slice(2);
    const video = { ...JSON.parse(fs.readFileSync(file)), song, difficulty, type };
    const rows = await rowsOf(video);
    const forest = require('../../src/sim/handModel.json');
    const rules = require('../../src/sim/handRules.json');
    const acc = (model) =>
        rows.filter((r) => (predictForest(model.forest, r.x, FEATURES) > 0.5 ? 1 : 0) === r.y)
            .length / rows.length;
    const side = rows.filter((r) => (r.x[4] > 0 ? 1 : 0) === r.y).length / rows.length;
    console.log(`${song}: ${rows.length} notes with a clear hand`);
    console.log("given the human's earlier moves (no mistakes carried over):");
    console.log(
        `  readable rules (default) ${(acc(rules) * 100).toFixed(1)}%   forest ${(acc(forest) * 100).toFixed(1)}%   "right half = right hand" ${(side * 100).toFixed(1)}%`
    );
    // closed loop: the simulated player plays the chart and its hand is compared with the human's
    const found = await getChartText(song, difficulty, type);
    const chart = buildChart(found.text);
    const human = new Map();
    for (const h of withHands(video))
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
    console.log('when the simulated player plays the chart itself:');
    for (const [name, policy] of [
        ['readable rules (default)', 'logic'],
        ['forest', 'learned'],
        ['old habits', 'rules'],
    ]) {
        let hit = 0;
        let n = 0;
        for (let k = 0; k < 3; k++) {
            const r = simulate(
                chart.events,
                { ...STYLES.expert, policy, posSigma: 0, timeSigma: 0 },
                5 + k * 7919
            );
            for (const s of r.strokes) {
                if (s.role === 'transit' || !labels.has(s.id)) continue;
                n++;
                if (s.hand === labels.get(s.id)) hit++;
            }
        }
        console.log(`  ${name.padEnd(26)} ${((hit / n) * 100).toFixed(1)}%`);
    }
    const t = analyse([{ ...video, notes: video.notes }]);
    const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');
    console.log(
        `this video: crossing ${pct(t.cross.all, t.cross.n)} (training videos 20.8%), slide set off by the other hand than the star ${pct(t.handoff.diff, t.handoff.n)} (22.3%), simultaneous notes split ${pct(t.pair.split, t.pair.n)} (89.6%), consecutive taps on different hands ${pct(t.alternate.switch, t.alternate.n)} (54.1%)`
    );
    console.log(
        `holds: left ${t.byKind.hold ? pct(t.byKind.hold.L, t.byKind.hold.L + t.byKind.hold.R) : 'n/a'} (training videos 20%)`
    );
}

main();
