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

/**
 * GREAT label events in a label capture: salmon pink text (cell column 3) with a LATE (4) or FAST (5) tag
 * next to it. Returns [{first, last, x, y, n, tag: 'late' | 'fast'}] with x, y in ring radii from the middle.
 */
function labelEvents(cap, minCount = 120, minTag = 10) {
    const events = [];
    let cur = null;
    for (const [t, row] of cap.frames) {
        let n = 0;
        let sx = 0;
        let sy = 0;
        for (const r of row) {
            const c = r[3];
            if (!c) continue;
            n += c;
            sx += c * ((r[0] % 100) * cap.CELL + cap.CELL / 2);
            sy += c * (Math.floor(r[0] / 100) * cap.CELL + cap.CELL / 2);
        }
        if (n < minCount) continue;
        const px = sx / n;
        const py = sy / n;
        let late = 0;
        let fast = 0;
        for (const r of row) {
            const x = (r[0] % 100) * cap.CELL + cap.CELL / 2;
            const y = Math.floor(r[0] / 100) * cap.CELL + cap.CELL / 2;
            if (Math.abs(x - px) <= 4 * cap.CELL && Math.abs(y - py) <= 4 * cap.CELL) {
                late += r[4];
                fast += r[5];
            }
        }
        if (late < minTag && fast < minTag) continue;
        const p = {
            t,
            x: (px - cap.cx) / cap.R,
            y: (py - cap.cy) / cap.R,
            n,
            tag: late >= fast ? 'late' : 'fast',
        };
        if (Math.hypot(p.x, p.y) > 1.3) continue; // outside the ring: a hand camera or the info panel
        if (cur && t - cur.last < 0.2) {
            cur.last = t;
            if (n > cur.n) Object.assign(cur, { x: p.x, y: p.y, n, tag: p.tag });
        } else {
            if (cur) events.push(cur);
            cur = { ...p, first: t, last: t };
        }
    }
    if (cur) events.push(cur);
    return events;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

async function events(id, song, difficulty, type, shift, ring) {
    const cap = applyRing(JSON.parse(fs.readFileSync(path.join(DIR, `${id}.lab.json`))), ring);
    const chart = buildChart((await getChartText(song, difficulty, type)).text);
    const list = judged(chart);
    const where = (n) => (n.key.startsWith('L') ? laneSpot(Number(n.key[1])) : centre(n.key));
    const out = [];
    for (const e of labelEvents(cap)) {
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
            tag: e.tag,
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

function laneSpot(l, r = 0.95) {
    const a = ((22.5 + 45 * (l - 1)) * Math.PI) / 180;
    return [r * Math.sin(a), -r * Math.cos(a)];
}

/** A capture made without knowing where the ring is: set it afterwards ("cx,cy,R" in 960 px units). */
function applyRing(cap, ring) {
    if (!ring) return cap;
    const [cx, cy, R] = ring.split(',').map(Number);
    Object.assign(cap, { cx, cy, R });
    return cap;
}

/** The video clock minus the chart clock, from where yellow (Critical Perfect) cells follow the taps best. */
function shiftFromLabels(cap, list) {
    const spots = [1, 2, 3, 4, 5, 6, 7, 8].map((l) => laneSpot(l, 1.05));
    const lanes = cap.frames.map(([, row]) => {
        const out = new Array(8).fill(0);
        for (const r of row) {
            if (!r[1] && !r[2] && !r[3]) continue;
            const x = ((r[0] % 100) * cap.CELL + cap.CELL / 2 - cap.cx) / cap.R;
            const y = (Math.floor(r[0] / 100) * cap.CELL + cap.CELL / 2 - cap.cy) / cap.R;
            for (let l = 0; l < 8; l++)
                if (dist(spots[l], [x, y]) < 0.28) out[l] += r[1] + r[2] + r[3];
        }
        return out;
    });
    const times = cap.frames.map((f) => f[0]);
    const taps = list.filter((n) => n.kind === 'tap' || n.kind === 'break');
    const frameAt = (t) => {
        let lo = 0;
        let hi = times.length - 1;
        while (lo < hi) {
            const m = (lo + hi) >> 1;
            if (times[m] < t) lo = m + 1;
            else hi = m;
        }
        return lo;
    };
    const score = (shift) => {
        let sum = 0;
        let n = 0;
        for (const e of taps) {
            const t = e.when + shift;
            if (t > times[times.length - 1] - 1) continue;
            const l = Number(e.key[1]) - 1;
            let peak = 0;
            for (let i = frameAt(t); i < times.length && times[i] <= t + 0.6; i++)
                peak = Math.max(peak, lanes[i][l]);
            sum += Math.min(300, peak);
            n++;
        }
        return n > 20 ? sum / n : -1;
    };
    let best = [0, -1];
    const all = [];
    for (let s = 0; s <= 45; s += 0.05) {
        const v = score(s);
        all.push(v);
        if (v > best[1]) best = [s, v];
    }
    all.sort((x, y) => x - y);
    const median = Math.max(1, all[Math.floor(all.length / 2)]);
    for (let s = best[0] - 0.05; s <= best[0] + 0.05; s += 0.0125) {
        const v = score(s);
        if (v > best[1]) best = [s, v];
    }
    return { shift: best[0], score: best[1], contrast: best[1] / median };
}

module.exports = { labelEvents, events, shiftFromLabels, laneSpot, applyRing };

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
