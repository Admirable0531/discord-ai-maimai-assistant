// The 34 touch sensors as shapes on the screen, in units of the ring radius
// (x to the right, y down, the ring centre at 0,0). Positions and sizes are the
// ones measured for the viewer. A raster of the screen says which sensor each
// small cell belongs to, so a fingertip or a palm can be turned into "which
// sensors does this cover, and how much".
const D2R = Math.PI / 180;

const NAMES = ['C'];
for (let n = 1; n <= 8; n++) NAMES.push(`A${n}`, `B${n}`, `D${n}`, `E${n}`);
const INDEX = Object.fromEntries(NAMES.map((n, i) => [n, i]));
const COUNT = NAMES.length;

const RADIUS = { A: 0.83, B: 0.466, D: 0.85, E: 0.646 };
/** Angle (degrees clockwise from the top) a sensor sits at. A, B follow the buttons; D, E sit between. */
const angleOf = (name) => {
    const n = Number(name.slice(1));
    return name[0] === 'A' || name[0] === 'B' ? 22.5 + 45 * (n - 1) : 45 * (n - 1);
};
/** Button n sits at the same angle as A_n, just outside the ring. */
const BUTTON_RADIUS = 1.1;
const point = (deg, r) => [r * Math.sin(deg * D2R), -r * Math.cos(deg * D2R)];
const buttonPosition = (lane) => point(22.5 + 45 * (lane - 1), BUTTON_RADIUS);

/** Centre of a sensor. */
function centre(name) {
    if (name === 'C') return [0, 0];
    return point(angleOf(name), RADIUS[name[0]]);
}

function regular(cx, cy, r, sides, rot) {
    const pts = [];
    for (let i = 0; i < sides; i++) {
        const a = rot + (i * 2 * Math.PI) / sides;
        pts.push([cx + r * Math.sin(a), cy - r * Math.cos(a)]);
    }
    return pts;
}
function inPolygon(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}
/** Does the point lie in the sector between two angles (clockwise from the top) and two radii? */
function inSector(px, py, a0, a1, r0, r1) {
    const r = Math.hypot(px, py);
    if (r < r0 || r > r1) return false;
    let a = Math.atan2(px, -py) / D2R; // clockwise from the top, -180..180
    a = (((a - a0) % 360) + 360) % 360;
    return a <= a1 - a0;
}

function shapeTest(name) {
    const n = Number(name.slice(1));
    const [cx, cy] = centre(name);
    switch (name[0]) {
        case 'C': {
            const poly = regular(0, 0, 0.17, 8, Math.PI / 8);
            return (x, y) => inPolygon(x, y, poly);
        }
        case 'B': {
            const poly = regular(cx, cy, 0.165, 8, Math.PI / 8);
            return (x, y) => inPolygon(x, y, poly);
        }
        case 'E': {
            const poly =
                n % 2 === 1 ? regular(cx, cy, 0.146, 4, 0) : regular(cx, cy, 0.148, 4, Math.PI / 4);
            return (x, y) => inPolygon(x, y, poly);
        }
        case 'A': {
            const a = angleOf(name);
            return (x, y) => inSector(x, y, a - 15, a + 15, 0.62, 0.995);
        }
        default: {
            const a = angleOf(name);
            return (x, y) => inSector(x, y, a - 7.5, a + 7.5, 0.76, 0.995);
        }
    }
}

const GRID = 80; // cells across the 2 x 2 square: 0.025 R per cell
const CELL = 2 / GRID;
const owner = new Int8Array(GRID * GRID).fill(-1);
const cellCount = new Int32Array(COUNT);
(function build() {
    // smaller sensors win where the drawn shapes overlap
    const order = ['C', 'B', 'E', 'D', 'A'];
    const tests = [];
    for (const letter of order) {
        for (const name of NAMES)
            if (name[0] === letter) tests.push([INDEX[name], shapeTest(name)]);
    }
    for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
            const x = -1 + (gx + 0.5) * CELL;
            const y = -1 + (gy + 0.5) * CELL;
            for (const [idx, test] of tests) {
                if (test(x, y)) {
                    owner[gy * GRID + gx] = idx;
                    cellCount[idx]++;
                    break;
                }
            }
        }
    }
})();

/**
 * Which sensors does a round contact cover? Fills `out` (Int32Array(34)) with the
 * number of cells of each sensor inside the circle and returns the number of
 * cells in the whole circle (also those outside every sensor).
 */
function cover(cx, cy, r, out) {
    const x0 = Math.max(0, Math.floor((cx - r + 1) / CELL));
    const x1 = Math.min(GRID - 1, Math.ceil((cx + r + 1) / CELL));
    const y0 = Math.max(0, Math.floor((cy - r + 1) / CELL));
    const y1 = Math.min(GRID - 1, Math.ceil((cy + r + 1) / CELL));
    const r2 = r * r;
    let total = 0;
    for (let gy = y0; gy <= y1; gy++) {
        const y = -1 + (gy + 0.5) * CELL - cy;
        for (let gx = x0; gx <= x1; gx++) {
            const x = -1 + (gx + 0.5) * CELL - cx;
            if (x * x + y * y > r2) continue;
            total++;
            const o = owner[gy * GRID + gx];
            if (o >= 0) out[o]++;
        }
    }
    return total;
}

/** The sensor under a point, or -1. */
function sensorAt(x, y) {
    const gx = Math.floor((x + 1) / CELL);
    const gy = Math.floor((y + 1) / CELL);
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return -1;
    return owner[gy * GRID + gx];
}

module.exports = {
    NAMES,
    INDEX,
    COUNT,
    centre,
    buttonPosition,
    cover,
    sensorAt,
    cellCount,
    CELL,
};
