/* global localStorage, D, $, setup, at, draw, active */
// Browser-side playfield for the chart viewer. Inlined into the page by
// viewerPage.js, so it must stay plain browser JavaScript with no imports.
// Look and layout follow the game's play screen (own drawings, not its art):
// a dark field, the judgement ring with eight dots, faint sensor outlines,
// notes growing as they run out from the centre, hollow-star slide heads and
// dense chevron strips that follow the slide's real shape.

const DEF = {
    tapSpeed: 7.5,
    touchSpeed: 7.5,
    tapScale: 1,
    holdScale: 1,
    touchScale: 1,
    slideScale: 1,
    slideGap: 1,
    slideOffset: 0,
    sound: 1,
    volume: 0.6,
    labels: 1,
    guides: 1,
};
// What 'normal' looks like here, tuned by eye against the game: a displayed
// tap speed of 7.5 runs at this internal speed, and the sizes below are the 1.0 sizes.
const BASE = {
    tapSpeed: 11.5 / 7.5,
    tap: 0.95,
    hold: 0.95,
    touch: 1.35,
    slideGap: 1.3,
    slideOffset: -0.15,
};
let cfg = Object.assign({}, DEF);
try {
    Object.assign(cfg, JSON.parse(localStorage.getItem('chartViewerCfg2') || '{}'));
} catch {
    /* storage unavailable: defaults are fine */
}
const saveCfg = () => {
    try {
        localStorage.setItem('chartViewerCfg2', JSON.stringify(cfg));
    } catch {
        /* ignore */
    }
};
// Motion rules follow the game's: distances in units where the judgement ring is 4.8.
const U = 4.8;
const INNER = 1.225; // a button note appears here and grows in place before it runs outward
const RATE = 0.265;
/** Where a button note due at time t is on its lane (fraction of the ring radius) and how big it is. */
function tapState(t) {
    const d = U - (t - at) * cfg.tapSpeed * BASE.tapSpeed;
    if (d >= INNER) return { frac: Math.min(1, d / U), scale: 1 };
    const scale = d * RATE + (1 - RATE * INNER);
    return { frac: INNER / U, scale: Math.max(0, Math.min(1, scale)) };
}
/** Seconds before the hit that a button note first appears. */
const tapLead = () => (U + (1 - RATE * INNER) / RATE) / (cfg.tapSpeed * BASE.tapSpeed);
const touchWhole = () => 3.209385682 * Math.pow(cfg.touchSpeed, -0.9549621752);
/** A touch note fades in, then its four triangles close in, quickly at the end. */
function touchState(t) {
    const whole = touchWhole();
    const move = 0.8 * whole;
    const tau = at - t; // negative before the hit
    if (-tau > whole) return null;
    const alpha = -tau > move ? Math.max(0, Math.min(1, (whole + tau) / (0.2 * whole))) : 1;
    let gap = 0.4;
    if (-tau <= move)
        gap = Math.max(0, Math.min(0.4, -Math.exp(8 * ((tau * 0.43) / move) - 0.85) + 0.42));
    return { alpha, gap: (gap / U) * R };
}
/** Slide arrows start to fade in this long before the star lands. */
const slideLead = () =>
    3.926913 / (cfg.tapSpeed * BASE.tapSpeed) + cfg.slideOffset + BASE.slideOffset;
const TRAIL = 0.05; // notes vanish as they are hit; just long enough to avoid a flicker

const COL = {
    tap: '#ff4fa3',
    each: '#ffd23f',
    brk: '#ff8a2a',
    touch: '#27d3df',
    slide: { main: '#1fd6ff', dark: '#07607d', star: '#3d7bff' },
    slideEach: { main: '#ffd23f', dark: '#8a5a00', star: '#ffd23f' },
    slideBrk: { main: '#ff8a2a', dark: '#7a2a00', star: '#ff8a2a' },
};
const WHITE = 'rgba(255,255,255,.95)';
const noteColor = (e) => (e.k === 'b' ? COL.brk : e.e ? COL.each : COL.tap);
const slideColor = (e) => (e.b ? COL.slideBrk : e.e ? COL.slideEach : COL.slide);
// ----- geometry (set at the start of every draw) -----
let C = 0;
let R = 0;
const wrap8 = (n) => ((((n - 1) % 8) + 8) % 8) + 1;
const ang = (lane) => ((22.5 + 45 * (lane - 1)) * Math.PI) / 180; // clockwise from the top
const pt = (a, r) => [C + r * Math.sin(a), C - r * Math.cos(a)];
const dot = (lane) => pt(ang(lane), R);
/** Sensor centre. A and B sit on the buttons' angles, D and E between them. */
function xy(name) {
    if (name === 'C') return [C, C];
    const L = name[0];
    const n = +name.slice(1);
    const a = L === 'A' || L === 'B' ? ang(n) : (45 * (n - 1) * Math.PI) / 180;
    return pt(a, { A: 0.78, B: 0.405, D: 0.88, E: 0.575 }[L] * R);
}
/** A point on a lane at `frac` of the ring radius. */
const laneAt = (lane, frac) => pt(ang(lane), R * frac);

