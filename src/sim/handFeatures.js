// What a player sees when deciding which hand takes a note, as numbers. The same function is
// used to learn from the L. R. breakdown videos (scripts/lr/train.js) and, once learned, to decide
// in the planner, so a model trained on one works on the other.
const { centre } = require('./sensors');

const laneXY = (l) => {
    const a = ((22.5 + 45 * (l - 1)) * Math.PI) / 180;
    return [0.83 * Math.sin(a), -0.83 * Math.cos(a)];
};

/** Where a note is on the screen (ring radii, y down). */
function noteXY(e) {
    if (e.kind === 'slide') return laneXY(e.head);
    if (e.sensor) return centre(e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`);
    return laneXY(e.lane);
}

const FEATURES = [
    'isTap',
    'isHold',
    'isTouch',
    'isSlide',
    'x',
    'y',
    'length',
    'leftSince',
    'rightSince',
    'leftDist',
    'rightDist',
    'leftBusy',
    'rightBusy',
    'prevHand',
    'prev2Hand',
    'prevGap',
    'groupSize',
    'groupRank',
    'starHand',
    'recentRight',
];

/** A fresh state: what each hand (0 left, 1 right) last did, and the notes played so far. */
function newState() {
    return {
        hands: [
            { end: -9, pos: [-0.6, 0.7], busyUntil: -9 },
            { end: -9, pos: [0.6, 0.7], busyUntil: -9 },
        ],
        history: [], // {t, hand}
        stars: new Map(), // "lane@ms" -> hand that tapped a star
    };
}

/**
 * Feature vector for note `e` (a chart event) given the state and the notes that share its
 * moment (`group`, including e).
 */
function featurize(e, state, group = [e]) {
    const t = e.time;
    const [x, y] = noteXY(e);
    const len = e.kind === 'slide' ? e.end - e.start : e.end ? e.end - e.time : 0;
    const h = state.hands;
    const hist = state.history;
    const last = hist[hist.length - 1];
    const last2 = hist[hist.length - 2];
    const recent = hist.slice(-8);
    const xs = group.map((g) => noteXY(g)[0]).sort((a, b) => a - b);
    const rank = group.length > 1 ? xs.indexOf(x) / (group.length - 1) : 0.5;
    const star =
        e.kind === 'slide' ? state.stars.get(`${e.head}@${Math.round(e.time * 1000)}`) : undefined;
    const dist = (hd) => Math.hypot(hd.pos[0] - x, hd.pos[1] - y);
    return [
        e.kind === 'tap' || e.kind === 'break' ? 1 : 0,
        e.kind === 'hold' ? 1 : 0,
        e.kind === 'touch' || e.kind === 'touchHold' ? 1 : 0,
        e.kind === 'slide' ? 1 : 0,
        x,
        y,
        Math.min(len, 4),
        Math.min(5, t - h[0].end),
        Math.min(5, t - h[1].end),
        dist(h[0]),
        dist(h[1]),
        h[0].busyUntil > t - 0.02 ? 1 : 0,
        h[1].busyUntil > t - 0.02 ? 1 : 0,
        last ? last.hand : 0.5,
        last2 ? last2.hand : 0.5,
        last ? Math.min(2, t - last.t) : 2,
        group.length,
        rank,
        star === undefined ? 0.5 : star,
        recent.length ? recent.reduce((a, r) => a + r.hand, 0) / recent.length : 0.5,
    ];
}

/** Record that `hand` played `e`. */
function apply(state, e, hand) {
    const t = e.time;
    const end = e.kind === 'slide' ? e.end : e.end || t;
    const [x, y] =
        e.kind === 'slide' && e.segments ? noteXY({ kind: 'slide', head: e.head }) : noteXY(e);
    const h = state.hands[hand];
    h.end = Math.max(t, end);
    h.pos = [x, y];
    h.busyUntil =
        e.kind === 'slide' || e.kind === 'hold' || e.kind === 'touchHold' ? end : h.busyUntil;
    state.history.push({ t, hand });
    if ((e.kind === 'tap' || e.kind === 'break') && e.star)
        state.stars.set(`${e.lane}@${Math.round(t * 1000)}`, hand);
}

module.exports = { FEATURES, featurize, newState, apply, noteXY };
