// What do the notes with a GREAT label have in common? Compares them with all judged notes of the same charts.
//   node scripts/ext/analyse.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { judged } = require('./align');
const { noteXY } = require('../../src/sim/handFeatures');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');
const MIN_YELLOW = 120; // alignment score below this is not trusted
const MAX_OFF = 0.45; // ring radii between the label and the note's label spot

async function main() {
    const metas = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((m) => m.score >= MIN_YELLOW && (m.contrast ?? 2) >= 1.4);
    // the first two videos have no meta: add them
    for (const [id, song, shift] of [
        ['tfSN2a3WlpM', 'LiftOff', 14.19],
        ['lkmt2q25WJg', 'Paradisoda', 15.03],
    ])
        metas.push({ id, song, difficulty: 'master', type: 'dx', shift, score: 999 });
    const rows = [];
    for (const m of metas) {
        const gp = path.join(DIR, `${m.id}.great.json`);
        if (!fs.existsSync(gp)) continue;
        const great = JSON.parse(fs.readFileSync(gp));
        const chart = buildChart((await getChartText(m.song, m.difficulty, m.type)).text);
        const list = judged(chart).sort((a, b) => a.when - b.when);
        const xyOf = (n) => {
            const e = chart.events.find(
                (x) => x.kind === n.kind && Math.abs(x.time - n.time) < 0.002
            );
            return e ? noteXY(e) : [0, 0];
        };
        const moments = [];
        for (const n of list) {
            const q = moments[moments.length - 1];
            if (q && Math.abs(q.t - n.when) < 0.002) q.n.push(n);
            else moments.push({ t: n.when, n: [n] });
        }
        const isGreat = new Set();
        for (const g of great) {
            if (!g.matched || g.matched.distance > MAX_OFF) continue;
            for (const n of list)
                if (
                    n.kind === g.matched.kind &&
                    n.key === g.matched.key &&
                    Math.abs(n.time - g.matched.time) < 0.003
                )
                    isGreat.add(n);
        }
        moments.forEach((q, i) => {
            const prev = moments[i - 1];
            const next = moments[i + 1];
            const pp = moments[i - 2];
            if (!prev || !next || !pp) return;
            const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
            const p0 = xyOf(q.n[0]);
            const p1 = xyOf(prev.n[0]);
            const p2 = xyOf(pp.n[0]);
            const a1 = Math.atan2(p0[1] - p1[1], p0[0] - p1[0]);
            const a0 = Math.atan2(p1[1] - p2[1], p1[0] - p2[0]);
            const turn = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
            for (const n of q.n)
                rows.push({
                    video: m.id,
                    great: isGreat.has(n) ? 1 : 0,
                    kind: n.kind,
                    gapB: q.t - prev.t,
                    gapA: next.t - q.t,
                    jump: d(p0, p1),
                    turn,
                    size: q.n.length,
                    dens: moments.filter((x) => Math.abs(x.t - q.t) < 0.5).length,
                    touchNear: moments
                        .slice(Math.max(0, i - 3), i + 4)
                        .some((x) => x.n.some((y) => y.kind.startsWith('touch'))),
                    slideNear: moments
                        .slice(Math.max(0, i - 3), i + 4)
                        .some((x) => x.n.some((y) => y.kind === 'slide')),
                });
        });
    }
    const pos = rows.filter((r) => r.great);
    console.log(
        `${metas.length} videos, ${rows.length} judged notes, ${pos.length} Greats matched (${((100 * pos.length) / rows.length).toFixed(2)}%)`
    );
    const share = (pred) => {
        const a = rows.filter(pred);
        const g = a.filter((r) => r.great).length;
        return `${a.length} notes, ${g} Greats = ${((100 * g) / (a.length || 1)).toFixed(2)}%`;
    };
    console.log('\nby kind');
    for (const k of ['tap', 'break', 'hold', 'slide', 'touch', 'touchHold'])
        console.log(
            ' ',
            k.padEnd(9),
            share((r) => r.kind === k)
        );
    console.log('\nsimultaneous notes (yellow doubles etc.)');
    for (const s of [1, 2, 3])
        console.log(
            ' ',
            `size ${s}${s === 3 ? '+' : ''}`.padEnd(9),
            share((r) => (s === 3 ? r.size >= 3 : r.size === s))
        );
    console.log('\ngap before the note (s)');
    for (const [lo, hi] of [
        [0, 0.1],
        [0.1, 0.2],
        [0.2, 0.4],
        [0.4, 1],
        [1, 99],
    ])
        console.log(
            ' ',
            `${lo}-${hi}`.padEnd(9),
            share((r) => r.gapB >= lo && r.gapB < hi)
        );
    console.log('\ndistance from the previous note (ring radii)');
    for (const [lo, hi] of [
        [0, 0.3],
        [0.3, 0.8],
        [0.8, 1.3],
        [1.3, 9],
    ])
        console.log(
            ' ',
            `${lo}-${hi}`.padEnd(9),
            share((r) => r.jump >= lo && r.jump < hi)
        );
    console.log('\nchange of direction vs the previous step');
    for (const [lo, hi] of [
        [0, 0.5],
        [0.5, 1.2],
        [1.2, 2.0],
        [2.0, 4],
    ])
        console.log(
            ' ',
            `${lo}-${hi}`.padEnd(9),
            share((r) => r.turn >= lo && r.turn < hi)
        );
    console.log('\nnotes within +-0.5 s');
    for (const [lo, hi] of [
        [0, 4],
        [4, 6],
        [6, 8],
        [8, 99],
    ])
        console.log(
            ' ',
            `${lo}-${hi}`.padEnd(9),
            share((r) => r.dens >= lo && r.dens < hi)
        );
    console.log('\nnearby slide / touch (within 3 moments)');
    console.log(
        '  slide near   ',
        share((r) => r.slideNear)
    );
    console.log(
        '  no slide near',
        share((r) => !r.slideNear)
    );
    console.log(
        '  touch near   ',
        share((r) => r.touchNear)
    );
    console.log(
        '  no touch near',
        share((r) => !r.touchNear)
    );
    fs.writeFileSync(path.join(DIR, 'rows.json'), JSON.stringify(rows));
}
main();