// ----- slide shapes: the path the chevrons actually follow -----
function arcPts(a0, sweep, r0, r1) {
    const n = Math.max(8, Math.ceil(Math.abs(sweep) / 0.09));
    const out = [];
    for (let i = 0; i <= n; i++) out.push(pt(a0 + (sweep * i) / n, r0 + ((r1 - r0) * i) / n));
    return out;
}
/**
 * p/q slide: leave the button along the tangent to the centre circle, go round
 * it, leave along the tangent to the end button. `dir` is +1 clockwise.
 */
function loopPts(sLane, eLane, dir) {
    const cr = R * Math.cos((3 * Math.PI) / 8);
    const delta = Math.acos(cr / R);
    const a0 = ang(sLane);
    const a1 = ang(eLane);
    const entry = a0 + dir * delta;
    const exit = a1 - dir * delta;
    // clockwise travel from entry to exit, a full turn when they coincide
    let sweep = (dir * (exit - entry)) % (2 * Math.PI);
    if (sweep < 0) sweep += 2 * Math.PI;
    if (sweep < 1e-3) sweep = 2 * Math.PI;
    const out = [pt(a0, R)];
    const n = Math.max(12, Math.ceil(sweep / 0.09));
    for (let i = 0; i <= n; i++) out.push(pt(entry + (dir * sweep * i) / n, cr));
    out.push(pt(a1, R));
    return out;
}
/**
 * pp/qq slide: in through the centre, round a circle (radius ~0.46R, centred
 * toward the diagonal two lanes along), out to the ring two lanes back, then
 * along the ring; the longer variants finish with a pass through the centre.
 * Built to match the sensor sequences of the judging tables.
 */
