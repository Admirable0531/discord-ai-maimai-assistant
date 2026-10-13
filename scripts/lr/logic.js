// How well do the written rules (src/sim/handLogic.js) reproduce the hands in the videos?
//   node scripts/lr/logic.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { withHands } = require('./summary');
const { newState, apply, noteXY } = require('../../src/sim/handFeatures');
const { chooseHand } = require('../../src/sim/handLogic');

const DIR = path.join(__dirname, '..', '..', 'data', 'lr');
const classOf = (k) => (k === 'break' ? 'tap' : k === 'touchHold' ? 'touch' : k);

async function main() {
    const files = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.json') && !f.includes('capture') && f !== 'run.log');
    let hit = 0;
    let n = 0;
    const reasons = {};
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
        const events = chart.events;
        const state = newState();
        let vh = 0;
        let vn = 0;
        for (let i = 0; i < events.length;) {
            let j = i + 1;
            while (j < events.length && Math.abs(events[j].time - events[i].time) < 0.002) j++;
            const group = events.slice(i, j);
            for (const e of group) {
                const where =
                    e.kind === 'slide'
                        ? e.head
                        : e.lane || (e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`);
                const h = human.get(`${classOf(e.kind)}@${Math.round(e.time * 1000)}@${where}`);
                if (h === undefined) continue;
                // notes still to come while this one lasts, by side
                const until = e.kind === 'slide' ? e.end : e.end || e.time;
                const ahead = { left: 0, right: 0 };
                for (let k = j; k < events.length && events[k].time <= until + 0.05; k++) {
                    if (events[k].kind === 'slide') continue;
                    ahead[noteXY(events[k])[0] < 0 ? 'left' : 'right']++;
                }
                const d = chooseHand(e, state, group, ahead);
                const r = (reasons[d.why] ||= [0, 0]);
                r[1]++;
                if (d.hand === h) {
                    hit++;
                    vh++;
                    r[0]++;
                }
                vn++;
                n++;
                apply(state, e, h);
            }
            i = j;
        }
        console.log(`${v.song.slice(0, 28).padEnd(28)} ${((vh / vn) * 100).toFixed(1)}% of ${vn}`);
    }
    console.log(
        `\nrules reproduce the human hand on ${((hit / n) * 100).toFixed(1)}% of ${n} notes (given the human's earlier moves)`
    );
    for (const [why, [a, b]] of Object.entries(reasons).sort((x, y) => y[1][1] - x[1][1]))
        console.log(
            `  ${String(b).padStart(5)} notes  ${((a / b) * 100).toFixed(0).padStart(3)}% right  ${why}`
        );
}

main();
