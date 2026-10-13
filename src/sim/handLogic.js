// Which hand takes a note, decided by rules a player would give as reasons, in order. Every
// answer comes with the reason, so a spot can say "the right hand took it because the left was
// sliding". Written from what the L. R. breakdown videos show and checked against them
// (scripts/lr/logic.js); no chance is involved.
const { noteXY } = require('./handFeatures');

const CENTRE = 0.15; // notes this close to the middle belong to neither side
const FAR = 0.7; // a hand this far from a note (ring radii) would have to cross the screen to reach it

/**
 * @param e      the chart event
 * @param state  from handFeatures.newState(): each hand's last note, position and busy-until
 * @param group  events at the same moment (including e)
 * @param ahead  notes still to come while this note lasts: {left, right} counts of notes on each side
 * @returns {hand: 0|1, why: string}
 */
function chooseHand(e, state, group = [e], ahead = { left: 0, right: 0 }) {
    const t = e.time;
    const [x, y] = noteXY(e);
    const [L, R] = state.hands;
    const busy = [L.busyUntil > t - 0.02, R.busyUntil > t - 0.02];
    const dist = [Math.hypot(L.pos[0] - x, L.pos[1] - y), Math.hypot(R.pos[0] - x, R.pos[1] - y)];
    const since = [t - L.end, t - R.end];
    const side = x < -CENTRE ? 0 : x > CENTRE ? 1 : null;
    const lastHand = state.history.length ? state.history[state.history.length - 1].hand : null;

    // 1. a hand that is holding or sliding cannot take anything else
    if (busy[0] !== busy[1]) {
        const h = busy[0] ? 1 : 0;
        return { hand: h, why: `the ${busy[0] ? 'left' : 'right'} hand is holding or sliding` };
    }
    // 2. notes at the same moment: the left one to the left hand, the right one to the right
    if (group.length > 1) {
        const xs = group.map((g) => noteXY(g)[0]).sort((a, b) => a - b);
        const rank = xs.indexOf(x) / (group.length - 1);
        if (rank < 0.5) return { hand: 0, why: 'the left note of a pair or group' };
        if (rank > 0.5) return { hand: 1, why: 'the right note of a pair or group' };
        // the one in the middle: the hand that is nearer
        return {
            hand: dist[0] <= dist[1] ? 0 : 1,
            why: 'the middle note of a group goes to the nearer hand',
        };
    }
    // 3. a slide or hold that lasts: the hand whose side has less coming up takes it
    if (e.kind === 'slide' || e.kind === 'hold' || e.kind === 'touchHold') {
        if (ahead.left !== ahead.right) {
            const h = ahead.left < ahead.right ? 0 : 1;
            return {
                hand: h,
                why: `the ${h ? 'right' : 'left'} hand has fewer notes coming while it lasts`,
            };
        }
        if (e.kind !== 'slide')
            return {
                hand: 1,
                why: 'a hold goes to the stronger (right) hand when nothing else decides',
            };
    }
    // 4. an ordinary note: the hand on its side, unless that hand is far from it and the other is much nearer
    if (side !== null) {
        const mine = side;
        const other = 1 - side;
        if (dist[mine] > FAR && dist[other] < dist[mine] - 0.2)
            return { hand: other, why: `the ${mine ? 'right' : 'left'} hand is too far from it` };
        // a fast run on one side: the hands alternate
        if (lastHand === mine && since[mine] < 0.12 && dist[other] < 1.0 && since[other] > 0.1)
            return { hand: other, why: 'a fast run alternates hands' };
        return {
            hand: mine,
            why: `a ${mine ? 'right' : 'left'}-side note goes to that side's hand`,
        };
    }
    // 5. in the middle: the nearer hand; if equal, the one that did not just play
    if (Math.abs(dist[0] - dist[1]) > 0.05)
        return {
            hand: dist[0] < dist[1] ? 0 : 1,
            why: 'a note in the middle goes to the nearer hand',
        };
    return {
        hand: lastHand === 0 ? 1 : 0,
        why: 'a note in the middle alternates from the last hand',
    };
}

module.exports = { chooseHand };