function smoothPts(pts, rounds) {
    let p = pts;
    for (let k = 0; k < rounds; k++) {
        const q = [p[0]];
        for (let i = 0; i < p.length - 1; i++) {
            const a = p[i];
            const b = p[i + 1];
            q.push(
                [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
                [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]
            );
        }
        q.push(p[p.length - 1]);
        p = q;
    }
    return p;
}
function outerLoopPts(sLane, eLane, dir) {
    return smoothPts(outerLoopRaw(sLane, eLane, dir), 2);
}
/**
 * pp/qq slide, in the game's own geometry (unit = ring radius, y up): a
 * tangent leg from the button to a circle of radius b through the centre, a
 * turn round it, a transfer arc that meets the ring tangentially, then the ring.
 * Longer variants return inside for a pass through the centre.
 */
function outerLoopRaw(sLane, eLane, dir) {
    const ccw = dir === -1;
    const b = Math.cos(Math.PI / 8) / 2;
    const a = 1 - b;
    const th = Math.PI / 4;
    const sT = (a * a + b * b - 2 * a * b * Math.cos(th)) / (2 * a - 2 * b * Math.cos(th));
    const TR = b + sT; // transfer circle radius
    const math = (lane) => Math.PI * (5 / 8 - lane / 4);
    const TAU = 2 * Math.PI;
    const mod = (x) => ((x % TAU) + TAU) % TAU;
    const toS = (p) => [C + p[0] * R, C - p[1] * R];
    const polar = (r, ang0) => [r * Math.cos(ang0), r * Math.sin(ang0)];
    const ts = math(sLane);
    const ppqq = ccw ? ts - (3 * Math.PI) / 8 : ts + (3 * Math.PI) / 8;
    const cc = polar(b, ppqq);
    const P = polar(1, ts);
    const hv = [P[0] - cc[0], P[1] - cc[1]];
    const tanRad =
        Math.atan2(hv[1], hv[0]) + (ccw ? 1 : -1) * Math.acos(b / Math.hypot(hv[0], hv[1]));
    const endRad = ppqq + (ccw ? th : -th);
    const ct = polar(1 - TR, endRad);
    const exitRad = Math.atan2(cc[1] - ct[1], cc[0] - ct[0]); // where the two circles touch
    const sweep1 = ccw ? mod(exitRad - tanRad) : mod(tanRad - exitRad);
    const sweep2 = ccw ? mod(endRad - exitRad) : mod(exitRad - endRad);
    const pts = [P];
    const arc = (center, rad, from, sweep, n) => {
        for (let i = 0; i <= n; i++)
            pts.push([
                center[0] + rad * Math.cos(from + ((ccw ? 1 : -1) * (sweep * i)) / n),
                center[1] + rad * Math.sin(from + ((ccw ? 1 : -1) * (sweep * i)) / n),
            ]);
    };
    arc(cc, b, tanRad, sweep1, 18);
    const join = pts.length - 1;
    arc(ct, TR, exitRad, sweep2, 14);
    const transferEnd = pts.length - 1;
    // along the ring back to the start button
    const ringTo = (target) => {
        const sw = ccw ? mod(target - endRad) : mod(endRad - target);
        const n = Math.max(2, Math.ceil(sw / 0.09));
        for (let i = 1; i <= n; i++) pts.push(polar(1, endRad + ((ccw ? 1 : -1) * (sw * i)) / n));
    };
    ringTo(ts);
    const k = (((dir * (eLane - sLane)) % 8) + 8) % 8;
    const te = math(eLane);
    const cut = (from, to) => {
        // first point between from..to whose polar angle has reached the end button
        for (let i = from; i <= to; i++) {
            const d = ((Math.atan2(pts[i][1], pts[i][0]) - te + 3 * Math.PI) % TAU) - Math.PI;
            if (ccw ? d >= 0 : d <= 0) return i;
        }
        return to;
    };
    const inner = (lane) => polar(0.405, math(lane));
    if (k === 6) return pts.slice(0, join + 1).map(toS);
    if (k === 7) return pts.slice(0, cut(join, transferEnd) + 1).map(toS);
    if (k === 0) return pts.map(toS);
    const out = pts.slice();
    if (k === 1) {
        for (let i = 1; i <= 6; i++)
            out.push(polar(1, ts + ((ccw ? 1 : -1) * ((Math.PI / 4) * i)) / 6));
    } else if (k === 2) {
        out.push(inner(sLane), inner(wrap8(sLane + dir)), polar(1, te));
    } else {
        out.push(inner(sLane), [0, 0], inner(eLane), polar(1, te));
    }
    return out.map(toS);
}
function segPts(shape, s, via) {
    const e = via[via.length - 1];
    const dir = /Ccw/.test(shape) ? -1 : 1;
    const f = (((dir * (e - s)) % 8) + 8) % 8;
    switch (shape) {
        case 'StraightLine':
            return [dot(s), dot(e)];
        case 'Fold':
            return [dot(s), [C, C], dot(e)];
        case 'RingCw':
        case 'RingCcw':
            return arcPts(ang(s), dir * (f === 0 ? 8 : f) * (Math.PI / 4), R * 0.97, R * 0.97);
        case 'CurveCw':
        case 'CurveCcw':
            return loopPts(s, e, dir);
        case 'EdgeCurveCw':
        case 'EdgeCurveCcw':
            return outerLoopPts(s, e, dir);
        case 'EdgeFold':
            return [dot(s), dot(via[0]), dot(e)];
        case 'ZigZagS':
        case 'ZigZagZ': {
            const m = shape === 'ZigZagS' ? 1 : -1;
            return [
                dot(s),
                pt(ang(wrap8(s - 2 * m)), R * 0.5),
                [C, C],
                pt(ang(wrap8(s + 2 * m)), R * 0.5),
                dot(wrap8(s + 4)),
            ];
        }
        default:
            return [dot(s), dot(e)];
    }
}
/** One polyline per track (three for a WiFi slide), with lengths for walking along it. */
function prep(points) {
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
        cum.push(
            cum[i - 1] +
                Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
        );
    }
    return { pts: points, cum, total: cum[cum.length - 1] || 1 };
}
function slideTracks(e) {
    const key = C + ':' + R;
    if (e._key === key) return e._tracks;
    let tracks;
    if (e.w) tracks = [3, 4, 5].map((k) => prep([dot(e.h), dot(wrap8(e.h + k))]));
    else {
        let pts = [];
        let start = e.h;
        for (const seg of e.g) {
            const part = segPts(seg.s, start, seg.v);
            pts = pts.length ? pts.concat(part.slice(1)) : part;
            start = seg.v[seg.v.length - 1];
        }
        tracks = [prep(pts)];
    }
    e._key = key;
    e._tracks = tracks;
    return tracks;
}
/** [x, y, tangentX, tangentY] at distance d along a prepared polyline. */
function along(p, d) {
    const dd = Math.max(0, Math.min(p.total, d));
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < dd) i++;
    const a = p.pts[i - 1];
    const b = p.pts[i];
    const seg = p.cum[i] - p.cum[i - 1] || 1;
    const k = (dd - p.cum[i - 1]) / seg;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [
        a[0] + (b[0] - a[0]) * k,
        a[1] + (b[1] - a[1]) * k,
        (b[0] - a[0]) / L,
        (b[1] - a[1]) / L,
    ];
}

