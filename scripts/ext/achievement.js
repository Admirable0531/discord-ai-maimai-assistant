// Does a rank-fitted simulated player end up with an achievement in that rank's range? (Great counted as 0.75, Good 0.5, Miss 0, note weights tap 1, hold 2, slide 3, touch 1, touch hold 2.)
//   node scripts/ext/achievement.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');
const W = { tap: 1, hold: 2, slide: 3, touch: 1, touchHold: 2 };
const F = [1, 0.75, 0.5, 0];
const RANGE = {
    S: '97-98',
    'S+': '98-99',
    SS: '99-99.5',
    'SS+': '99.5-100',
    SSS: '100-100.5',
    'SSS+': '100.5+',
};

async function main() {
    const metas = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((m) => m.rank && m.score >= 120 && (m.contrast ?? 2) >= 1.4);
    for (const rank of Object.keys(RANGE)) {
        const id = `rank${rank.replace('+', 'p')}`;
        const mine = metas.filter((m) => m.rank === rank);
        const vals = [];
        for (const m of mine) {
            const ev = buildChart((await getChartText(m.song, m.difficulty, m.type)).text).events;
            for (let k = 0; k < 4; k++) {
                const r = simulate(ev, STYLES[id], 3 + k * 977);
                let num = 0;
                let den = 0;
                for (const n of r.notes) {
                    const o = r.outcomes.get(n.id);
                    if (!o) continue;
                    const w = W[n.kind] ?? 1;
                    num += w * F[o.grade];
                    den += w;
                }
                vals.push((100 * num) / den);
            }
        }
        vals.sort((a, b) => a - b);
        console.log(
            rank.padEnd(5),
            `real range ${RANGE[rank]}%`.padEnd(24),
            `simulated ${vals[0].toFixed(2)} to ${vals[vals.length - 1].toFixed(2)}, median ${vals[Math.floor(vals.length / 2)].toFixed(2)}% (${mine.length} charts)`
        );
    }
}
main();
