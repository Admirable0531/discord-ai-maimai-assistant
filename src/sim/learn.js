// Learning from the simulation: play charts with randomly drawn hands, record what
// splashed, and fit simple models to see which things matter and how the rules
// compare. Run: node src/sim/learn.js "Titania,Apollo" 40 6 out.json
const fs = require('fs');
const { STYLES } = require('./styles');
const { monteCarlo } = require('./run');
const { judgeNotes } = require('./judge');
const { centre } = require('./sensors');
const { slideTracks } = require('../chart/slidePaths');
const { random, fitTree, treeRules, ridge } = require('./ml');

/** One random set of hands. */
function randomStyle(r, i) {
    const p = {
        tapFoot: r.logUniform(0.03, 0.3),
        touchFoot: r.logUniform(0.03, 0.3),
        slideFoot: r.logUniform(0.03, 0.3),
        posSigma: r.uniform(0, 0.08),
        timeSigma: r.uniform(0.002, 0.025),
        onCells: r.int(2, 14),
        speed: r.uniform(8, 20),
        fingers: r.int(2, 4),
        reach: r.uniform(0.8, 1.8),
        tapMode: r.pick(['button', 'screen']),
        touchButtons: r.next() < 0.5,
        lift: r.next() < 0.6,
    };
    return { ...STYLES.fingertips, ...p, id: `r${i}`, label: `random ${i}` };
}