// ----- drawing helpers -----
/** Star rotation (radians) at the current time: the faster the slide, the faster it spins. */
function starSpin(e, tracks) {
    const dur = Math.max(0.15, e.z - e.a);
    const wait = 180 / dur; // degrees a second while it waits and approaches
    const len = tracks[0].total / R;
    const move = Math.min(1080, (150 * len) / dur);
    const before = Math.min(at, e.a) - e.t;
    const during = at > e.a ? at - e.a : 0;
    return (-(wait * before + move * during) * Math.PI) / 180;
}
/** The strip's opacity: 0.5 after a 0.2 s fade-in, 1 from 50 ms before the star reaches its button. */
function slideAlpha(e) {
    const lead = slideLead();
    const start = e.t - lead;
    if (at < start) return 0;
    if (at >= e.t - 0.05) return 1;
    return 0.5 * Math.min(1, (at - start) / Math.min(0.2, Math.max(0.01, lead - 0.05)));
}
function glow(g, on) {
    if (on) {
        g.shadowColor = '#fff3b0';
        g.shadowBlur = 16;
    }
}
function tapNote(g, x, y, r0, c, ex, brk) {
    const r = Math.max(r0, 4);
    const band = Math.max(3, r * 0.36);
    g.save();
    glow(g, ex);
    g.lineWidth = band + 3;
    g.strokeStyle = WHITE;
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.stroke();
    g.restore();
    g.lineWidth = band;
    g.strokeStyle = c;
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.stroke();
    g.lineWidth = 1.4;
    g.strokeStyle = 'rgba(255,255,255,.8)';
    g.beginPath();
    g.arc(x, y, r - band * 0.5, 0, 7);
    g.stroke();
    g.fillStyle = 'rgba(70,20,70,.55)';
    g.beginPath();
    g.arc(x, y, Math.max(1, r - band * 0.5 - 1), 0, 7);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.beginPath();
    g.arc(x, y, Math.max(1.2, r * 0.13), 0, 7);
    g.fill();
    if (brk) {
        g.lineWidth = 1.6;
        g.strokeStyle = '#ff3b2f';
        g.beginPath();
        g.arc(x, y, r + band * 0.55, 0, 7);
        g.stroke();
    }
    if (ex) {
        g.lineWidth = 1.6;
        g.strokeStyle = '#fff3b0';
        g.beginPath();
        g.arc(x, y, r + band * 0.9, 0, 7);
        g.stroke();
    }
}
function starPath(g, x, y, r, rot) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5 + rot;
        const rr = i % 2 ? r * 0.5 : r;
        g.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    g.closePath();
}
function starNote(g, x, y, r0, sc, ex, rot = 0) {
    const r = Math.max(r0, 3);
    g.save();
    glow(g, ex);
    starPath(g, x, y, r, rot);
    g.fillStyle = 'rgba(6,14,50,.92)';
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, r * 0.3) + 3;
    g.strokeStyle = WHITE;
    g.stroke();
    g.restore();
    starPath(g, x, y, r, rot);
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, r * 0.3);
    g.strokeStyle = sc;
    g.stroke();
    g.fillStyle = WHITE;
    g.beginPath();
    g.arc(x, y, Math.max(1.5, r * 0.16), 0, 7);
    g.fill();
}
function hexOutline(g, x1, y1, x2, y2, w, k, dirx, diry) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    const ux = L > 0.5 ? dx / L : dirx;
    const uy = L > 0.5 ? dy / L : diry;
    const nx = -uy;
    const ny = ux;
    g.beginPath();
    g.moveTo(x1 - ux * k, y1 - uy * k);
    g.lineTo(x1 + nx * w, y1 + ny * w);
    g.lineTo(x2 + nx * w, y2 + ny * w);
    g.lineTo(x2 + ux * k, y2 + uy * k);
    g.lineTo(x2 - nx * w, y2 - ny * w);
    g.lineTo(x1 - nx * w, y1 - ny * w);
    g.closePath();
}
function holdNote(g, tx, ty, hx, hy, r0, c, ex, dirx, diry) {
    const r = Math.max(r0, 4);
    g.save();
    glow(g, ex);
    hexOutline(g, tx, ty, hx, hy, r, r * 0.75, dirx, diry);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, r * 0.34) + 3;
    g.strokeStyle = WHITE;
    g.stroke();
    g.restore();
    hexOutline(g, tx, ty, hx, hy, r, r * 0.75, dirx, diry);
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, r * 0.34);
    g.strokeStyle = c;
    g.stroke();
}
function roundedPoly(g, pts, rad) {
    const n = pts.length;
    g.beginPath();
    for (let i = 0; i < n; i++) {
        const p = pts[i];
        const a = pts[(i + n - 1) % n];
        const b = pts[(i + 1) % n];
        const da = Math.hypot(a[0] - p[0], a[1] - p[1]);
        const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
        const ra = Math.min(rad, da / 2);
        const rb = Math.min(rad, db / 2);
        const p1 = [p[0] + ((a[0] - p[0]) / da) * ra, p[1] + ((a[1] - p[1]) / da) * ra];
        const p2 = [p[0] + ((b[0] - p[0]) / db) * rb, p[1] + ((b[1] - p[1]) / db) * rb];
        i ? g.lineTo(p1[0], p1[1]) : g.moveTo(p1[0], p1[1]);
        g.quadraticCurveTo(p[0], p[1], p2[0], p2[1]);
    }
    g.closePath();
}
const TOUCH_COL = { single: '#27d3df', each: '#e3e32c', brk: '#ff4b3a' };
function touchNote(g, x, y, r0, c, gap, ex, held, flash) {
    const r = Math.max(r0, 3);
    g.save();
    if (flash) {
        // the moment it is hit: a rounded white square
        roundedPoly(
            g,
            [
                [x - r * 1.5, y - r * 1.5],
                [x + r * 1.5, y - r * 1.5],
                [x + r * 1.5, y + r * 1.5],
                [x - r * 1.5, y + r * 1.5],
            ],
            r * 0.55
        );
        g.shadowColor = '#fff';
        g.shadowBlur = 12;
        g.lineWidth = 3.2;
        g.strokeStyle = WHITE;
        g.stroke();
        g.restore();
        return;
    }
    // corner brackets marking the touch area
    const d = r * 1.75;
    const L = r * 0.7;
    g.shadowColor = c;
    g.shadowBlur = 8;
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.strokeStyle = c;
    for (const [sx, sy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
    ]) {
        g.beginPath();
        g.moveTo(x + sx * d, y + sy * (d - L));
        g.quadraticCurveTo(x + sx * d, y + sy * d, x + sx * (d - L), y + sy * d);
        g.stroke();
    }
    // four rounded fans, tips toward the centre
    for (let i = 0; i < 4; i++) {
        g.save();
        g.translate(x, y);
        g.rotate((i * Math.PI) / 2);
        const tip = r * 0.15 + gap;
        const base = tip + r * 1.15;
        roundedPoly(
            g,
            [
                [0, -tip],
                [-r * 1.2, -base],
                [r * 1.2, -base],
            ],
            r * 0.3
        );
        if (ex) {
            g.shadowColor = '#fff3b0';
            g.shadowBlur = 14;
        } else {
            g.shadowColor = c;
            g.shadowBlur = 10;
        }
        g.fillStyle = c + '66';
        g.fill();
        g.lineJoin = 'round';
        g.lineWidth = 2.4;
        g.strokeStyle = WHITE;
        g.stroke();
        g.restore();
    }
    g.shadowColor = c;
    g.shadowBlur = 10;
    g.fillStyle = WHITE;
    g.beginPath();
    g.arc(x, y, Math.max(2, r * 0.2), 0, 7);
    g.fill();
    if (held) {
        roundedPoly(
            g,
            [
                [x, y - r * 1.15],
                [x + r * 1.15, y],
                [x, y + r * 1.15],
                [x - r * 1.15, y],
            ],
            r * 0.3
        );
        g.lineWidth = 2.2;
        g.strokeStyle = WHITE;
        g.stroke();
    }
    g.restore();
}
function chevron(g, x, y, tx, ty, size, col, alpha) {
    const px = -ty;
    const py = tx;
    const h = size * 1.7;
    const d = size * 0.95;
    const draw = () => {
        g.beginPath();
        g.moveTo(x - tx * d + px * h, y - ty * d + py * h);
        g.lineTo(x + tx * d, y + ty * d);
        g.lineTo(x - tx * d - px * h, y - ty * d - py * h);
    };
    g.globalAlpha = alpha;
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    draw();
    g.lineWidth = size * 0.85 + 4;
    g.strokeStyle = col.dark;
    g.stroke();
    draw();
    g.lineWidth = size * 0.85;
    g.strokeStyle = col.main;
    g.stroke();
    g.globalAlpha = 1;
}

