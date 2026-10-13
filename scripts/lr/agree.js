// How closely does the simulated player's choice of hand match the human in each video?
//   node scripts/lr/agree.js [dir]
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');
const { withHands } = require('./summary');

const DIR = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'lr');
const classOf = (k) => (k === 'break' ? 'tap' : k === 'touchHold' ? 'touch' : k);

async function main() {
    const files = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.json') && !f.includes('capture') && f !== 'run.log');
    const styles = {
        'learned from the videos': STYLES.expert,
        'learned, trusted even if late': { ...STYLES.expert, followModel: true },
        'rule-based habits': { ...STYLES.expert, policy: 'rules' },
    };
    const totals = Object.fromEntries(Object.keys(styles).map((k) => [k, [0, 0]]));
    let sideHit = 0;
    let n = 0;
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
        const index = new Map();
        chart.events.forEach((e, i) => {
            const where =
                e.kind === 'slide'
                    ? e.head
                    : e.lane || (e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`);
            const h = human.get(`${classOf(e.kind)}@${Math.round(e.time * 1000)}@${where}`);
            if (h !== undefined) index.set(i, h);
        });
        const line = [`${v.song.slice(0, 24).padEnd(24)} ${index.size} notes`];
        for (const [name, style] of Object.entries(styles)) {
            let hit = 0;
            let tot = 0;
            for (let k = 0; k < 3; k++) {
                const r = simulate(
                    chart.events,
                    { ...style, posSigma: 0, timeSigma: 0 },
                    5 + k * 7919
                );
                for (const s of r.strokes) {
                    if (s.role === 'transit' || !index.has(s.id)) continue;
                    tot++;
                    if (s.hand === index.get(s.id)) hit++;
                }
            }
            totals[name][0] += hit;
            totals[name][1] += tot;
            line.push(`${name} ${((hit / tot) * 100).toFixed(1)}%`);
        }
        for (const [i, h] of index) {
            const e = chart.events[i];
            n++;
            if (
                ((e.sensor ? 0 : 0) +
                    (e.lane
                        ? Math.sin(((22.5 + 45 * (e.lane - 1)) * Math.PI) / 180)
                        : e.head
                          ? Math.sin(((22.5 + 45 * (e.head - 1)) * Math.PI) / 180)
                          : 0) >
                0
                    ? 1
                    : 0) === h
            )
                sideHit++;
        }
        console.log(line.join('   '));
    }
    for (const [k, [a, b]] of Object.entries(totals))
        console.log(`overall ${k}: ${((a / b) * 100).toFixed(1)}%`);
    console.log(
        `overall "right half of the screen is the right hand": ${((sideHit / n) * 100).toFixed(1)}%`
    );
}

main();
