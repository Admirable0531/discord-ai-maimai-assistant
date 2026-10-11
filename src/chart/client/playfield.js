/* global localStorage, D, $, setup, at, draw, active */
// Browser-side playfield for the chart viewer. Inlined into the page by
// viewerPage.js, so it must stay plain browser JavaScript with no imports.
// Look and layout follow the game's play screen (own drawings, not its art):
// a dark field, the judgement ring with eight dots, faint sensor outlines,
// notes growing as they run out from the centre, hollow-star slide heads and
// dense chevron strips that follow the slide's real shape.

const DEF = { speed: 5, note: 1, slideSize: 1, slideGap: 1, appear: 0.8, labels: 1, guides: 1 };
let cfg = Object.assign({}, DEF);
try {
    Object.assign(cfg, JSON.parse(localStorage.getItem('chartViewerCfg') || '{}'));
} catch {
    /* storage unavailable: defaults are fine */
}
const saveCfg = () => {
    try {
        localStorage.setItem('chartViewerCfg', JSON.stringify(cfg));
    } catch {
        /* ignore */
    }
};
const approach = () => 4 / cfg.speed;
const TRAIL = 0.25;
const SPAWN = 0.12; // where a note starts, as a fraction of the ring radius

const COL = {
    tap: '#ff4fa3',
    each: '#ffd23f',
    brk: '#ff8a2a',
    touch: '#2f8bff',
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
    return pt(a, { A: 0.8, B: 0.5, D: 0.97, E: 0.68 }[L] * R);
}
const laneAt = (lane, p) => pt(ang(lane), R * (SPAWN + (1 - SPAWN) * p));

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
        case 'EdgeCurveCcw': {
            const len = f + 1;
            const at = (k) => wrap8(s + dir * k);
            const out = [dot(s), [C, C], pt(ang(at(5)), R * 0.6), dot(at(6))];
            if (len === 7) return out;
            out.push(...arcPts(ang(at(6)), dir * (Math.PI / 4), R * 0.97, R * 0.97).slice(1));
            if (len === 8) return out;
            if (len === 1)
                return out.concat(
                    arcPts(ang(at(7)), dir * (Math.PI / 4), R * 0.97, R * 0.97).slice(1)
                );
            out.push(dot(e));
            return out;
        }
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
/** The strip's opacity: 0.5 after a 0.2 s fade-in, 1 from 50 ms before the star reaches its button. */
function slideAlpha(e) {
    const start = e.t - cfg.appear;
    if (at < start) return 0;
    if (at >= e.t - 0.05) return 1;
    return 0.5 * Math.min(1, (at - start) / Math.min(0.2, Math.max(0.01, cfg.appear - 0.05)));
}
function glow(g, on) {
    if (on) {
        g.shadowColor = '#fff3b0';
        g.shadowBlur = 16;
    }
}
function tapNote(g, x, y, r, c, ex, brk) {
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
function starPath(g, x, y, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.5 : r;
        g.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    g.closePath();
}
function starNote(g, x, y, r, sc, ex) {
    g.save();
    glow(g, ex);
    starPath(g, x, y, r);
    g.fillStyle = 'rgba(6,14,50,.92)';
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, r * 0.3) + 3;
    g.strokeStyle = WHITE;
    g.stroke();
    g.restore();
    starPath(g, x, y, r);
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, r * 0.3);
    g.strokeStyle = sc;
    g.stroke();
    g.fillStyle = WHITE;
    g.beginPath();
    g.arc(x, y, Math.max(1.5, r * 0.16), 0, 7);
    g.fill();
}
function hexOutline(g, x1, y1, x2, y2, w, k) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L;
    const uy = dy / L;
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
function holdNote(g, tx, ty, hx, hy, r, c, ex) {
    g.save();
    glow(g, ex);
    hexOutline(g, tx, ty, hx, hy, r, r * 0.75);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, r * 0.34) + 3;
    g.strokeStyle = WHITE;
    g.stroke();
    g.restore();
    hexOutline(g, tx, ty, hx, hy, r, r * 0.75);
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, r * 0.34);
    g.strokeStyle = c;
    g.stroke();
}
function touchNote(g, x, y, r, c, gap, ex, held) {
    g.save();
    glow(g, ex);
    for (let i = 0; i < 4; i++) {
        g.save();
        g.translate(x, y);
        g.rotate((i * Math.PI) / 2);
        g.beginPath();
        g.moveTo(0, -(r * 0.25 + gap));
        g.lineTo(-r * 0.8, -(r * 1.15 + gap));
        g.lineTo(r * 0.8, -(r * 1.15 + gap));
        g.closePath();
        g.fillStyle = c;
        g.fill();
        g.lineJoin = 'round';
        g.lineWidth = 2.2;
        g.strokeStyle = WHITE;
        g.stroke();
        g.restore();
    }
    g.restore();
    if (held) {
        g.fillStyle = WHITE;
        g.beginPath();
        g.arc(x, y, r * 0.2, 0, 7);
        g.fill();
    }
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

// ----- sensor outlines -----
function polygon(g, x, y, r, sides, rot) {
    g.beginPath();
    for (let i = 0; i < sides; i++) {
        const a = rot + (i * 2 * Math.PI) / sides;
        g.lineTo(x + r * Math.sin(a), y - r * Math.cos(a));
    }
    g.closePath();
}
const SENSORS = [];
for (let n = 1; n <= 8; n++) {
    SENSORS.push(['A' + n, 5], ['B' + n, 6], ['D' + n, 4], ['E' + n, 4]);
}
SENSORS.push(['C', 0]);
function drawSensors(g, lit) {
    g.lineWidth = 1;
    for (const [name, sides] of SENSORS) {
        const [x, y] = xy(name);
        const r = { A: 0.15, B: 0.14, D: 0.075, E: 0.09, C: 0.1 }[name[0]] * R;
        const on = lit.has(name);
        g.strokeStyle = on ? '#ffd23f' : 'rgba(255,255,255,.16)';
        g.fillStyle = on ? 'rgba(255,210,63,.18)' : 'rgba(255,255,255,0)';
        g.lineWidth = on ? 2 : 1;
        if (sides === 0) {
            g.beginPath();
            g.arc(x, y, r, 0, 7);
        } else {
            const rot =
                name[0] === 'D' || name[0] === 'E'
                    ? (45 * (+name.slice(1) - 1) * Math.PI) / 180
                    : ang(+name.slice(1));
            polygon(g, x, y, r, sides, rot);
        }
        g.fill();
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
    const AP = approach();
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, w, size);
    g.save();
    g.translate(ox, 0);
    const noteR = R * 0.105 * cfg.note;
    const slideSz = R * 0.045 * cfg.slideSize;
    const slideGap = R * 0.09 * cfg.slideGap;

    if (cfg.guides) {
        drawSensors(g, litSensors());
        g.strokeStyle = 'rgba(255,255,255,.16)';
        g.lineWidth = 1;
        g.setLineDash([2, 6]);
        for (let n = 1; n <= 8; n++) {
            const [x, y] = laneAt(n, 1);
            const [sx, sy] = laneAt(n, 0);
            g.beginPath();
            g.moveTo(sx, sy);
            g.lineTo(x, y);
            g.stroke();
        }
        g.setLineDash([]);
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

    const prog = (t) => Math.max(0, Math.min(1, 1 - (t - at) / AP));
    const sc = (p) => 0.3 + 0.7 * p;

    // slide strips, then their stars
    for (const e of D.events) {
        if (e.k !== 's') continue;
        if (e.z < at - TRAIL || e.t - cfg.appear > at) continue;
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
        if (e.z < at - TRAIL || e.t > at + AP) continue;
        const col = slideColor(e);
        const fade = at > e.z ? Math.max(0, 1 - (at - e.z) / TRAIL) : 1;
        g.globalAlpha = fade;
        const tracks = slideTracks(e);
        const r = noteR * (e.w ? 1.25 : 1);
        if (at < e.t) {
            const [x, y] = laneAt(e.h, prog(e.t));
            starNote(g, x, y, r * sc(prog(e.t)), col.star, false);
        } else if (at < e.a || e.z <= e.a) {
            const [x, y] = dot(e.h);
            starNote(g, x, y, r, col.star, false);
        } else {
            const k = Math.min(1, (at - e.a) / (e.z - e.a));
            for (const tr of tracks) {
                const [x, y] = along(tr, k * tr.total);
                starNote(g, x, y, r, col.star, false);
            }
        }
        g.globalAlpha = 1;
    }

    // taps, holds and touches
    for (const e of D.events) {
        if (e.k === 's') continue;
        const end = e.z && e.z > e.t ? e.z : e.t;
        if (e.t > at + AP || end < at - TRAIL) continue;
        g.globalAlpha = at > end ? Math.max(0, 1 - (at - end) / TRAIL) : 1;
        if (e.n) {
            const [x, y] = xy(e.n);
            const p = prog(e.t);
            const r = R * 0.055 * cfg.note;
            const c = e.e ? COL.each : COL.touch;
            if (e.k === 'th' && at >= e.t && at <= e.z) {
                g.lineWidth = 3;
                g.strokeStyle = c;
                g.beginPath();
                g.arc(x, y, r * 2.2, 0, 7);
                g.stroke();
            }
            touchNote(g, x, y, r, c, (1 - p) * R * 0.1, e.x, e.k === 'th');
            if (cfg.labels) {
                g.fillStyle = 'rgba(255,255,255,.5)';
                g.font = '9px sans-serif';
                g.textAlign = 'center';
                g.fillText(e.n, x, y - r * 1.9 - (1 - p) * R * 0.1);
            }
        } else {
            const p = at >= e.t ? 1 : prog(e.t);
            const [x, y] = laneAt(e.l, p);
            const r = noteR * sc(p);
            if (e.k === 'h') {
                const [tx, ty] = laneAt(e.l, prog(e.z));
                holdNote(g, tx, ty, x, y, r * 0.95, noteColor(e), e.x);
            } else if (e.st) {
                starNote(g, x, y, r * 1.05, e.e ? COL.slideEach.star : COL.slide.star, e.x);
            } else {
                tapNote(g, x, y, r, noteColor(e), e.x, e.k === 'b');
            }
        }
        g.globalAlpha = 1;
    }
    g.restore();
}

// ----- display settings -----
const CFG = [
    ['speed', 'Note speed', 1, 10, 0.5],
    ['note', 'Note size', 0.6, 1.6, 0.05],
    ['slideSize', 'Slide size', 0.6, 1.8, 0.05],
    ['slideGap', 'Slide gap', 0.6, 2, 0.05],
    ['appear', 'Slide appears (s before star lands)', 0, 2, 0.1],
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
    '> Sensors</label><button id="cfgreset">Reset</button></div>';
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