// ----- sensor layout: the real panel tiles the whole circle -----
const D2R = Math.PI / 180;
function sector(g, a0, a1, r0, r1) {
    g.beginPath();
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.08));
    for (let i = 0; i <= n; i++) {
        const [x, y] = pt(a0 + ((a1 - a0) * i) / n, r1);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    for (let i = n; i >= 0; i--) {
        const [x, y] = pt(a0 + ((a1 - a0) * i) / n, r0);
        g.lineTo(x, y);
    }
    g.closePath();
}
function regularPolygon(g, x, y, r, sides, rot) {
    g.beginPath();
    for (let i = 0; i < sides; i++) {
        const a = rot + (i * 2 * Math.PI) / sides;
        g.lineTo(x + r * Math.sin(a), y - r * Math.cos(a));
    }
    g.closePath();
}
/** The outline of one sensor, ready to stroke or fill. */
function sensorShape(g, name) {
    const L = name[0];
    const n = +name.slice(1);
    const [x, y] = xy(name);
    if (L === 'C') return regularPolygon(g, x, y, R * 0.17, 8, Math.PI / 8);
    if (L === 'B') return regularPolygon(g, x, y, R * 0.145, 8, Math.PI / 8);
    if (L === 'E') {
        const diamond = n % 2 === 1;
        if (diamond) return regularPolygon(g, x, y, R * 0.15, 4, 0);
        return regularPolygon(g, x, y, R * 0.14, 4, Math.PI / 4);
    }
    if (L === 'A') return sector(g, ang(n) - 15 * D2R, ang(n) + 15 * D2R, R * 0.62, R * 0.995);
    return sector(
        g,
        ((45 * (n - 1) - 7.5) * Math.PI) / 180,
        ((45 * (n - 1) + 7.5) * Math.PI) / 180,
        R * 0.76,
        R * 0.995
    );
}
const SENSOR_NAMES = ['C'];
for (let n = 1; n <= 8; n++) SENSOR_NAMES.push('A' + n, 'B' + n, 'D' + n, 'E' + n);
function drawSensors(g, lit) {
    for (const name of SENSOR_NAMES) {
        const on = lit.has(name);
        const inner = name[0] === 'A' || name[0] === 'D';
        sensorShape(g, name);
        g.fillStyle = on
            ? 'rgba(255,210,63,.22)'
            : inner
              ? 'rgba(255,255,255,.015)'
              : 'rgba(255,255,255,.04)';
        g.fill();
        g.lineWidth = on ? 2 : 1;
        g.strokeStyle = on ? '#ffd23f' : inner ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.26)';
        g.stroke();
    }
}

