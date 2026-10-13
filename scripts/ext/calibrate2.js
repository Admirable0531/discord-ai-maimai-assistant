// Pooled check: every real video is simulated with the player of its rank; Great rates by crowding, kind, gap and distance next to the real ones.
//   node scripts/ext/calibrate2.js
const fs = require('fs');
const path = require('path');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { simulate } = require('../../src/sim/run');
const { STYLES } = require('../../src/sim/styles');
const { noteXY } = require('../../src/sim/handFeatures');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');
const RANKID = {
    S: 'rankS',
    'S+': 'rankSp',
    SS: 'rankSS',
    'SS+': 'rankSSp',
    SSS: 'rankSSS',
    'SSS+': 'rankSSSp',
};

async function main() {
    const real = JSON.parse(fs.readFileSync(path.join(DIR, 'rows.json')));
    const metas = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((m) => m.score >= 120 && (m.contrast ?? 2) >= 1.4);
    const bins = {
        crowd: [
            [0, 4],
            [4, 6],
            [6, 8],
            [8, 99],
        ],
        gap: [
            [0, 0.1],
            [0.1, 0.2],
            [0.2, 0.4],
            [0.4, 99],
        ],
        jump: [
            [0, 0.3],
            [0.3, 0.8],
            [0.8, 1.3],
            [1.3, 9],
        ],
    };
    const acc = {
        crowd: bins.crowd.map(() => [0, 0]),
        gap: bins.gap.map(() => [0, 0]),
        jump: bins.jump.map(() => [0, 0]),
    };
    const kinds = {};
    for (const m of metas) {
        const style = {
            ...STYLES[RANKID[m.rank] || 'rankSSS'],
            ...(process.env.DRIFT ? { timeDrift: Number(process.env.DRIFT) } : {}),
        };
        const chart = buildChart((await getChartText(m.song, m.difficulty, m.type)).text);
        for (let k = 0; k < 3; k++) {
            const r = simulate(chart.events, style, 3 + k * 977);
            const times = [...new Set(r.notes.map((n) => Math.round(n.t * 500)))].sort(
                (a, b) => a - b
            );
            const order = r.notes.slice().sort((a, b) => a.t - b.t);
            const xy = (n) => noteXY(chart.events[n.id]);
            const idxOf = new Map(times.map((t, i) => [t, i]));
            for (const n of r.notes) {
                const o = r.outcomes.get(n.id);
                if (!o) continue;
                const g = o.grade === 1 ? 1 : 0;
                const c = Math.round(n.t * 500);
                const crowd = times.filter((x) => Math.abs(x - c) <= 250).length;
                const i = idxOf.get(c);
                const gap = i > 0 ? (c - times[i - 1]) / 500 : 9;
                const prev =
                    i > 0 ? order.find((x) => Math.round(x.t * 500) === times[i - 1]) : null;
                const jump = prev ? Math.hypot(...xy(n).map((v, j) => v - xy(prev)[j])) : 0;
                const add = (key, v) => {
                    const bi = bins[key].findIndex(([lo, hi]) => v >= lo && v < hi);
                    acc[key][bi][1]++;
                    acc[key][bi][0] += g;
                };
                add('crowd', crowd);
                add('gap', gap);
                add('jump', jump);
                const kd = (kinds[n.kind] = kinds[n.kind] || [0, 0]);
                kd[1]++;
                kd[0] += g;
            }
        }
    }
    console.log(
        'overall sim Greats',
        (
            (100 * Object.values(kinds).reduce((x, v) => x + v[0], 0)) /
            Object.values(kinds).reduce((x, v) => x + v[1], 0)
        ).toFixed(2) + '% (real 1.25%)'
    );
    console.log('sim jump bin sizes', acc.jump.map((a) => a[1]).join(' '), '| real', bins.jump.map((b) => real.filter((r) => r.jump >= b[0] && r.jump < b[1]).length).join(' '));
    const pct = (a) => ((100 * a[0]) / (a[1] || 1)).toFixed(2);
    const realRate = (key, [lo, hi]) => {
        const a = real.filter((r) => r[key] >= lo && r[key] < hi);
        return ((100 * a.filter((r) => r.great).length) / (a.length || 1)).toFixed(2);
    };
    const realKey = { crowd: 'dens', gap: 'gapB', jump: 'jump' };
    for (const key of Object.keys(bins)) {
        console.log(
            key.padEnd(6),
            bins[key]
                .map(
                    (b, i) =>
                        `${b[0]}-${b[1]}: sim ${pct(acc[key][i])} real ${realRate(realKey[key], b)}`
                )
                .join(' | ')
        );
    }
    console.log(
        'kinds ',
        Object.entries(kinds)
            .map(([k, v]) => `${k} sim ${pct(v)}`)
            .join(' | ')
    );
    for (const k of ['tap', 'break', 'hold', 'slide', 'touch']) {
        const a = real.filter((r) => r.kind === k);
        console.log(
            '  real',
            k,
            ((100 * a.filter((r) => r.great).length) / (a.length || 1)).toFixed(2)
        );
    }
}
main();
