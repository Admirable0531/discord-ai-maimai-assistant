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
    // how this run's player shares the work between hands: free (the nearest finger),
    // by side (each hand keeps its own half), or by role (one hand slides and holds,
    // the other taps and touches)
    const habit =
        style.habit && style.habit !== 'mixed'
            ? style.habit
            : (() => {
                  const x = random.next();
                  return x < 0.4 ? 'free' : x < 0.7 ? 'side' : 'role';
              })();
    const slideSide = random.next() < 0.5 ? 0 : 1;
    // a player who sets a slide off with the hand that did not tap its star
    const handsOff = random.next() < (style.handoff ?? 0.3);
    const starHand = new Map();
    const wantedSide = (a) => {
        if (handsOff && a.slide) {
            const prev = starHand.get(`${a.note.head}@${Math.round(a.note.t * 1000)}`);
            if (prev !== undefined) return 1 - prev;
        }
        if (habit === 'role') return a.slide || a.end - a.t > 0.2 ? slideSide : 1 - slideSide;
        if (habit === 'side') return a.pos[0] < -0.15 ? 0 : a.pos[0] > 0.15 ? 1 : null;
        return null;
    };

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
            const wanted = wantedSide(a);
            const preferSide =
                wanted !== null ? wanted : group.length > 1 ? (k < group.length / 2 ? 0 : 1) : null;
            let list = candidates(a).filter((c) => c.s >= 0);
            if (preferSide !== null && wanted === null) {
                const pref = list.filter((c) => c.h.side === preferSide);
                if (pref.length) list = pref;
            }
            let pick;
            if (list.length) {
                // the nearest finger, but one that has only just let go gets a rest (a jack alternates)
                const score = (c) =>
                    dist(c.f.pos, a.pos) +
                    (a.t - c.f.freeAt < 0.15 ? 0.6 : 0) +
                    (wanted !== null && c.h.side !== wanted
                        ? style.crossCost * (habit === 'role' ? 4 : 2)
                        : 0);
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
            if (a.note.kind === 'tap')
                starHand.set(`${a.note.lane}@${Math.round(a.note.t * 1000)}`, h.side);
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
                            hand: h.side,
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
                // a finger arriving at speed lands a little past the note, in the direction it came from
                let ox = 0;
                let oy = 0;
                if (!a.slide && style.overshoot > 0 && dist(f.pos, a.pos) > 0.01) {
                    const d = dist(f.pos, a.pos);
                    const mag = Math.abs(random.gauss()) * style.overshoot;
                    ox = ((a.pos[0] - f.pos[0]) / d) * mag;
                    oy = ((a.pos[1] - f.pos[1]) / d) * mag;
                }
                // a slide that is not drawn straight: a slow sideways wander along the path, and
                // a last point that lands a little off the end sensor
                const wanderPhase = [random.next() * 6.283, random.next() * 6.283];
                const wanderF = [0.8 + random.next() * 0.5, 2 + random.next()];
                const ends = [
                    random.gauss() * (style.endSigma || 0),
                    random.gauss() * (style.endSigma || 0),
                ];
                const wander = (i, n, dx, dy) => {
                    const amp = style.wander || 0;
                    if (!amp) return [0, 0];
                    const sFrac = n < 2 ? 0 : i / (n - 1);
                    const w =
                        amp *
                        (0.6 * Math.sin(6.283 * wanderF[0] * sFrac + wanderPhase[0]) +
                            0.4 * Math.sin(6.283 * wanderF[1] * sFrac + wanderPhase[1]));
                    const l = Math.hypot(dx, dy) || 1;
                    return [(-dy / l) * w, (dx / l) * w];
                };
                const pts = a.slide
                    ? a.points.map((p, i, all) => {
                          const prev = all[Math.max(0, i - 1)];
                          const next = all[Math.min(all.length - 1, i + 1)];
                          const [wx, wy] = wander(i, all.length, next.x - prev.x, next.y - prev.y);
                          const last = i === all.length - 1;
                          return {
                              t: p.t + jitter,
                              x:
                                  p.x +
                                  ex +
                                  wx +
                                  (last ? ends[0] : 0) +
                                  random.gauss() * style.posSigma * 0.4,
                              y:
                                  p.y +
                                  ey +
                                  wy +
                                  (last ? ends[1] : 0) +
                                  random.gauss() * style.posSigma * 0.4,
                          };
                      })
                    : [
                          { t: t0 + jitter, x: a.pos[0] + ex + ox, y: a.pos[1] + ey + oy },
                          { t: a.end + jitter, x: a.pos[0] + ex + ox, y: a.pos[1] + ey + oy },
                      ];
                if (a.slide) {
                    pts.unshift({ t: t0 + jitter, x: pts[0].x, y: pts[0].y });
                    pts.push({
                        t: a.end + jitter,
                        x: pts[pts.length - 1].x,
                        y: pts[pts.length - 1].y,
                    });
                    // the finger keeps travelling a little past the last sensor before it lifts
                    const n = a.points.length;
                    const sx = a.points[n - 1].x - a.points[Math.max(0, n - 2)].x;
                    const sy = a.points[n - 1].y - a.points[Math.max(0, n - 2)].y;
                    const sl = Math.hypot(sx, sy);
                    const over = Math.abs(random.gauss()) * (style.overshoot || 0);
                    if (sl > 0.01 && over > 0.005) {
                        const last = pts[pts.length - 1];
                        const v =
                            sl / Math.max(0.05, a.points[n - 1].t - a.points[Math.max(0, n - 2)].t);
                        pts.push({
                            t: last.t + Math.min(0.15, over / Math.max(v, 0.5)),
                            x: last.x + (sx / sl) * over,
                            y: last.y + (sy / sl) * over,
                        });
                    }
                }
                strokes.push({
                    hand: h.side,
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
                f.freeAt = Math.max(a.end + jitter, pts[pts.length - 1].t);
            } else {
                strokes.push({
                    hand: h.side,
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
    return { strokes, late, habit, slideSide };
}

module.exports = { plan, rng, actionsOf };