// ----- the frame -----
function litSensors() {
    const lit = new Set();
    for (const f of D.findings) {
        if (!active.has(f.r) || f.t < at - 0.2 || f.t > at + 0.7) continue;
        (f.x.match(/\b([ABDE][1-8]|C)\b/g) || []).forEach((s) => lit.add(s));
    }
    return lit;
}
// eslint-disable-next-line no-unused-vars
function drawRing() {
    const c = $('ring');
    const size = Math.min(c.clientWidth, 400);
    const [g, w] = setup(c, size);
    C = size / 2;
    R = C - 16;
    const ox = (w - size) / 2;
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, w, size);
    g.save();
    g.translate(ox, 0);
    const noteR = R * 0.105 * cfg.tapScale * BASE.tap;
    const slideSz = R * 0.045 * cfg.slideScale;
    const slideGap = R * 0.09 * cfg.slideScale * cfg.slideGap * BASE.slideGap;

    if (cfg.guides) {
        drawSensors(g, litSensors());
    }
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(C, C, R, 0, 7);
    g.stroke();
    for (let n = 1; n <= 8; n++) {
        const [x, y] = dot(n);
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(x, y, 4.5, 0, 7);
        g.fill();
        if (cfg.labels) {
            const [lx, ly] = pt(ang(n), R * 0.9);
            g.fillStyle = 'rgba(255,255,255,.45)';
            g.font = '11px sans-serif';
            g.textAlign = 'center';
            g.fillText(n, lx, ly + 4);
        }
    }

    // slide strips, then their stars
    for (const e of D.events) {
        if (e.k !== 's') continue;
        if (e.z < at - TRAIL || e.t - slideLead() > at) continue;
        const col = slideColor(e);
        const tracks = slideTracks(e);
        const moving = at >= e.a && e.z > e.a;
        const k = moving ? Math.min(1, (at - e.a) / (e.z - e.a)) : 0;
        const out = at > e.z ? Math.max(0, 1 - (at - e.z) / TRAIL) : 1;
        for (const tr of tracks) {
            const n = Math.max(1, Math.floor(tr.total / slideGap));
            for (let i = 0; i < n; i++) {
                const d = (i + 0.5) * (tr.total / n);
                if (d < k * tr.total) continue; // the star has already passed it
                // as in the game: fade in to half brightness, full just before the star lands
                const a = slideAlpha(e) * out;
                if (a <= 0.01) continue;
                const [x, y, tx, ty] = along(tr, d);
                chevron(g, x, y, tx, ty, slideSz, col, a);
            }
        }
    }
    for (const e of D.events) {
        if (e.k !== 's') continue;
        if (e.z < at - TRAIL || e.t - tapLead() > at) continue;
        const col = slideColor(e);
        const fade = at > e.z ? Math.max(0, 1 - (at - e.z) / TRAIL) : 1;
        g.globalAlpha = fade;
        const tracks = slideTracks(e);
        const r = noteR * (e.w ? 1.25 : 1);
        if (at < e.t) {
            const st = tapState(e.t);
            const [x, y] = laneAt(e.h, st.frac);
            if (st.scale > 0) starNote(g, x, y, r * st.scale, col.star, false, starSpin(e, tracks));
        } else if (at < e.a || e.z <= e.a) {
            const [x, y] = dot(e.h);
            starNote(g, x, y, r, col.star, false, starSpin(e, tracks));
        } else {
            const k = Math.min(1, (at - e.a) / (e.z - e.a));
            for (const tr of tracks) {
                const [x, y] = along(tr, k * tr.total);
                starNote(g, x, y, r, col.star, false, starSpin(e, tracks));
            }
        }
        g.globalAlpha = 1;
    }

    // taps, holds and touches
    for (const e of D.events) {
        if (e.k === 's') continue;
        const end = e.z && e.z > e.t ? e.z : e.t;
        const lead = e.n ? touchWhole() : tapLead();
        const tailT = e.n && e.k !== 'th' ? 0.12 : TRAIL; // a touch note flashes as it is hit
        if (e.t - lead > at || end < at - tailT) continue;
        const out = at > end ? Math.max(0, 1 - (at - end) / tailT) : 1;
        if (e.n) {
            const ts = touchState(e.t);
            if (!ts) continue;
            g.globalAlpha = ts.alpha * out;
            const [x, y] = xy(e.n);
            const r = R * 0.055 * cfg.touchScale * BASE.touch;
            const hold = e.k === 'th' && at >= e.t && at <= e.z;
            sensorShape(g, e.n);
            g.fillStyle =
                (e.e ? 'rgba(227,227,44,' : 'rgba(39,211,223,') +
                (hold ? 0.3 : 0.16) * (e.n[0] === 'A' || e.n[0] === 'D' ? 0.55 : 1) * ts.alpha +
                ')';
            g.fill();
            const c = e.e ? TOUCH_COL.each : TOUCH_COL.single;
            if (e.k === 'th' && at >= e.t && at <= e.z) {
                g.lineWidth = 3;
                g.strokeStyle = c;
                g.beginPath();
                g.arc(x, y, r * 2.2, 0, 7);
                g.stroke();
            }
            touchNote(g, x, y, r, c, ts.gap, e.x, e.k === 'th', e.k !== 'th' && at >= e.t);
            if (cfg.labels) {
                g.fillStyle = 'rgba(255,255,255,.5)';
                g.font = '9px sans-serif';
                g.textAlign = 'center';
                g.fillText(e.n, x, y - r * 1.9 - ts.gap);
            }
        } else {
            g.globalAlpha = out;
            const st = tapState(e.t);
            if (st.scale <= 0) {
                g.globalAlpha = 1;
                continue;
            }
            const [x, y] = laneAt(e.l, st.frac);
            if (e.k === 'h') {
                const r =
                    noteR * ((cfg.holdScale * BASE.hold) / (cfg.tapScale * BASE.tap)) * st.scale;
                const tail = tapState(e.z);
                const [tx, ty] = laneAt(e.l, at >= e.t ? Math.min(1, tail.frac) : tail.frac);
                holdNote(
                    g,
                    tx,
                    ty,
                    x,
                    y,
                    r * 0.95,
                    noteColor(e),
                    e.x,
                    Math.sin(ang(e.l)),
                    -Math.cos(ang(e.l))
                );
            } else if (e.st) {
                starNote(
                    g,
                    x,
                    y,
                    noteR * 1.05 * st.scale,
                    e.e ? COL.slideEach.star : COL.slide.star,
                    e.x
                );
            } else {
                tapNote(g, x, y, noteR * st.scale, noteColor(e), e.x, e.k === 'b');
            }
        }
        g.globalAlpha = 1;
    }
    g.restore();
}

