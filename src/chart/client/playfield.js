/* global localStorage, D, $, setup, at, draw, active, LEAD, BEAT, go, esc */
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
    touchScale: 0.8,
    slideScale: 1,
    slideGap: 1.35,
    slideOffset: 0,
    volume: 0.6,
    offset: 0, // ms: hitsounds later (+) or earlier (-) than the picture
    mirror: 0, // 0 off, 1 left-right, 2 up-down, 3 rotate 180
    judgeLine: 0, // 0 normal, 1 simple, 2 none
    ddr: 0, // 0 off, 1 colour taps/holds by rhythm, 2 also touches and slides
    labels: 1,
    guides: 1,
    sound: 1,
    soundHoldEnd: 1,
    soundTouch: 1,
    soundEachDistinct: 0,
    spin: 1,
    pinkStart: 0,
    exEmph: 1,
    eachBreakYellow: 0,
    breakSlideNormal: 0,
    keepPlay: 1,
    info: 1,
    maidata: 1,
};
// What 'normal' looks like here, tuned by eye against the game: a displayed
// tap speed of 7.5 runs at this internal speed, and the sizes below are the 1.0 sizes.
const BASE = {
    tapSpeed: 11.5 / 7.5,
    tap: 0.95,
    hold: 0.95,
    touch: 2.2,
    slideGap: 1, // the game's arrows sit about 0.09 of the ring radius apart
    slideOffset: -0.15,
};
let cfg = Object.assign({}, DEF);
try {
    Object.assign(cfg, JSON.parse(localStorage.getItem('chartViewerCfg3') || '{}'));
} catch {
    /* storage unavailable: defaults are fine */
}
const saveCfg = () => {
    try {
        localStorage.setItem('chartViewerCfg3', JSON.stringify(cfg));
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
    slide: { main: '#22d8ff', dark: '#04374a', star: '#3d7bff', wifi: '#22b5b8' },
    slideEach: { main: '#f2d62b', dark: '#2c2800', star: '#ffd23f', wifi: '#c9c21f' },
    slideBrk: { main: '#ff8a2a', dark: '#7a2a00', star: '#ff8a2a', wifi: '#e0761c' },
};
const WHITE = 'rgba(255,255,255,.95)';
const DDR = ['#ff3b3b', '#3d82ff', '#ffd23f', '#b469ff', '#ff6fd0', '#ff9a3d', '#9aa5b8'];
function noteColor(e) {
    if (cfg.ddr >= 1 && e.q !== undefined) return DDR[e.q];
    if (e.k === 'b') return e.e && cfg.eachBreakYellow ? COL.each : COL.brk;
    return e.e ? COL.each : COL.tap;
}
/** Colour of a slide star that is a plain note (a slide's own head). */
function starHeadColor(e) {
    if (cfg.ddr >= 1 && e.q !== undefined) return DDR[e.q];
    if (cfg.pinkStart) return '#ff5fa2';
    return e.e ? COL.slideEach.star : COL.slide.star;
}
function slideColor(e) {
    if (cfg.ddr >= 2 && e.q !== undefined)
        return { main: DDR[e.q], dark: '#1a1a1a', star: DDR[e.q], wifi: DDR[e.q] };
    if (e.b && !cfg.breakSlideNormal) return COL.slideBrk;
    // the strip is yellow only for a double slide; the star head is yellow for any simultaneous note
    const strip = e.e ? COL.slideEach : COL.slide;
    const head = e.he || e.e ? COL.slideEach.star : COL.slide.star;
    return { ...strip, star: cfg.pinkStart ? '#ff5fa2' : head };
}
// ----- geometry (set at the start of every draw) -----
let C = 0;
let R = 0;
const wrap8 = (n) => ((((n - 1) % 8) + 8) % 8) + 1;
const ang = (lane) => ((22.5 + 45 * (lane - 1)) * Math.PI) / 180; // clockwise from the top
/** Mirror option: points are flipped about the centre (display only). */
function mirror(p) {
    const m = cfg.mirror;
    if (!m) return p;
    return [m === 1 || m === 3 ? 2 * C - p[0] : p[0], m === 2 || m === 3 ? 2 * C - p[1] : p[1]];
}
const pt = (a, r) => mirror([C + r * Math.sin(a), C - r * Math.cos(a)]);
/** The same without the mirror: fixed things such as the button numbers. */
const ptRaw = (a, r) => [C + r * Math.sin(a), C - r * Math.cos(a)];
/** The name of the sensor now at the place the sensor `name` normally is. */
function mirrorName(name) {
    const m = cfg.mirror;
    if (!m || name === 'C') return name;
    const L = name[0];
    const n = +name.slice(1);
    const lane = L === 'A' || L === 'B';
    let k;
    if (m === 1) k = lane ? 9 - n : 2 - n;
    else if (m === 2) k = lane ? 5 - n : 6 - n;
    else k = n + 4;
    return L + wrap8(k);
}
const dot = (lane) => pt(ang(lane), R);
/** Sensor centre. A and B sit on the buttons' angles, D and E between them. */
function xy(name) {
    if (name === 'C') return [C, C];
    const L = name[0];
    const n = +name.slice(1);
    const a = L === 'A' || L === 'B' ? ang(n) : (45 * (n - 1) * Math.PI) / 180;
    return pt(a, { A: 0.83, B: 0.466, D: 0.85, E: 0.646 }[L] * R);
}
/** Unit vector pointing outward along a lane, as drawn. */
function laneDirection(lane) {
    const a = laneAt(lane, 0.4);
    const b = laneAt(lane, 1);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
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
function outerLoopPts(sLane, eLane, dir) {
    return outerLoopRaw(sLane, eLane, dir);
}
/**
 * pp/qq slide in the game's geometry (unit = ring radius, y up). The path
 * leaves the start button along the tangent to a circle of radius b that
 * passes through the centre, turns round it, and leaves along the tangent
 * to the end button; if that turn would be short it takes a full extra lap.
 * Measured against the game's arrow positions for every variant.
 */
function outerLoopRaw(sLane, eLane, dir) {
    const ccw = dir === -1;
    const sgn = ccw ? 1 : -1;
    const b = Math.cos(Math.PI / 8) / 2;
    const TAU = 2 * Math.PI;
    const mod = (x) => ((x % TAU) + TAU) % TAU;
    const math = (lane) => Math.PI * (5 / 8 - lane / 4);
    const toS = (p) => mirror([C + p[0] * R, C - p[1] * R]);
    const ts = math(sLane);
    const ppqq = ccw ? ts - (3 * Math.PI) / 8 : ts + (3 * Math.PI) / 8;
    const cc = [b * Math.cos(ppqq), b * Math.sin(ppqq)];
    const tangentAngle = (lane, inward) => {
        const node = [Math.cos(math(lane)), Math.sin(math(lane))];
        const h = [node[0] - cc[0], node[1] - cc[1]];
        const d = Math.acos(b / Math.hypot(h[0], h[1]));
        return Math.atan2(h[1], h[0]) + (inward ? sgn : -sgn) * d;
    };
    const entry = tangentAngle(sLane, true);
    const exit = tangentAngle(eLane, false);
    let sweep = ccw ? mod(exit - entry) : mod(entry - exit);
    if (sweep < Math.PI / 2) sweep += TAU;
    const on = (ang0) => [cc[0] + b * Math.cos(ang0), cc[1] + b * Math.sin(ang0)];
    const pts = [[Math.cos(ts), Math.sin(ts)]];
    const n = Math.max(24, Math.ceil(sweep / 0.08));
    for (let i = 0; i <= n; i++) pts.push(on(entry + sgn * ((sweep * i) / n)));
    pts.push([Math.cos(math(eLane)), Math.sin(math(eLane))]);
    return pts.map(toS);
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
            return arcPts(ang(s), dir * (f === 0 ? 8 : f) * (Math.PI / 4), R, R);
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
                pt(ang(wrap8(s - 2 * m)), R * 0.4142),
                [C, C],
                pt(ang(wrap8(s + 2 * m)), R * 0.4142),
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
    if (!cfg.spin) return 0;
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
function starNote(g, x, y, r0, sc, ex, rot = 0, brk = false) {
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
    if (brk) {
        // a break star: a red rim round the orange outline and two sparkles, like a break tap
        starPath(g, x, y, r * 1.28, rot);
        g.lineJoin = 'round';
        g.lineWidth = Math.max(1.6, r * 0.12);
        g.strokeStyle = '#ff3b2f';
        g.stroke();
        g.fillStyle = WHITE;
        for (const a of [-0.9, 2.2]) {
            g.beginPath();
            g.arc(
                x + Math.cos(a + rot) * r * 0.78,
                y + Math.sin(a + rot) * r * 0.78,
                Math.max(1.2, r * 0.1),
                0,
                7
            );
            g.fill();
        }
    }
}
/** Hexagon with a point at each end of the lane: regular when the tail is at the head, then stretched. */
function hexOutline(g, tx, ty, hx, hy, r, ux, uy) {
    const nx = -uy;
    const ny = ux;
    const h = 0.866 * r;
    g.beginPath();
    g.moveTo(hx + ux * r, hy + uy * r);
    g.lineTo(hx + ux * r * 0.5 + nx * h, hy + uy * r * 0.5 + ny * h);
    g.lineTo(tx - ux * r * 0.5 + nx * h, ty - uy * r * 0.5 + ny * h);
    g.lineTo(tx - ux * r, ty - uy * r);
    g.lineTo(tx - ux * r * 0.5 - nx * h, ty - uy * r * 0.5 - ny * h);
    g.lineTo(hx + ux * r * 0.5 - nx * h, hy + uy * r * 0.5 - ny * h);
    g.closePath();
}
function holdNote(g, tx, ty, hx, hy, r0, c, ex, dirx, diry) {
    const r = Math.max(r0, 4);
    g.save();
    glow(g, ex);
    hexOutline(g, tx, ty, hx, hy, r, dirx, diry);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, r * 0.34) + 3;
    g.strokeStyle = WHITE;
    g.stroke();
    g.restore();
    hexOutline(g, tx, ty, hx, hy, r, dirx, diry);
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
const TOUCH_COL = { single: '#22c7ff', each: '#ffe91f', brk: '#ff4b3a' };
function touchNote(g, x, y, r0, c, gap, ex, held, flash) {
    const r = Math.max(r0, 3);
    g.save();
    if (flash) {
        // the moment it is hit: a rounded white square
        roundedPoly(
            g,
            [
                [x - r * 1.35, y - r * 1.35],
                [x + r * 1.35, y - r * 1.35],
                [x + r * 1.35, y + r * 1.35],
                [x - r * 1.35, y + r * 1.35],
            ],
            r * 0.5
        );
        g.shadowColor = '#fff';
        g.shadowBlur = 12;
        g.lineWidth = 3.2;
        g.strokeStyle = WHITE;
        g.stroke();
        g.restore();
        return;
    }
    // a faint backing so the sensor outline does not cut through the note
    const d = r * 1.3;
    roundedPoly(
        g,
        [
            [x - d, y - d],
            [x + d, y - d],
            [x + d, y + d],
            [x - d, y + d],
        ],
        r * 0.4
    );
    g.fillStyle = 'rgba(3,7,16,.28)';
    g.fill();
    // four hollow fans, tips toward the centre
    for (let i = 0; i < 4; i++) {
        g.save();
        g.translate(x, y);
        g.rotate((i * Math.PI) / 2);
        const tip = r * 0.47 + gap;
        const base = tip + r * 0.87;
        roundedPoly(
            g,
            [
                [0, -tip],
                [-r * 0.83, -base],
                [r * 0.83, -base],
            ],
            r * 0.14
        );
        g.shadowColor = ex ? '#fff3b0' : c;
        g.shadowBlur = ex ? 14 : 10;
        g.fillStyle = c + '1a';
        g.fill();
        g.lineJoin = 'round';
        g.lineWidth = Math.max(2.6, r * 0.2);
        g.strokeStyle = c;
        g.stroke();
        g.shadowBlur = 0;
        g.lineWidth = 1.2;
        g.strokeStyle = 'rgba(255,255,255,.75)';
        g.stroke();
        g.restore();
    }
    g.shadowColor = c;
    g.shadowBlur = 12;
    g.fillStyle = c;
    g.beginPath();
    g.arc(x, y, Math.max(2.5, r * 0.19), 0, 7);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.beginPath();
    g.arc(x, y, Math.max(1, r * 0.08), 0, 7);
    g.fill();
    if (held) {
        roundedPoly(
            g,
            [
                [x, y - r * 1.1],
                [x + r * 1.1, y],
                [x, y + r * 1.1],
                [x - r * 1.1, y],
            ],
            r * 0.3
        );
        g.lineWidth = 2.2;
        g.strokeStyle = WHITE;
        g.stroke();
    }
    g.restore();
}
const TH_FANS = ['#ff4b4b', '#ffe94a', '#3ddc5a', '#3fd6ff']; // top, right, bottom, left, as in the game
const TH_BREAK = '#ffb23a';
/**
 * A touch hold: four filled fans (red, yellow, green, blue) that close in on the
 * middle, then, once held, a rounded diamond whose coloured edge fills clockwise
 * from the top as the hold runs. `prog` is 0..1 through the hold, or -1 before it.
 */
function touchHoldNote(g, x, y, r0, gap, ex, prog, brk) {
    const r = Math.max(r0, 3) * 1.15;
    g.save();
    const half = r * 1.62;
    const diamond = [
        [x, y - half],
        [x + half, y],
        [x, y + half],
        [x - half, y],
    ];
    if (prog < 0) {
        for (let i = 0; i < 4; i++) {
            const c = brk ? TH_BREAK : TH_FANS[i];
            g.save();
            g.translate(x, y);
            g.rotate((i * Math.PI) / 2);
            const tip = r * 0.5 + gap;
            const base = tip + r * 1.02;
            roundedPoly(
                g,
                [
                    [0, -tip],
                    [-r * 0.95, -base],
                    [r * 0.95, -base],
                ],
                r * 0.17
            );
            g.shadowColor = c;
            g.shadowBlur = ex ? 16 : 11;
            g.fillStyle = c;
            g.fill();
            g.shadowBlur = 0;
            g.lineJoin = 'round';
            g.lineWidth = Math.max(2, r * 0.17);
            g.strokeStyle = 'rgba(255,255,255,.95)';
            g.stroke();
            g.restore();
        }
        g.fillStyle = 'rgba(255,255,255,.9)';
        g.beginPath();
        g.arc(x, y, Math.max(1.6, r * 0.1), 0, 7);
        g.fill();
        g.restore();
        return;
    }
    // held: the grey diamond, and over it the coloured edge filled so far
    roundedPoly(g, diamond, r * 0.34);
    g.fillStyle = 'rgba(255,255,255,.06)';
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, r * 0.26);
    g.strokeStyle = 'rgba(255,255,255,.38)';
    g.stroke();
    const perimeter = 4 * Math.hypot(half, half);
    const grad = g.createConicGradient ? g.createConicGradient(-Math.PI / 4, x, y) : null;
    if (grad) {
        const cs = brk ? [TH_BREAK, '#ffd27a', TH_BREAK, '#ffd27a'] : TH_FANS;
        cs.forEach((c, i) => grad.addColorStop(i / 4, c));
        grad.addColorStop(1, cs[0]);
    }
    g.shadowColor = brk ? TH_BREAK : '#ffffff';
    g.shadowBlur = 10;
    g.strokeStyle = grad || WHITE;
    g.setLineDash([Math.max(0, perimeter * Math.min(1, prog)), perimeter]);
    // start at the top vertex and go clockwise
    roundedPoly(g, diamond, r * 0.34);
    g.stroke();
    g.setLineDash([]);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.beginPath();
    g.arc(x, y, Math.max(2, r * 0.13), 0, 7);
    g.fill();
    g.restore();
}
/**
 * One bar of the WiFi slide. i = 0..10. Its apex sits on the line from the
 * start button to the middle end button, and its arms run parallel to the
 * lines from that end button to the two neighbouring ones (so they are 67.5
 * degrees off the axis); the last bar spans the three end buttons exactly.
 * Flat teal bands, as in the game.
 */
function wifiBar(g, e, i, col, alpha) {
    const S = dot(e.h);
    const E1 = dot(wrap8(e.h + 3));
    const Ec = dot(wrap8(e.h + 4));
    const E2 = dot(wrap8(e.h + 5));
    const f = 0.13 + 0.087 * i; // how far along the axis
    const q = 0.22 + 0.78 * (i / 10); // how much of the final arm length
    const A = [S[0] + (Ec[0] - S[0]) * f, S[1] + (Ec[1] - S[1]) * f];
    const L = [A[0] + (E1[0] - Ec[0]) * q, A[1] + (E1[1] - Ec[1]) * q];
    const Rr = [A[0] + (E2[0] - Ec[0]) * q, A[1] + (E2[1] - Ec[1]) * q];
    g.save();
    g.globalAlpha = alpha * 0.85;
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    g.strokeStyle = col.wifi;
    g.lineWidth = R * 0.05;
    g.beginPath();
    g.moveTo(L[0], L[1]);
    g.lineTo(A[0], A[1]);
    g.lineTo(Rr[0], Rr[1]);
    g.stroke();
    g.restore();
}
function chevron(g, x, y, tx, ty, size, col, alpha) {
    const px = -ty;
    const py = tx;
    const h = size * 1.45;
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
    if (L === 'B') return regularPolygon(g, x, y, R * 0.165, 8, Math.PI / 8);
    if (L === 'E') {
        const diamond = n % 2 === 1;
        if (diamond) return regularPolygon(g, x, y, R * 0.146, 4, 0);
        return regularPolygon(g, x, y, R * 0.148, 4, Math.PI / 4);
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
    if (simReplay)
        for (const [i, a, b] of simReplay.sensors) if (a <= at && at < b) lit.add(SENSOR_NAMES[i]);
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
    const slideGap = R * 0.0896 * cfg.slideScale * cfg.slideGap * BASE.slideGap;

    if (cfg.guides) {
        drawSensors(g, litSensors());
    }
    if (cfg.judgeLine !== 2) {
        const simple = cfg.judgeLine === 1;
        g.strokeStyle = simple ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.95)';
        g.lineWidth = simple ? 1.2 : 2.5;
        g.beginPath();
        g.arc(C, C, R, 0, 7);
        g.stroke();
    }
    for (let n = 1; n <= 8; n++) {
        if (cfg.judgeLine === 0) {
            const [x, y] = ptRaw(ang(n), R);
            g.fillStyle = '#fff';
            g.beginPath();
            g.arc(x, y, 4.5, 0, 7);
            g.fill();
        }
        if (cfg.labels) {
            const [lx, ly] = ptRaw(ang(n), R * 0.9);
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
        if (e.w) {
            // eleven bars along the axis; the stars have passed those behind them
            const a = slideAlpha(e) * out;
            for (let i = 0; i < 11; i++) {
                const f = 0.13 + 0.087 * i;
                if (f > k && a > 0.01) wifiBar(g, e, i, col, a);
            }
            continue;
        }
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
        const tailT = TRAIL;
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
            const c =
                cfg.ddr >= 2 && e.q !== undefined
                    ? DDR[e.q]
                    : e.e
                      ? TOUCH_COL.each
                      : TOUCH_COL.single;
            if (e.k === 'th') {
                const prog = at >= e.t && e.z > e.t ? Math.min(1, (at - e.t) / (e.z - e.t)) : -1;
                touchHoldNote(g, x, y, r, ts.gap, e.x && cfg.exEmph, prog, e.b);
            } else {
                touchNote(g, x, y, r, c, ts.gap, e.x && cfg.exEmph, false, false);
            }
            if (cfg.labels) {
                g.fillStyle = 'rgba(255,255,255,.5)';
                g.font = '9px sans-serif';
                g.textAlign = 'center';
                g.fillText(mirrorName(e.n), x, y - r * 1.9 - ts.gap);
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
                    e.x && cfg.exEmph,
                    ...laneDirection(e.l)
                );
            } else if (e.st) {
                starNote(
                    g,
                    x,
                    y,
                    noteR * 1.05 * st.scale,
                    e.k === 'b' ? noteColor(e) : starHeadColor(e),
                    e.x && cfg.exEmph,
                    0,
                    e.k === 'b'
                );
            } else {
                tapNote(g, x, y, noteR * st.scale, noteColor(e), e.x && cfg.exEmph, e.k === 'b');
            }
        }
        g.globalAlpha = 1;
    }
    drawHands(g);
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
function hitSound(kind, ex, vol, each) {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    const v = vol;
    const up = cfg.soundEachDistinct && each ? 1.26 : 1; // simultaneous notes sound a little higher
    if (kind === 'b') {
        noise(ac, t, 0.12, 0.9 * v, 2600);
        tone(ac, t, 520, 140, 0.16, 0.7 * v, 'triangle');
        tone(ac, t, 1500, 900, 0.09, 0.4 * v);
    } else if (kind === 'c' || kind === 'th') {
        tone(ac, t, 1568 * up, 1500 * up, 0.2, 0.4 * v);
        tone(ac, t, 2349, 2300, 0.14, 0.22 * v);
    } else if (kind === 'he') {
        tone(ac, t, 900, 500, 0.06, 0.35 * v); // a hold letting go
    } else if (kind === 's') {
        tone(ac, t, 700, 1500, 0.14, 0.3 * v);
        tone(ac, t + 0.05, 1760, 1700, 0.18, 0.25 * v);
    } else {
        tone(ac, t, 1100 * up, 650 * up, 0.08, 0.55 * v);
        noise(ac, t, 0.02, 0.4 * v, 4000);
    }
    if (ex) tone(ac, t, 2400, 2000, 0.07, 0.25 * v);
    if (cfg.soundEachDistinct && each && kind !== 'he')
        tone(ac, t + 0.02, 2800, 2600, 0.06, 0.18 * v);
}
/** The metronome count-in before the chart starts: a click on every beat, higher on each "1". */
// eslint-disable-next-line no-unused-vars
function countIn(from, to) {
    if (!cfg.sound || from >= 0 || to <= from || to - from > 0.5) return;
    const ac = audio();
    if (!ac) return;
    const k0 = Math.max(0, Math.ceil((from + LEAD) / BEAT - 1e-9));
    for (let k = k0; k * BEAT - LEAD <= to && k * BEAT < LEAD - 1e-9; k++) {
        if (k * BEAT - LEAD <= from && from > -LEAD) continue;
        const first = k % 4 === 0;
        const t = ac.currentTime;
        tone(ac, t, first ? 1760 : 1175, first ? 1700 : 1150, 0.07, 0.5 * cfg.volume);
    }
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
        soundEvents = [];
        for (const e of D.events) {
            soundEvents.push({ t: e.k === 's' ? e.z : e.t, k: e.k, x: e.x, e: e.e });
            if ((e.k === 'h' || e.k === 'th') && e.z > e.t) soundEvents.push({ t: e.z, k: 'he' });
        }
        soundEvents.sort((a, b) => a.t - b.t);
    }
    const off = cfg.offset / 1000;
    // a sound plays when the picture reaches (note time + offset)
    const lo0 = from - off;
    const hi0 = to - off;
    let lo = 0;
    let hi = soundEvents.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (soundEvents[mid].t <= lo0) lo = mid + 1;
        else hi = mid;
    }
    let n = 0;
    for (let i = lo; i < soundEvents.length && soundEvents[i].t <= hi0; i++) {
        const ev = soundEvents[i];
        if (ev.k === 'he' && !cfg.soundHoldEnd) continue;
        if ((ev.k === 'c' || ev.k === 'th') && !cfg.soundTouch) continue;
        if (n++ < 8) hitSound(ev.k, ev.x, cfg.volume / Math.sqrt(Math.max(1, n)), ev.e);
    }
}

