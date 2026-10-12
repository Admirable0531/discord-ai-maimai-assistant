// Turns a chart into hand movements: who touches what, where and when.
// Two hands. Each note is given to the hand that can get there in time, and
// what the hand does in between depends on the style (lifted, or dragging).
const { INDEX, centre, buttonPosition } = require('./sensors');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The small random numbers a run needs, repeatable from a seed. */
function rng(seed) {
    let s = seed >>> 0 || 1;
    const next = () => {
        s += 0x6d2b79f5;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gauss = () => {
        const u = Math.max(next(), 1e-9);
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    };
    return { next, gauss };
}

/** Where a slide's finger goes: the centre of each sensor on the way, spread evenly over its time. */
function slidePoints(note) {
    const track = note.tracks.length === 3 ? note.tracks[1] : note.tracks[0];
    const pts = track.map((alts) => centre(alts[0]));
    const span = note.end - note.start;
    return pts.map((p, i) => ({
        t: note.start + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * span),
        x: p[0],
        y: p[1],
    }));
}

/**
 * Actions in time order: {note, t, end, mode, pos, lane?, sIdx?}. `mode` is 'btn'
 * or 'screen'; a slide has `points` instead of a single `pos`.
 */
function actionsOf(notes, style) {
    const out = [];
    // a quick tap lets go again before the next press of the same button or sensor
    const nextGap = new Map();
    const lastAt = new Map();
    for (const n of [...notes].sort((a, b) => b.t - a.t)) {
        const key =
            n.kind === 'tap' || n.kind === 'hold'
                ? `L${n.lane}`
                : n.sIdx !== undefined
                  ? `S${n.sIdx}`
                  : null;
        if (!key) continue;
        if (lastAt.has(key)) nextGap.set(n.id, lastAt.get(key) - n.t);
        lastAt.set(key, n.t);
    }
    const pressOf = (n) => Math.min(style.pressLen, 0.5 * (nextGap.get(n.id) ?? 9));
    for (const n of notes) {
        if (n.kind === 'tap' || n.kind === 'hold') {
            const end = n.kind === 'hold' ? n.end : n.t + pressOf(n);
            if (style.tapMode === 'button') {
                out.push({
                    note: n,
                    t: n.t,
                    end,
                    mode: 'btn',
                    lane: n.lane,
                    pos: buttonPosition(n.lane),
                    foot: 0,
                });
            } else {
                out.push({
                    note: n,
                    t: n.t,
                    end,
                    mode: 'screen',
                    sIdx: INDEX[`A${n.lane}`],
                    pos: centre(`A${n.lane}`),
                    foot: style.tapFoot,
                });
            }
        } else if (n.kind === 'touch' || n.kind === 'touchHold') {
            const end = n.kind === 'touchHold' ? n.end : n.t + pressOf(n);
            if (style.touchButtons && n.lane) {
                out.push({
                    note: n,
                    t: n.t,
                    end,
                    mode: 'btn',
                    lane: n.lane,
                    pos: buttonPosition(n.lane),
                    foot: 0,
                });
            } else {
                const names = Object.keys(INDEX);
                out.push({
                    note: n,
                    t: n.t,
                    end,
                    mode: 'screen',
                    sIdx: n.sIdx,
                    pos: centre(names[n.sIdx]),
                    foot: style.touchFoot,
                });
            }
        } else if (n.kind === 'slide') {
            const points = slidePoints(n);
            out.push({
                note: n,
                t: n.start - 0.04,
                end: n.end + 0.05,
                mode: 'screen',
                slide: true,
                points,
                pos: [points[0].x, points[0].y],
                foot: n.tracks.length === 3 ? Math.max(style.slideFoot, 0.25) : style.slideFoot,
            });
        }
    }
    return out.sort((a, b) => a.t - b.t);
}

/**
 * Strokes: what each hand does, as contacts with a time span and a path.
 * {id (the note it is for), role, mode, lane?, t0, t1, pts[{t,x,y}], r, target?}
 * `notes` are judge notes; returns {strokes, late} where `late` lists notes the
 * hands could not reach in time (a chart that wants more hands than two).
 */