// ----- hitsounds: simple synthesized sounds, one per kind of note -----
let audioCtx = null;
function audio() {
    if (!audioCtx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        try {
            audioCtx = AC ? new AC() : null;
        } catch {
            audioCtx = null;
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}
function tone(ac, when, f0, f1, dur, gain, type) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur);
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(ac.destination);
    o.start(when);
    o.stop(when + dur + 0.02);
}
function noise(ac, when, dur, gain, freq) {
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(ac.destination);
    src.start(when);
}
function hitSound(kind, ex, vol) {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    const v = vol;
    if (kind === 'b') {
        noise(ac, t, 0.12, 0.9 * v, 2600);
        tone(ac, t, 520, 140, 0.16, 0.7 * v, 'triangle');
        tone(ac, t, 1500, 900, 0.09, 0.4 * v);
    } else if (kind === 'c' || kind === 'th') {
        tone(ac, t, 1568, 1500, 0.2, 0.4 * v);
        tone(ac, t, 2349, 2300, 0.14, 0.22 * v);
    } else if (kind === 's') {
        tone(ac, t, 700, 1500, 0.14, 0.3 * v);
        tone(ac, t + 0.05, 1760, 1700, 0.18, 0.25 * v);
    } else {
        tone(ac, t, 1100, 650, 0.08, 0.55 * v);
        noise(ac, t, 0.02, 0.4 * v, 4000);
    }
    if (ex) tone(ac, t, 2400, 2000, 0.07, 0.25 * v);
}
let soundEvents = null;
// eslint-disable-next-line no-unused-vars
function primeAudio() {
    audio(); // must be started from a click
}
/** Play the sounds of every note whose time lies in (from, to]. Called while playing. */
// eslint-disable-next-line no-unused-vars
function playSounds(from, to) {
    if (!cfg.sound || to <= from || to - from > 0.5) return;
    if (!soundEvents) {
        soundEvents = D.events
            .map((e) => ({ t: e.k === 's' ? e.z : e.t, k: e.k, x: e.x }))
            .sort((a, b) => a.t - b.t);
    }
    let lo = 0;
    let hi = soundEvents.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (soundEvents[mid].t <= from) lo = mid + 1;
        else hi = mid;
    }
    let n = 0;
    for (let i = lo; i < soundEvents.length && soundEvents[i].t <= to; i++) {
        if (n++ < 8)
            hitSound(soundEvents[i].k, soundEvents[i].x, cfg.volume / Math.sqrt(Math.max(1, n)));
    }
}