// ----- plain-language terms: tap a dotted word to see what it means -----
const TERM_RE =
    /\b(splash|brush|trill|stream|jack|burst|triplets?|touch group|BPM|Perfect|[ABDE][1-8]|C)\b/gi;
/** Escaped text with known terms wrapped so a tap shows their meaning. */
function explain(text) {
    const safe = String(text).replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
    return safe.replace(TERM_RE, (m) => {
        const sensor = /^[abde][1-8]$|^c$/i.test(m);
        let def;
        if (sensor) {
            if (m !== m.toUpperCase()) return m;
            def = D.sensors[m[0]];
        } else {
            const key = m.toLowerCase().replace(/s$/, '');
            const g = D.glossary.find(
                (x) => x.t.toLowerCase() === key || x.t.toLowerCase() === m.toLowerCase()
            );
            def = g && g.d;
        }
        return def
            ? '<span class="term" data-d="' + def.replace(/"/g, '&quot;') + '">' + m + '</span>'
            : m;
    });
}
(function termTips() {
    const tip = document.createElement('div');
    tip.id = 'tip';
    document.body.appendChild(tip);
    document.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('.term');
        if (t) {
            tip.textContent = t.dataset.d;
            tip.style.display = 'block';
            e.stopPropagation();
        } else tip.style.display = 'none';
    });
    const dl = $('gloss');
    if (dl) {
        dl.innerHTML =
            D.glossary.map((g) => '<dt>' + g.t + '</dt><dd>' + g.d + '</dd>').join('') +
            Object.keys(D.sensors)
                .map((k) => '<dt>' + k + ' sensors</dt><dd>' + D.sensors[k] + '</dd>')
                .join('');
    }
})();

