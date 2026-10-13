// How early before its end a slide is judged. In the game's judging (MajdataPlay, SlideTables), a slide is judged at
// `start + length * (1 - c)` where c depends on the slide's shape and span, and its Perfect window grows by
// `length * c / 4` (at most 22 frames). The numbers are facts read from that code, not copied code.
const LINE = { 3: 0.182, 4: 0.19, 5: 0.152, 6: 0.19, 7: 0.182 };
const CIRCLE = [0.058, 0.465, 0.233, 0.155, 0.116, 0.093, 0.078, 0.066]; // spans 1..8 lanes
const V = [0.185, 0.15, 0.158, 0.158, 0.158, 0.158, 0.158, 0.154];
const PPQQ = [0.065, 0.086, 0.157, 0.065, 0.065, 0.067, 0.079, 0.0626];
const PQ = [0.095, 0.112, 0.125, 0.139, 0.16, 0.08, 0.084, 0.0895];
const L = 0.1;
const ZIGZAG = 0.13;
const WIFI = 0.16287;

const cw = (a, b) => ((b - a + 8) % 8) + 1;
const ccw = (a, b) => ((a - b + 8) % 8) + 1;

/** Share c of the slide's length that remains after its last sensor is reached. */
function slideConst(event) {
    const segs = event.segments || [];
    if (!segs.length) return 0.15;
    const last = segs[segs.length - 1];
    const start =
        segs.length > 1
            ? segs[segs.length - 2].via[segs[segs.length - 2].via.length - 1]
            : event.head;
    const end = last.via[last.via.length - 1];
    switch (last.shape) {
        case 'StraightLine':
            return LINE[cw(start, end)] ?? 0.18;
        case 'RingCw':
            return CIRCLE[cw(start, end) - 1];
        case 'RingCcw':
            return CIRCLE[ccw(start, end) - 1];
        case 'CurveCw':
            return PQ[cw(start, end) - 1];
        case 'CurveCcw':
            return PQ[ccw(start, end) - 1];
        case 'EdgeCurveCw':
            return PPQQ[cw(start, end) - 1];
        case 'EdgeCurveCcw':
            return PPQQ[ccw(start, end) - 1];
        case 'Fold':
            return V[cw(start, end) - 1];
        case 'EdgeFold':
            return L;
        case 'ZigZagS':
        case 'ZigZagZ':
            return ZIGZAG;
        case 'Fan':
            return WIFI;
        default:
            return 0.15;
    }
}

module.exports = { slideConst };