const KIND = { tap: 1, hold: 2, touch: 3, touchHold: 3, slide: 4 };
const nameOf = (e) =>
    e.sensor ? (e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`) : `A${e.lane}`;

/**
 * Pairs (victim note, possible source note) with features and whether the source
 * caused a splash of the victim in at least a quarter of the runs.
 */
function pairRows(events, style, mc, r, keepNeg = 0.12) {
    const notes = judgeNotes(events);
    const byId = new Map(notes.map((n) => [n.id, n]));
    const paths = new Map();
    for (const n of notes) if (n.kind === 'slide') paths.set(n.id, slideTracks(events[n.id]));
    const rows = [];
    const victims = notes.filter((n) => n.kind !== 'slide');
    const sorted = [...notes].sort((a, b) => a.t - b.t);
    for (const v of victims) {
        const e = events[v.id];
        const vName = nameOf(e);
        const vc = centre(vName);
        const stat = mc.stats.get(v.id);
        if (!stat) continue;
        const causes = new Map();
        for (const [cid, count] of stat.causes) causes.set(cid, count / stat.n);
        const candidates = new Map();
        for (const c of sorted) {
            if (c.id === v.id) continue;
            if (c.t > v.t + 0.5) break;
            const ce = events[c.id];
            if (c.kind === 'slide') {
                const steps = (paths.get(c.id) || [[]])[0];
                let best = null;
                steps.forEach((alts, i) => {
                    const st =
                        c.start +
                        (steps.length === 1 ? 0 : (i / (steps.length - 1)) * (c.end - c.start));
                    const gap = v.t - st;
                    if (Math.abs(gap) > 0.4) return;
                    const d = Math.hypot(...centre(alts[0]).map((x, k) => x - vc[k]));
                    if (!best || d < best.d) best = { d, gap };
                });
                if (best) candidates.set(c.id, { ...best, c, dur: c.end - c.start });
            } else if (Math.abs(c.t - v.t) <= 0.4) {
                const cc = centre(nameOf(ce));
                candidates.set(c.id, {
                    d: Math.hypot(cc[0] - vc[0], cc[1] - vc[1]),
                    gap: v.t - c.t,
                    c,
                    dur: c.end ? c.end - c.t : 0,
                });
            }
        }
        for (const cid of causes.keys()) {
            if (!candidates.has(cid) && byId.has(cid)) {
                const c = byId.get(cid);
                candidates.set(cid, { d: 9, gap: v.t - c.t, c, dur: 0 });
            }
        }
        for (const [cid, cand] of candidates) {
            const y = (causes.get(cid) || 0) >= 0.25 ? 1 : 0;
            if (!y && r.next() > keepNeg) continue;
            const c = cand.c;
            const cKind = KIND[c.kind];
            const foot =
                cKind === 4
                    ? style.slideFoot
                    : cKind === 3
                      ? style.touchFoot
                      : style.tapMode === 'button' && cKind < 3
                        ? 0
                        : style.tapFoot;
            rows.push({
                y,
                w: y ? 1 : 1 / keepNeg,
                x: [
                    KIND[v.kind],
                    cKind,
                    cand.gap,
                    Math.abs(cand.gap),
                    cand.d,
                    foot,
                    cand.d - foot,
                    cand.d < 0.02 ? 1 : 0,
                    style.lift ? 1 : 0,
                    style.posSigma,
                    style.tapMode === 'button' ? 1 : 0,
                    style.touchButtons ? 1 : 0,
                    cand.dur,
                    vName[0] === 'A' ? 1 : 0,
                ],
            });
        }
    }
    return rows;
}
const PAIR_FEATURES = [
    'victimKind',
    'sourceKind',
    'gap',
    'absGap',
    'distance',
    'sourceContact',
    'clearance',
    'sameSensor',
    'lift',
    'aimError',
    'tapsOnButtons',
    'touchOnButtons',
    'sourceLength',
    'victimOnA',
];

async function main() {
    const [chartsArg, nStyles = '40', runs = '6', out = 'learn.json', rowsOut] =
        process.argv.slice(2);
    const { getChartText } = require('../chart/simaiWiki');
    const { buildChart } = require('../chart/chartModel');
    const { analyse } = require('../chart/rules');
    const charts = [];
    for (const t of chartsArg.split(',')) {
        const f = await getChartText(t, 'master');
        if (f.success) charts.push({ title: t, chart: buildChart(f.text) });
    }
    const r = random(20261012);
    const styleRows = [];
    const rows = [];
    const ruleHits = {};
    for (let i = 0; i < Number(nStyles); i++) {
        const style = randomStyle(r, i);
        for (const { title, chart } of charts) {
            const mc = monteCarlo(chart.events, style, Number(runs), 1 + i * 13);
            let bad = 0;
            let n = 0;
            const spots = [];
            for (const [id, s] of mc.stats) {
                n++;
                const p =
                    ((s.kinds.foreign || 0) + (s.kinds.blocked || 0) + (s.kinds.early || 0)) / s.n;
                bad += p;
                if (p >= 0.25) spots.push(chart.events[id].time);
            }
            styleRows.push({ title, style: i, params: style, rate: bad / n, spots: spots.length });
            rows.push(...pairRows(chart.events, style, mc, r));
            // how well do the rules agree with this style's spots?
            if (!ruleHits[title]) ruleHits[title] = { findings: analyse(chart), hits: {} };
            const hit = ruleHits[title];
            hit.findings.forEach((f, k) => {
                if (/^B|^A14$/.test(f.rule)) return;
                const near = spots.some((t) => Math.abs(t - f.time) <= 0.3);
                (hit.hits[k] ||= []).push(near ? 1 : 0);
            });
            hit.spotsBy ||= [];
            hit.spotsBy.push({ style: i, spots });
        }
        process.stderr.write(`style ${i + 1}/${nStyles}\\r`);
    }
    // rule precision: per rule, the mean over its findings of the share of styles that splash there
    const rules = {};
    for (const { findings, hits } of Object.values(ruleHits)) {
        findings.forEach((f, k) => {
            if (!hits[k]) return;
            const share = hits[k].reduce((a, b) => a + b, 0) / hits[k].length;
            const o = (rules[f.rule] ||= { n: 0, share: 0, any: 0, most: 0 });
            o.n++;
            o.share += share;
            o.any += share > 0 ? 1 : 0;
            o.most += share >= 0.5 ? 1 : 0;
        });
    }
    for (const o of Object.values(rules)) o.share = o.share / o.n;
    // which parameters drive the overall splash rate
    const names = [
        'tapFoot',
        'touchFoot',
        'slideFoot',
        'posSigma',
        'timeSigma',
        'onCells',
        'speed',
        'fingers',
        'reach',
        'tapButtons',
        'touchButtons',
        'lift',
    ];
    const X = styleRows.map((s) => {
        const p = s.params;
        return [
            p.tapFoot,
            p.touchFoot,
            p.slideFoot,
            p.posSigma,
            p.timeSigma,
            p.onCells,
            p.speed,
            p.fingers,
            p.reach,
            p.tapMode === 'button' ? 1 : 0,
            p.touchButtons ? 1 : 0,
            p.lift ? 1 : 0,
        ];
    });
    const regression = ridge(
        X,
        styleRows.map((s) => s.rate),
        names,
        2
    );
    const { tree, importance } = fitTree(rows, { features: PAIR_FEATURES, depth: 5, minLeaf: 60 });
    const result = {
        charts: charts.map((c) => c.title),
        styles: Number(nStyles),
        runs: Number(runs),
        pairRows: rows.length,
        positives: rows.filter((x) => x.y).length,
        regression,
        importance,
        rules: treeRules(tree)
            .filter((x) => x.n >= 60)
            .sort((a, b) => b.p - a.p),
        ruleAgreement: rules,
        meanRate: styleRows.reduce((a, s) => a + s.rate, 0) / styleRows.length,
    };
    if (rowsOut) {
        const lines = [`y,w,${PAIR_FEATURES.join(',')}`];
        for (const row of rows)
            lines.push(
                `${row.y},${row.w.toFixed(2)},${row.x.map((v) => Math.round(v * 10000) / 10000).join(',')}`
            );
        fs.writeFileSync(rowsOut, lines.join('\n'));
    }
    fs.writeFileSync(out, JSON.stringify(result, null, 1));
    console.log(JSON.stringify(result, null, 1).slice(0, 6000));
}

if (require.main === module) main();

module.exports = { randomStyle, pairRows, PAIR_FEATURES };