// ----- info row and maidata that follows the timeline -----
/** Tempo and note division in force at time t. */
function tempoAt(t) {
    let cur = D.tempo[0] || { bpm: 120, div: 4 };
    for (const x of D.tempo) if (x.t <= t + 1e-6) cur = x;
    return cur;
}
let totals = null;
function countTotals() {
    if (totals) return totals;
    const times = [];
    const breakTimes = [];
    for (const e of D.events) {
        const t = e.k === 's' ? e.z : e.t;
        times.push(t);
        if (e.k === 'b' || (e.k === 's' && e.b)) breakTimes.push(t);
    }
    times.sort((a, b) => a - b);
    breakTimes.sort((a, b) => a - b);
    totals = { times, breakTimes };
    return totals;
}
const upTo = (arr, t) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
};
// eslint-disable-next-line no-unused-vars
function updateInfo() {
    const el = $('info');
    if (!el) return;
    el.style.visibility = cfg.info ? 'visible' : 'hidden';
    if (!cfg.info) return;
    const tp = tempoAt(at);
    const tt = countTotals();
    el.textContent =
        'BPM ' +
        Math.round(tp.bpm * 100) / 100 +
        '  ·  1/' +
        tp.div +
        '  ·  Notes ' +
        upTo(tt.times, at) +
        '/' +
        tt.times.length +
        '  ·  Breaks ' +
        upTo(tt.breakTimes, at) +
        '/' +
        tt.breakTimes.length;
}
let mdIndex = '';
// eslint-disable-next-line no-unused-vars
function updateMaidata() {
    const box = $('mdp');
    if (!box) return;
    box.style.display = D.maidata && cfg.maidata ? '' : 'none';
    if (!D.maidata || !cfg.maidata) return;
    const lines = D.maidata;
    let i = 0;
    while (i + 1 < lines.length && lines[i + 1].t <= at + 1e-6) i++;
    // which comma-separated step of that line is playing now
    let step = -1;
    const steps = lines[i].steps;
    for (let k = 0; k < steps.length; k++) if (steps[k].t <= at + 1e-6) step = k;
    const key = i + ':' + step;
    if (key === mdIndex) return;
    mdIndex = key;
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const out = [];
    for (let k = Math.max(0, i - 1); k < Math.min(lines.length, i + 9); k++) {
        const l = lines[k];
        const m = Math.floor(l.t / 60);
        const sec = (l.t % 60).toFixed(1).padStart(4, '0');
        let body;
        if (k === i && step >= 0) {
            const st = steps[step];
            body =
                esc(l.s.slice(0, st.from)) +
                '<mark>' +
                esc(l.s.slice(st.from, st.to)) +
                '</mark>' +
                esc(l.s.slice(st.to));
        } else body = esc(l.s);
        out.push(
            '<div class="mdl' +
                (k === i ? ' cur' : '') +
                '"><span class="mdt">' +
                m +
                ':' +
                sec +
                '</span> ' +
                body +
                '</div>'
        );
    }
    $('md').innerHTML = out.join('');
}

