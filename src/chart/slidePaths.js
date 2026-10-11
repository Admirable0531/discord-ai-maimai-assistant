// Which sensors a slide passes, in order, from TRG's slide sensor guide
// (transcribed from the user's image; verify rows before relying on them).
// Tables are written for a slide starting at button 1 going clockwise; they
// are rotated to the real start and mirrored for counter-clockwise shapes.
// A step is a list of alternative sensors: any one of them advances the slide.
const { wrap } = require('./geometry');

const parseSteps = (text) =>
    text.split(',').flatMap((raw) => {
        const part = raw.trim();
        const range = /^([AB])(\d) to \1(\d)$/.exec(part);
        if (range) {
            const out = [];
            for (let n = Number(range[2]); n !== wrap(Number(range[3]) + 1); n = wrap(n + 1))
                out.push([`${range[1]}${n}`]);
            return out;
        }
        return [part.replace(/C1\/C2/g, 'C').split('/')];
    });

const TABLES = {
    // keyed by length = end position when starting at 1 (so end = start + length - 1)
    straight: {
        3: 'A1, A2/B2, A3',
        4: 'A1, B2, B3, A4',
        5: 'A1, B1, C1/C2, B5, A5',
    },
    fold: {
        2: 'A1, B1, C1/C2, B2, A2',
        3: 'A1, B1, C1/C2, B3, A3',
        4: 'A1, B1, C1/C2, B4, A4',
    },
    inner: {
        1: 'A1, B2 to B8, A1',
        2: 'A1, B2 to B8, B1, A2',
        3: 'A1, B2 to B8, B1, B2, A3',
        4: 'A1, B2 to B8, B1, B2, B3, A4',
        5: 'A1, B2, B3, B4, A5',
        6: 'A1, B2, B3, B4, B5, A6',
        7: 'A1, B2 to B6, A7',
        8: 'A1, B2 to B7, A8',
    },
    outer: {
        1: 'A1, B1, C1/C2, B6, A7, A8, A1',
        2: 'A1, B1, C1/C2, B6, A7, A8, B1, A1/B1, A2',
        3: 'A1, B1, C1/C2, B6, A7, A8, B1, B2, A3',
        4: 'A1, B1, C1/C2, B6, A7, A8, B1, B2/C1/C2, B3/B4, A4',
        5: 'A1, B1, C1/C2, B6, A7, A8, B1, C1/C2, B5, A5',
        6: 'A1, B1, C1/C2, B6, A7, A8, B1, C1/C2, B6, A6',
        7: 'A1, B1, C1/C2, B6, A7',
        8: 'A1, B1, C1/C2, B6, A7, A8',
    },
    zigzag: { 5: 'A1, B8, B7, C1/C2, B3, B4, A5' },
};
const FAN = ['A1, B8, B7, A6/D6', 'A1, B1, C1/C2, B5/A5', 'A1, B2, B3, A4/D5'];

/** Rotate (and optionally mirror) a table row written for a start at button 1. */
function place(rowText, start, dir) {
    return parseSteps(rowText).map((alternatives) =>
        alternatives.map((s) =>
            s === 'C' ? 'C' : `${s[0]}${wrap(start + dir * (Number(s.slice(1)) - 1))}`
        )
    );
}

/** Shortest-way direction and table length from `start` to `end`. */
function shortest(start, end) {
    const f = wrap(end - start + 1) - 1; // 0..7 clockwise
    return f <= 4 ? { dir: 1, length: f + 1 } : { dir: -1, length: wrap(start - end + 1) };
}

const clockwise = (start, end) => ({ dir: 1, length: wrap(end - start + 1) });
const counter = (start, end) => ({ dir: -1, length: wrap(start - end + 1) });

function straightLeg(start, end) {
    const { dir, length } = shortest(start, end);
    const row = TABLES.straight[length];
    return row ? place(row, start, dir) : null;
}

/** Steps for one segment, or null when the shape/length is not in the table. */
function segmentSteps(shape, start, via) {
    const end = via[via.length - 1];
    switch (shape) {
        case 'StraightLine':
            return straightLeg(start, end);
        case 'Fold': {
            const { dir, length } = shortest(start, end);
            return TABLES.fold[length] ? place(TABLES.fold[length], start, dir) : null;
        }
        case 'RingCw':
        case 'RingCcw': {
            const dir = shape === 'RingCw' ? 1 : -1;
            const count = (((dir * (end - start)) % 8) + 8) % 8 || 8;
            return Array.from({ length: count + 1 }, (_, k) => [`A${wrap(start + dir * k)}`]);
        }
        case 'CurveCw':
        case 'CurveCcw': {
            const { dir, length } =
                shape === 'CurveCw' ? clockwise(start, end) : counter(start, end);
            return TABLES.inner[length] ? place(TABLES.inner[length], start, dir) : null;
        }
        case 'EdgeCurveCw':
        case 'EdgeCurveCcw': {
            const { dir, length } =
                shape === 'EdgeCurveCw' ? clockwise(start, end) : counter(start, end);
            return TABLES.outer[length] ? place(TABLES.outer[length], start, dir) : null;
        }
        case 'ZigZagS':
        case 'ZigZagZ':
            return place(TABLES.zigzag[5], start, shape === 'ZigZagS' ? 1 : -1);
        case 'EdgeFold': {
            if (via.length < 2) return null;
            const first = straightLeg(start, via[0]);
            const second = straightLeg(via[0], via[1]);
            return first && second ? [...first, ...second.slice(1)] : null;
        }
        default:
            return null;
    }
}

/**
 * Tracks of a slide event: an array of tracks, each an array of steps.
 * Returns null if any part of the slide is not covered by the table.
 */
function slideTracks(slide) {
    if (slide.segments.length === 1 && slide.segments[0].shape === 'Fan') {
        return FAN.map((row) => place(row, slide.head, 1));
    }
    let steps = [];
    let start = slide.head;
    for (const seg of slide.segments) {
        const part = segmentSteps(seg.shape, start, seg.via);
        if (!part) return null;
        steps = steps.length ? [...steps, ...part.slice(1)] : part;
        start = seg.via[seg.via.length - 1];
    }
    return [steps];
}

module.exports = { slideTracks, segmentSteps };
