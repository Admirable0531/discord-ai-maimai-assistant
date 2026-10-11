// Plays one chart once (simulate) or many times with different random error
// (monteCarlo) and says, per note, how it was judged and what interfered.
const { COUNT, NAMES, cover, cellCount } = require('./sensors');
const { Judge, judgeNotes, FRAME } = require('./judge');
const { plan, rng } = require('./planner');

// A contact turns a sensor ON when it covers a fair part of the contact or of the sensor.
const ON_OF_CONTACT = 0.3;
const ON_OF_SENSOR = 0.3;
// ...or when it covers this many cells (0.025 R squared each) of a sensor: a panel reacts to a small overlap

function pointAt(pts, t) {
    if (t <= pts[0].t) return pts[0];
    for (let i = 1; i < pts.length; i++) {
        if (t <= pts[i].t) {
            const a = pts[i - 1];
            const b = pts[i];
            const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
            return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        }
    }
    return pts[pts.length - 1];
}

/**
 * Plays the chart once. Returns {outcomes: Map(noteId -> outcome), late, strokes}.
 * outcome: {grade, diff, kind: 'clean'|'foreign'|'blocked'|'misaimed'|'timing'|'miss'|'early',
 *           cause?: {id, source}}
 */
function simulate(events, style, seed = 1, { frames = false, record = false } = {}) {
    const notes = judgeNotes(events);
    const random = rng(seed);
    // a steady lean early or late for this run, on top of each press' own jitter
    const { strokes, late } = plan(notes, style, random);
    const judge = new Judge(notes, { touchButtons: style.touchButtons });
    const byStart = [...strokes].sort((a, b) => a.t0 - b.t0);
    let nextStroke = 0;
    let active = [];
    const btn = new Uint8Array(8);
    const sens = new Uint8Array(COUNT);
    const own = { btn: Array(8).fill(null), sens: Array(COUNT).fill(null) };
    const counts = new Int32Array(COUNT);
    const prevB = new Uint8Array(8);
    const prevS = new Uint8Array(COUNT);
    const pressInfo = new Map(); // note id -> {blocked, misaimed}
    const pending = [];
    const prevOwn = { btn: Array(8).fill(null), sens: Array(COUNT).fill(null) };
    const lastEdgeB = new Int32Array(8).fill(-999);
    const lastEdgeS = new Int32Array(COUNT).fill(-999);
    const finish = Math.max(0, ...notes.map((n) => n.end || n.t)) + 1;
    const trace = frames ? [] : null;
    const onSince = new Int32Array(COUNT).fill(-1);
    const intervals = [];
    const r3 = (x) => Math.round(x * 1000) / 1000;

    for (let f = Math.floor(-0.5 / FRAME); f * FRAME < finish; f++) {
        const t = f * FRAME;
        while (nextStroke < byStart.length && byStart[nextStroke].t0 <= t)
            active.push(byStart[nextStroke++]);
        active = active.filter((s) => s.t1 >= t);
        btn.fill(0);
        sens.fill(0);
        own.btn.fill(null);
        own.sens.fill(null);
        const contacts = [];
        for (const s of active) {
            if (s.t0 > t) continue;
            if (s.mode === 'btn') {
                btn[s.lane - 1] = 1;
                (own.btn[s.lane - 1] ||= []).push(s.id);
                continue;
            }
            const p = pointAt(s.pts, t);
            counts.fill(0);
            const total = cover(p.x, p.y, s.r, counts);
            const hit = [];
            for (let i = 0; i < COUNT; i++) {
                if (!counts[i]) continue;
                if (
                    counts[i] >= ON_OF_CONTACT * total ||
                    counts[i] >= Math.min(ON_OF_SENSOR * cellCount[i], style.onCells)
                ) {
                    sens[i] = 1;
                    (own.sens[i] ||= []).push(s.id);
                    hit.push(i);
                }
            }
            contacts.push({ s, p, hit });
        }
        // did each press of a note land as a fresh press (a new OFF to ON on its target)?
        for (let i = 0; i < 8; i++) if (btn[i] && !prevB[i]) lastEdgeB[i] = f;
        for (let i = 0; i < COUNT; i++) if (sens[i] && !prevS[i]) lastEdgeS[i] = f;
        for (const s of active) {
            if (s.role === 'transit' || s.role === 'slide' || s.first !== undefined) continue;
            s.first = f;
            let info = pressInfo.get(s.id);
            if (!info) pressInfo.set(s.id, (info = { blocked: false, misaimed: false }));
            pending.push({
                s,
                info,
                f,
                held: s.mode === 'btn' ? prevOwn.btn[s.lane - 1] : prevOwn.sens[s.target],
            });
        }
        while (pending.length && pending[0].f + 3 <= f) {
            const { s, info, f: f0, held } = pending.shift();
            const edge = s.mode === 'btn' ? lastEdgeB[s.lane - 1] : lastEdgeS[s.target];
            const on = s.mode === 'btn' ? btn[s.lane - 1] : sens[s.target];
            if (edge < f0 - 4) {
                if (on) {
                    info.blocked = true; // it was already pressed, so nothing new happened
                    info.by = (held || []).find((x) => x !== s.id) ?? null;
                } else info.misaimed = true;
            }
        }
        if (record) {
            for (let i = 0; i < COUNT; i++) {
                if (sens[i] && onSince[i] < 0) onSince[i] = f;
                else if (!sens[i] && onSince[i] >= 0) {
                    intervals.push([i, r3(onSince[i] * FRAME), r3(f * FRAME)]);
                    onSince[i] = -1;
                }
            }
        }
        judge.frame(f, btn, sens, own);
        if (trace && f >= 0) trace.push({ f, btn: [...btn], sens: [...sens], contacts });
        prevB.set(btn);
        prevS.set(sens);
        prevOwn.btn = own.btn.slice();
        prevOwn.sens = own.sens.slice();
    }
    const results = judge.finish();
    const outcomes = new Map();
    for (const n of notes) {
        const r = results.get(n.id);
        const info = pressInfo.get(n.id) || {};
        let kind = 'clean';
        let cause = null;
        const foreignOwner =
            r.by && r.by !== 'group' && r.owners.length && !r.owners.includes(n.id)
                ? r.owners[0]
                : null;
        if (r.grade === 3) {
            kind = info.misaimed ? 'misaimed' : info.blocked ? 'blocked' : 'miss';
            if (info.blocked && info.by != null) cause = { id: info.by, source: 'held' };
        } else if (foreignOwner !== null && r.grade >= 1) {
            kind = 'foreign';
            cause = { id: foreignOwner, source: r.by };
        } else if (foreignOwner !== null) {
            kind = 'clean';
        } else if (r.grade >= 2 && info.blocked) {
            kind = 'blocked';
            if (info.by != null) cause = { id: info.by, source: 'held' };
        } else if (r.grade >= 1 && n.kind === 'slide' && r.diff < -0.35) kind = 'early';
        else if (r.grade >= 1) kind = 'timing';
        outcomes.set(n.id, { grade: r.grade, diff: r.diff, kind, cause, note: n.kind });
    }
    let replay = null;
    if (record) {
        replay = {
            sensors: intervals,
            strokes: strokes
                .filter((s) => s.role !== 'transit' || s.pts)
                .map((s) => [
                    s.mode === 'btn' ? 0 : 1,
                    r3(s.t0),
                    r3(s.t1),
                    r3(s.r),
                    s.lane || 0,
                    s.pts ? s.pts.flatMap((p) => [r3(p.t), r3(p.x), r3(p.y)]) : [],
                ]),
            outcomes: [...outcomes]
                .filter(([, o]) => o.kind !== 'clean')
                .map(([id, o]) => [id, o.kind, o.cause ? o.cause.id : -1]),
        };
    }
    return { outcomes, late, strokes, trace, notes, replay };
}

/** Runs with different seeds; counts of each outcome kind per note and the commonest causes. */
function monteCarlo(events, style, runs = 30, seed = 1) {
    const stats = new Map();
    let late = new Map();
    for (let k = 0; k < runs; k++) {
        const r = simulate(events, style, seed + k * 7919);
        for (const [id, o] of r.outcomes) {
            let s = stats.get(id);
            if (!s) {
                s = { id, n: 0, kinds: {}, causes: new Map(), worst: 0 };
                stats.set(id, s);
            }
            s.n++;
            s.kinds[o.kind] = (s.kinds[o.kind] || 0) + 1;
            s.worst = Math.max(s.worst, o.grade);
            if (o.cause) s.causes.set(o.cause.id, (s.causes.get(o.cause.id) || 0) + 1);
        }
        for (const l of r.late) late.set(l.id, (late.get(l.id) || 0) + 1);
    }
    return { stats, late, runs };
}

module.exports = { simulate, monteCarlo, NAMES };