// ----- display settings -----
const RANGES = [
    ['tapSpeed', 'Tap speed', 1, 12, 0.5],
    ['touchSpeed', 'Touch speed', 1, 12, 0.5],
    ['tapScale', 'Tap size', 0.6, 1.6, 0.05],
    ['holdScale', 'Hold size', 0.6, 1.6, 0.05],
    ['touchScale', 'Touch size', 0.4, 1.6, 0.05],
    ['slideScale', 'Slide size', 0.6, 1.8, 0.05],
    ['slideGap', 'Slide arrow gap', 0.6, 2, 0.05],
    ['slideOffset', 'Slide fade-in offset (s)', -0.5, 0.5, 0.05],
    ['volume', 'Hitsound volume', 0, 1, 0.05],
];
const SELECTS = [
    ['mirror', 'Mirror', ['Off', 'Left-right', 'Up-down', 'Rotate 180°']],
    ['judgeLine', 'Judgement line', ['Normal', 'Simple', 'None']],
    ['ddr', 'Rhythm colours (DDR style)', ['Off', 'On', 'On (extended)']],
];
const CHECKS = [
    ['labels', 'Labels'],
    ['guides', 'Sensors'],
    ['sound', 'Hitsounds'],
    ['soundHoldEnd', 'Hold end sound'],
    ['soundTouch', 'Touch sound'],
    ['soundEachDistinct', 'Distinct simultaneous sound'],
    ['spin', 'Star rotation'],
    ['pinkStart', 'Slide start pink'],
    ['exEmph', 'Highlight EX notes'],
    ['eachBreakYellow', 'Simultaneous breaks yellow'],
    ['breakSlideNormal', 'Break slides in normal colour'],
    ['info', 'BPM and note counts'],
    ['maidata', 'Maidata'],
    ['keepPlay', 'Keep playing after seeking'],
];
const esc2 = (t) =>
    String(t).replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