// ----- display settings -----
const CFG = [
    ['tapSpeed', 'Tap speed', 1, 12, 0.5],
    ['touchSpeed', 'Touch speed', 1, 12, 0.5],
    ['tapScale', 'Tap size', 0.6, 1.6, 0.05],
    ['holdScale', 'Hold size', 0.6, 1.6, 0.05],
    ['touchScale', 'Touch size', 0.6, 1.6, 0.05],
    ['slideScale', 'Slide size', 0.6, 1.8, 0.05],
    ['slideGap', 'Slide arrow gap', 0.6, 2, 0.05],
    ['slideOffset', 'Slide fade-in offset (s)', -0.5, 0.5, 0.05],
    ['volume', 'Hitsound volume', 0, 1, 0.05],
];
$('cfg').innerHTML =
    CFG.map(
        ([k, l, mn, mx, st]) =>
            '<div class="sw"><label>' +
            l +
            '</label><input type="range" data-k="' +
            k +
            '" min="' +
            mn +
            '" max="' +
            mx +
            '" step="' +
            st +
            '" value="' +
            cfg[k] +
            '"><output>' +
            cfg[k] +
            '</output></div>'
    ).join('') +
    '<div class="sw"><label><input type="checkbox" data-k="labels"' +
    (cfg.labels ? ' checked' : '') +
    '> Labels</label><label><input type="checkbox" data-k="guides"' +
    (cfg.guides ? ' checked' : '') +
    '> Sensors</label><label><input type="checkbox" data-k="sound"' +
    (cfg.sound ? ' checked' : '') +
    '> Hitsounds</label><button id="cfgreset">Reset</button></div>';
document.querySelectorAll('#cfg input').forEach((i) => {
    i.oninput = () => {
        cfg[i.dataset.k] = i.type === 'checkbox' ? (i.checked ? 1 : 0) : +i.value;
        if (i.nextElementSibling) i.nextElementSibling.textContent = cfg[i.dataset.k];
        saveCfg();
        draw();
    };
});
$('cfgreset').onclick = () => {
    cfg = Object.assign({}, DEF);
    saveCfg();
    document.querySelectorAll('#cfg input').forEach((i) => {
        if (i.type === 'checkbox') i.checked = !!cfg[i.dataset.k];
        else {
            i.value = cfg[i.dataset.k];
            i.nextElementSibling.textContent = cfg[i.dataset.k];
        }
    });
    draw();
};
