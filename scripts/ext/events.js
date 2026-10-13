// Finds the "GREAT" labels (salmon pink text) in a label capture (labels.js), places each on the chart
// (which note it judges, who is around it) and writes the list.
//
//   node scripts/ext/events.js <id> "<song>" <difficulty> <dx|std> <shift seconds>
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { judged } = require('./align');
const { centre } = require('../../src/sim/sensors');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');

/** Label events of one class (index into a cell row: 1 yellow, 2 orange, 3 salmon pink): [{t, x, y, n}] in ring radii. */
function labelEvents(cap, cls, minCount = 20) {
    const events = [];
    let cur = null;
    for (const [t, row] of cap.frames) {
        let n = 0;
        let sx = 0;
        let sy = 0;
        for (const r of row) {
            const c = r[cls];
            if (!c) continue;
            n += c;
            sx += c * ((r[0] % 100) * cap.CELL + cap.CELL / 2);
            sy += c * (Math.floor(r[0] / 100) * cap.CELL + cap.CELL / 2);
        }
        if (n >= minCount) {
            const p = { t, x: (sx / n - cap.cx) / cap.R, y: (sy / n - cap.cy) / cap.R, n };
            if (cur && t - cur.last < 0.2) {
                cur.last = t;
                if (n > cur.n) Object.assign(cur, { x: p.x, y: p.y, n });
            } else {
                if (cur) events.push(cur);
                cur = { ...p, first: t, last: t };
            }
        }
    }
    if (cur) events.push(cur);
    return events;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

async function events(id, song, difficulty, type, shift) {
    const cap = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.lab.json`)));
    const chart = buildChart((await getChartText(song, difficulty, type)).text);
    const list = judged(chart);
    const where = (n) => (n.key.startsWith('L') ? laneSpot(Number(n.key[1])) : centre(n.key));
    const out = [];
    for (const e of labelEvents(cap, 3)) {
        const T = e.first - shift;
        // the note judged around then whose label spot is nearest
        let best = null;
        for (const n of list) {
            if (n.when < T - 0.6 || n.when > T + 0.15) continue;
            const d = dist(where(n), [e.x, e.y]);
            if (!best || d < best.d) best = { n, d };
        }
        const around = list
            .filter((n) => best && Math.abs(n.when - best.n.when) < 0.35 && n !== best.n)
            .map((n) => `${n.kind}@${n.key}${(n.when - best.n.when).toFixed(2)}`);
        out.push({
            videoTime: Math.round(e.first * 100) / 100,
            x: Math.round(e.x * 100) / 100,
            y: Math.round(e.y * 100) / 100,
            matched: best
                ? {
                      kind: best.n.kind,
                      key: best.n.key,
                      time: best.n.time,
                      distance: Math.round(best.d * 100) / 100,
                  }
                : null,
            around,
        });
    }
    return out;
}

function laneSpot(l) {
    const a = ((22.5 + 45 * (l - 1)) * Math.PI) / 180;
    return [0.95 * Math.sin(a), -0.95 * Math.cos(a)];
}

module.exports = { labelEvents, events };

if (require.main === module) {
    const [id, song, diff, type, shift] = process.argv.slice(2);
    events(id, song, diff, type || 'dx', Number(shift)).then((r) => {
        fs.writeFileSync(path.join(DIR, `${id}.great.json`), JSON.stringify(r, null, 1));
        for (const e of r)
            console.log(
                `${e.videoTime}s  at (${e.x},${e.y})  ->`,
                e.matched
                    ? `${e.matched.kind} ${e.matched.key} chart ${e.matched.time} (off ${e.matched.distance})`
                    : 'no note',
                e.around.join(' ')
            );
    });
}