function buildSettings() {
    const rows = RANGES.map(
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
    ).join('');
    const offset =
        '<div class="sw" style="flex-wrap:wrap"><label>Hitsound offset (ms)</label><output>' +
        cfg.offset +
        '</output><div style="flex:1 0 100%;display:flex;gap:6px;align-items:center"><button class="step" data-d="-10">−10</button><button class="step" data-d="-1">−1</button><input type="range" data-k="offset" min="-400" max="400" step="1" value="' +
        cfg.offset +
        '"><button class="step" data-d="1">+1</button><button class="step" data-d="10">+10</button></div></div>';
    const selects = SELECTS.map(
        ([k, l, opts]) =>
            '<div class="sw"><label>' +
            l +
            '</label><select data-k="' +
            k +
            '">' +
            opts
                .map(
                    (o, i) =>
                        '<option value="' +
                        i +
                        '"' +
                        (cfg[k] === i ? ' selected' : '') +
                        '>' +
                        esc2(o) +
                        '</option>'
                )
                .join('') +
            '</select></div>'
    ).join('');
    const checks =
        '<div class="checks">' +
        CHECKS.map(
            ([k, l]) =>
                '<label class="ck"><input type="checkbox" data-k="' +
                k +
                '"' +
                (cfg[k] ? ' checked' : '') +
                '> ' +
                l +
                '</label>'
        ).join('') +
        '</div><div class="sw"><button id="cfgreset">Reset</button></div>';
    $('cfg').innerHTML = rows + offset + selects + checks;
    document.querySelectorAll('#cfg input, #cfg select').forEach((i) => {
        i.oninput = i.onchange = () => {
            const k = i.dataset.k;
            cfg[k] =
                i.type === 'checkbox'
                    ? i.checked
                        ? 1
                        : 0
                    : i.tagName === 'SELECT'
                      ? +i.value
                      : +i.value;
            const out = i.closest('.sw').querySelector('output');
            if (out && i.type === 'range') out.textContent = cfg[k];
            if (k === 'offset' || k === 'mirror') {
                /* handled by the next draw */
            }
            mdIndex = '';
            saveCfg();
            draw();
        };
    });
    document.querySelectorAll('#cfg .step').forEach((b) => {
        b.onclick = () => {
            cfg.offset = Math.max(-400, Math.min(400, cfg.offset + +b.dataset.d));
            const r = document.querySelector('#cfg input[data-k=offset]');
            r.value = cfg.offset;
            r.closest('.sw').querySelector('output').textContent = cfg.offset;
            saveCfg();
        };
    });
    $('cfgreset').onclick = () => {
        cfg = Object.assign({}, DEF);
        saveCfg();
        mdIndex = '';
        buildSettings();
        draw();
    };
}
buildSettings();