function plan(notes, style, random) {
    const actions = actionsOf(notes, style);
    // two hands, each with a few fingers. A finger can reach anything close to where
    // its hand rests with a quick twitch; reaching further means moving the whole hand.
    const makeHand = (x, side) => ({
        anchor: [x, 0.7],
        side,
        fingers: Array.from({ length: style.fingers }, () => ({
            pos: [x, 0.7],
            freeAt: -10,
            screen: false,
            lastScreenEnd: null,
        })),
    });
    const hands = [makeHand(-0.6, 0), makeHand(0.6, 1)];
    const strokes = [];
    const late = [];
    // a player who is always a bit early or late: one steady offset for the whole run
    const bias = random.gauss() * (style.timeBias || 0);

    /** Time for finger f of hand h to be ready at the action's position, and whether the hand has to move. */
    const cost = (h, f, a) => {
        const near = dist(h.anchor, a.pos) <= style.reach;
        const move = near
            ? dist(f.pos, a.pos) / (style.speed * 2.5)
            : dist(h.anchor, a.pos) / style.speed + 0.03;
        // moving the hand needs its other fingers to be free
        if (!near && h.fingers.some((g) => g !== f && g.freeAt > a.t - move))
            return { ready: Infinity, near };
        return { ready: f.freeAt + move, near };
    };
    const slack = (h, f, a) => a.t - cost(h, f, a).ready - 0.012;
    const candidates = (a) => {
        const list = [];
        for (const h of hands) for (const f of h.fingers) list.push({ h, f, s: slack(h, f, a) });
        return list;
    };

    for (let i = 0; i < actions.length;) {
        let j = i + 1;
        while (j < actions.length && Math.abs(actions[j].t - actions[i].t) < 0.002) j++;
        const group = actions.slice(i, j).sort((a, b) => a.pos[0] - b.pos[0]);
        // simultaneous notes: left ones to the left hand
        group.forEach((a, k) => {
            const preferSide = group.length > 1 ? (k < group.length / 2 ? 0 : 1) : null;
            let list = candidates(a).filter((c) => c.s >= 0);
            if (preferSide !== null) {
                const pref = list.filter((c) => c.h.side === preferSide);
                if (pref.length) list = pref;
            }
            let pick;
            if (list.length) {
                // the nearest finger, but one that has only just let go gets a rest (a jack alternates)
                const score = (c) => dist(c.f.pos, a.pos) + (a.t - c.f.freeAt < 0.15 ? 0.6 : 0);
                pick = list.reduce((best, c) => (score(c) < score(best) ? c : best));
            } else {
                pick = candidates(a).reduce((best, c) => (c.s > best.s ? c : best));
            }
            const { h, f } = pick;
            let t0 = a.t;
            if (pick.s < 0 && Number.isFinite(pick.s)) {
                if (-pick.s > 0.06) late.push({ id: a.note.id, by: -pick.s });
                t0 += -pick.s;
            } else if (!Number.isFinite(pick.s)) {
                late.push({ id: a.note.id, by: 9 });
                t0 += 0.3;
            }
            const jitter = bias + random.gauss() * style.timeSigma;
            const ex = random.gauss() * style.posSigma;
            const ey = random.gauss() * style.posSigma;
            const dur = a.end - a.t;
            if (dist(h.anchor, a.pos) > style.reach) h.anchor = a.pos;
            if (a.mode === 'screen') {
                // dragging: a slow swipe towards the next note on the glass; the finger lifts a
                // little before it gets there, so the press itself is a fresh one
                if (!style.lift && f.screen && dist(f.pos, a.pos) > 0.01) {
                    const arrive = t0 - 0.03;
                    const from = Math.max(
                        f.lastScreenEnd + 0.01,
                        arrive - dist(f.pos, a.pos) / style.dragSpeed
                    );
                    const liftAt = Math.min(arrive, t0 - style.liftBefore);
                    if (liftAt > from + 0.02) {
                        strokes.push({
                            id: a.note.id,
                            role: 'transit',
                            mode: 'screen',
                            t0: from,
                            t1: liftAt,
                            pts: [
                                { t: from, x: f.pos[0], y: f.pos[1] },
                                { t: arrive, x: a.pos[0] + ex, y: a.pos[1] + ey },
                            ],
                            r: style.tapFoot,
                        });
                    }
                }
                const pts = a.slide
                    ? a.points.map((p) => ({
                          t: p.t + jitter,
                          x: p.x + ex + random.gauss() * style.posSigma * 0.4,
                          y: p.y + ey + random.gauss() * style.posSigma * 0.4,
                      }))
                    : [
                          { t: t0 + jitter, x: a.pos[0] + ex, y: a.pos[1] + ey },
                          { t: a.end + jitter, x: a.pos[0] + ex, y: a.pos[1] + ey },
                      ];
                if (a.slide) {
                    pts.unshift({ t: t0 + jitter, x: pts[0].x, y: pts[0].y });
                    pts.push({
                        t: a.end + jitter,
                        x: pts[pts.length - 1].x,
                        y: pts[pts.length - 1].y,
                    });
                }
                strokes.push({
                    id: a.note.id,
                    role: a.slide ? 'slide' : dur > 0.2 ? 'hold' : 'press',
                    mode: 'screen',
                    t0: pts[0].t,
                    t1: pts[pts.length - 1].t,
                    pts,
                    r: a.foot,
                    target: a.sIdx,
                });
                f.pos = [pts[pts.length - 1].x, pts[pts.length - 1].y];
                f.screen = !style.lift;
                f.lastScreenEnd = pts[pts.length - 1].t;
                f.freeAt = a.end + jitter;
            } else {
                strokes.push({
                    id: a.note.id,
                    role: dur > 0.2 ? 'hold' : 'press',
                    mode: 'btn',
                    lane: a.lane,
                    t0: t0 + jitter,
                    t1: a.end + jitter,
                    pts: null,
                    r: 0,
                });
                f.pos = a.pos;
                f.screen = false;
                f.freeAt = a.end + jitter;
            }
        });
        i = j;
    }
    return { strokes, late };
}

module.exports = { plan, rng, actionsOf };