// ----- simulation: virtual hands playing the chart -----
let simReplay = null; // {sensors: [[index, from, to]], strokes: [...]} of the style shown
let SIM = null; // the last result from the server
const simPos = (pts, t) => {
    if (t <= pts[1]) return [pts[2], pts[3]];
    for (let i = 3; i < pts.length; i += 3) {
        if (t <= pts[i + 1 - 1] || i + 3 >= pts.length) {
            const a = i - 3;
            const k =
                pts[i] === pts[a] ? 1 : Math.min(1, Math.max(0, (t - pts[a]) / (pts[i] - pts[a])));
            return [
                pts[a + 1] + (pts[i + 1] - pts[a + 1]) * k,
                pts[a + 2] + (pts[i + 2] - pts[a + 2]) * k,
            ];
        }
    }
    return [pts[pts.length - 2], pts[pts.length - 1]];
};
const HAND_RGB = [
    [90, 165, 255],
    [255, 160, 60],
]; // left hand blue, right hand orange
function drawHands(g) {
    if (!simReplay || !cfg.simHands) return;
    for (const [mode, t0, t1, r, lane, hand, pts] of simReplay.strokes) {
        if (at < t0 || at > t1) continue;
        const [cr, cg, cb] = HAND_RGB[hand ? 1 : 0];
        let x;
        let y;
        let rad;
        if (mode === 0) {
            [x, y] = mirror(ptRaw(ang(lane), R * 1.06));
            g.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',.9)';
            g.beginPath();
            g.arc(x, y, 9, 0, 7);
            g.fill();
            rad = 9;
        } else {
            const [px, py] = simPos(pts, at);
            [x, y] = mirror([C + px * R, C + py * R]);
            rad = Math.max(3, r * R);
            g.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',.3)';
            g.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',.95)';
            g.lineWidth = 1.8;
            g.beginPath();
            g.arc(x, y, rad, 0, 7);
            g.fill();
            g.stroke();
        }
        g.fillStyle = 'rgba(255,255,255,.95)';
        g.font = 'bold 10px sans-serif';
        g.textAlign = 'center';
        g.fillText(hand ? 'R' : 'L', x, y + 3.5);
    }
}
// eslint-disable-next-line no-unused-vars
function simSpots() {
    return SIM ? SIM.spots : [];
}
// eslint-disable-next-line no-unused-vars
function simInit() {
    const panel = $('simp');
    if (!panel || !D.sim) return;
    panel.style.display = '';
    $('simstyles').innerHTML = D.simStyles
        .map(
            (s) =>
                '<label class="ck" title="' +
                esc(s.about) +
                '"><input type="checkbox" data-s="' +
                s.id +
                '"' +
                (s.extra ? '' : ' checked') +
                '> ' +
                esc(s.label) +
                '</label>'
        )
        .join('');
    simCustomUI();
    $('simgo').onclick = simRun;
}
const CUSTOM_FIELDS = [
    ['tapFoot', 'Tap contact size', 0.02, 0.4, 0.005, 0.09],
    ['touchFoot', 'Touch contact size', 0.02, 0.4, 0.005, 0.09],
    ['slideFoot', 'Slide contact size', 0.02, 0.4, 0.005, 0.1],
    ['posSigma', 'Aiming error', 0, 0.15, 0.005, 0.035],
    ['timeSigma', 'Timing looseness (s)', 0, 0.07, 0.001, 0.012],
    ['timeBias', 'Early or late lean (s)', 0, 0.06, 0.001, 0],
    ['overshoot', 'Overshoot past a slide end or touch', 0, 0.4, 0.005, 0.03],
    ['wander', 'Slide drifts off its path', 0, 0.4, 0.005, 0.04],
    ['endSigma', 'Slide lands off its end', 0, 0.3, 0.005, 0.04],
    ['handoff', 'Other hand slides after the star tap', 0, 1, 0.05, 0.3],
    ['onCells', 'Overlap to trigger a sensor', 1, 40, 1, 6],
];
function simCustomUI() {
    const box = $('simcustomui');
    box.innerHTML =
        '<div class="ck"><input type="checkbox" id="cuson"> <label for="cuson">Run it too</label></div>' +
        '<div class="sw"><label>Start from</label><select id="cubase">' +
        D.simStyles
            .map(
                (s) =>
                    '<option value="' +
                    s.id +
                    '"' +
                    (s.id === 'fingerPad' ? ' selected' : '') +
                    '>' +
                    esc(s.label) +
                    '</option>'
            )
            .join('') +
        '</select></div>' +
        '<div class="sw"><label>Taps with</label><select id="cumode"><option value="screen">the screen</option><option value="button">the buttons</option></select></div>' +
        '<div class="sw"><label>Hands share the work</label><select id="cuhabit"><option value="mixed">varies from run to run</option><option value="free">nearest finger (hands cross freely)</option><option value="side">each hand its own side</option><option value="role">one hand slides and holds, the other taps</option></select></div>' +
        '<div class="ck"><input type="checkbox" id="cubtn"> <label for="cubtn">Touch notes on A sensors with the buttons</label></div>' +
        '<div class="ck"><input type="checkbox" id="culift" checked> <label for="culift">Lift fingers between notes</label></div>' +
        CUSTOM_FIELDS.map(
            (f) =>
                '<div class="sw"><label>' +
                f[1] +
                '</label><input type="range" id="cu_' +
                f[0] +
                '" min="' +
                f[2] +
                '" max="' +
                f[3] +
                '" step="' +
                f[4] +
                '" value="' +
                f[5] +
                '"><output id="cuo_' +
                f[0] +
                '">' +
                f[5] +
                '</output></div>'
        ).join('');
    CUSTOM_FIELDS.forEach((f) => {
        $('cu_' + f[0]).oninput = (e) => ($('cuo_' + f[0]).textContent = e.target.value);
    });
    const presets = Object.fromEntries(D.simStyles.map((s) => [s.id, s.params || {}]));
    $('cubase').onchange = (e) => {
        const p = presets[e.target.value] || {};
        CUSTOM_FIELDS.forEach((f) => {
            if (p[f[0]] !== undefined) {
                $('cu_' + f[0]).value = p[f[0]];
                $('cuo_' + f[0]).textContent = p[f[0]];
            }
        });
        $('cumode').value = p.tapMode || 'screen';
        $('cubtn').checked = !!p.touchButtons;
        $('culift').checked = p.lift !== false;
        $('cuson').checked = true;
    };
}
function customStyleBody() {
    if (!$('cuson') || !$('cuson').checked) return {};
    const custom = {
        tapMode: $('cumode').value,
        touchButtons: $('cubtn').checked,
        lift: $('culift').checked,
    };
    CUSTOM_FIELDS.forEach((f) => (custom[f[0]] = +$('cu_' + f[0]).value));
    return { custom, base: $('cubase').value };
}
async function simRun() {
    const styles = [...document.querySelectorAll('#simstyles input:checked')].map(
        (x) => x.dataset.s
    );
    if (!styles.length && !($('cuson') && $('cuson').checked)) {
        $('simst').textContent = 'Pick at least one style.';
        return;
    }
    $('simgo').disabled = true;
    $('simst').textContent = 'Playing the chart… this takes several seconds.';
    try {
        const res = await fetch('/chart/sim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
                Object.assign({ styles, runs: +$('simruns').value }, customStyleBody(), D.sim)
            ),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'failed');
        SIM = data;
        $('simst').textContent = '';
        simShow(SIM.styles[0].id);
        renderSim();
        draw();
    } catch (e) {
        $('simst').textContent = 'Could not run it: ' + e.message;
    } finally {
        $('simgo').disabled = false;
    }
}
function simShow(id) {
    simReplay = SIM && id && SIM.replay[id] ? SIM.replay[id] : null;
    cfg.simHands = !!simReplay;
}
function renderSim() {
    const box = $('simres');
    const ag = Object.entries(SIM.agreement || {})
        .map(([r, v]) => r + ' ' + v.confirmed + '/' + v.total + ' (chance ' + v.chance + ')')
        .join(' · ');
    const un = SIM.styles
        .filter((s) => s.unreachable > 0)
        .map((s) => s.label + ': ' + s.unreachable);
    box.innerHTML =
        '<div class="row" style="margin-top:8px"><label class="sub">Show hands: <select id="simshow"><option value="">off</option>' +
        SIM.styles
            .map(
                (s) =>
                    '<option value="' +
                    s.id +
                    '"' +
                    (simReplay === SIM.replay[s.id] ? ' selected' : '') +
                    '>' +
                    esc(s.label) +
                    '</option>'
            )
            .join('') +
        '</select></label></div>' +
        '<div class="sub" style="margin-top:6px">' +
        SIM.spots.length +
        ' simulated splash spots. ' +
        (ag ? 'Rule findings the simulation also sees: ' + esc(ag) + '. ' : '') +
        (un.length
            ? 'Notes two hands could not reach in time (not counted): ' + esc(un.join(', ')) + '.'
            : '') +
        '</div>' +
        '<div id="simlist"></div>';
    $('simshow').onchange = (e) => {
        simShow(e.target.value);
        draw();
    };
    const list = SIM.spots.slice().sort((a, b) => b.p - a.p || a.t - b.t);
    $('simlist').innerHTML = list
        .slice(0, 150)
        .map(
            (s) =>
                '<div class="f" data-t="' +
                s.t +
                '"><div class="sev" style="background:#9a5cf0"></div><div><div class="m">' +
                Math.floor(s.t / 60) +
                ':' +
                (s.t % 60).toFixed(1).padStart(4, '0') +
                ' · bar ' +
                s.bar +
                ' · up to ' +
                Math.round(s.p * 100) +
                '%</div><div class="t">' +
                explain(s.text) +
                '</div></div></div>'
        )
        .join('');
    box.querySelectorAll('.f').forEach((el) => (el.onclick = () => go(+el.dataset.t - 0.4)));
}
