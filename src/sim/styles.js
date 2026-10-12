// Play styles: how the virtual player uses buttons and the screen. Every number is
// an estimate (marked "guess" in docs/play-simulation-plan.md) until it has been
// calibrated against spots a player has marked.
//
//   tapMode      'button' | 'screen'  how taps, breaks and hold heads are played
//   touchButtons true: touch notes on A sensors are taken with the button of that lane
//   lift         true: a screen hand leaves the screen between notes; false: it stays
//                down and drags across whatever lies between
//   tapFoot / touchFoot / slideFoot   contact radius (in ring radii): fingertip ~0.05,
//                finger pad ~0.09, the side of a hand ~0.22, a whole palm ~0.32
//   speed        how fast a hand can travel (ring radii per second)
//   posSigma / timeSigma   aiming and timing error (ring radii / seconds)
const BASE = {
    tapMode: 'screen',
    touchButtons: false,
    lift: true,
    tapFoot: 0.055,
    touchFoot: 0.055,
    slideFoot: 0.055,
    speed: 14, // hand moving across the screen (ring radii per second)
    fingers: 3, // fingers a hand can use at once
    reach: 1.2, // a finger reaches this far from where its hand rests without moving the hand
    posSigma: 0.03,
    timeSigma: 0.012,
    onCells: 6, // a contact turns a sensor ON when it covers this many cells of it (a cell is 0.025 ring radii square)
    wander: 0, // ring radii a slide's finger drifts sideways off the drawn path
    endSigma: 0, // ring radii a slide's last point lands off the end sensor
    overshoot: 0, // ring radii a finger runs past a slide's end or a touch it arrives at
    habit: 'mixed', // how the hands share the work: mixed (varies by run), free, side, role
    crossCost: 0.9, // how much a hand dislikes taking a note on the other side or of the other role
    pressLen: 0.05,
    dragSpeed: 3, // ring radii per second for a finger swiping over the glass
    liftBefore: 0.12, // s: a dragging finger leaves the glass this long before its next press
};

const STYLES = {
    buttons: {
        ...BASE,
        id: 'buttons',
        label: 'Full buttons',
        about: 'Taps and holds on the physical buttons, touch notes and slides on the screen with fingertips.',
        tapMode: 'button',
        touchButtons: true,
        fingers: 4,
        reach: 1.6,
    },
    fingertips: {
        ...BASE,
        id: 'fingertips',
        label: 'Full screen, fingertips lifted',
        about: 'Everything on the screen with fingertips, lifted between notes. The clean reference.',
    },
    fingerPad: {
        ...BASE,
        id: 'fingerPad',
        label: 'Full screen, finger pads',
        about: 'Everything on the screen with the pad of the finger (about 2 cm wide), lifted between notes. A typical grip.',
        tapFoot: 0.09,
        touchFoot: 0.09,
        slideFoot: 0.1,
        posSigma: 0.035,
    },
    dragging: {
        ...BASE,
        id: 'dragging',
        label: 'Full screen, fingers dragging',
        about: 'Everything on the screen, fingers stay on the glass between notes and sweep across what lies between.',
        lift: false,
        tapFoot: 0.07,
        touchFoot: 0.07,
        slideFoot: 0.07,
        posSigma: 0.03,
    },
    palm: {
        ...BASE,
        id: 'palm',
        label: 'Buttons + palm slides',
        about: 'Taps on buttons; slides and touch notes with the side of the hand, a big contact.',
        tapMode: 'button',
        touchButtons: true,
        fingers: 4,
        reach: 1.6,
        touchFoot: 0.14,
        slideFoot: 0.24,
        posSigma: 0.04,
    },
    bigTouch: {
        ...BASE,
        id: 'bigTouch',
        label: 'Screen, big-hand touch',
        about: 'Taps with fingertips; touch notes and slides with a wide finger pad or palm.',
        touchFoot: 0.2,
        slideFoot: 0.13,
        posSigma: 0.035,
    },
    offRhythm: {
        ...BASE,
        id: 'offRhythm',
        label: 'Off the rhythm (persona)',
        about: 'Finger pads, but presses are 45 ms loose and lean 30 ms early or late.',
        extra: true,
        tapFoot: 0.09,
        touchFoot: 0.09,
        slideFoot: 0.1,
        posSigma: 0.035,
        timeSigma: 0.045,
        timeBias: 0.03,
    },
    mixed: {
        ...BASE,
        id: 'mixed',
        label: 'Mixed: buttons, screen swipes',
        about: 'Buttons for taps, finger pads on the screen for touch and slides, hands stay near the ring.',
        tapMode: 'button',
        touchButtons: true,
        fingers: 4,
        reach: 1.6,
        lift: false,
        touchFoot: 0.09,
        slideFoot: 0.09,
        posSigma: 0.03,
    },
};

/**
 * Players by skill, from a first-weeks beginner to a top player. Every number is a
 * guess made to put them in order; they differ in timing, aiming, reach and
 * speed, and in habits (staying on the glass or lifting).
 */
const WANDER = {
    beginner: 0.12,
    casual: 0.09,
    intermediate: 0.06,
    advanced: 0.04,
    expert: 0.025,
    top: 0.015,
};
const OVERSHOOT = {
    beginner: 0.15,
    casual: 0.1,
    intermediate: 0.06,
    advanced: 0.03,
    expert: 0.015,
    top: 0.01,
};
const SKILL = [
    ['beginner', 'Beginner', 0.06, 0.04, 0.07, 2, 0.8, 6, 0.13, false],
    ['casual', 'Casual player', 0.045, 0.03, 0.055, 2, 1.0, 8, 0.12, false],
    ['intermediate', 'Intermediate player', 0.03, 0.02, 0.045, 3, 1.3, 10, 0.1, true],
    ['advanced', 'Advanced player', 0.02, 0.012, 0.035, 3, 1.5, 12, 0.09, true],
    ['expert', 'Expert player', 0.013, 0.006, 0.03, 4, 1.6, 14, 0.09, true],
    ['top', 'Top player', 0.009, 0.003, 0.025, 4, 1.8, 16, 0.08, true],
];
for (const [id, label, timeSigma, timeBias, posSigma, fingers, reach, speed, foot, lift] of SKILL) {
    STYLES[id] = {
        ...BASE,
        id,
        label,
        about: `Buttons for taps, the screen for touches and slides. Timing about ${Math.round(timeSigma * 1000)} ms loose, ${lift ? 'lifts fingers between notes' : 'keeps fingers on the glass'}.`,
        extra: true,
        skill: true,
        tapMode: 'button',
        touchButtons: true,
        lift,
        tapFoot: foot,
        touchFoot: foot,
        slideFoot: foot + 0.01,
        timeSigma,
        timeBias,
        posSigma,
        fingers,
        reach,
        speed,
        overshoot: OVERSHOOT[id],
        wander: WANDER[id],
        endSigma: WANDER[id],
    };
}

/** The numbers a custom style may set, with their limits. */
const LIMITS = {
    tapFoot: [0.02, 0.4],
    touchFoot: [0.02, 0.4],
    slideFoot: [0.02, 0.4],
    posSigma: [0, 0.15],
    timeSigma: [0, 0.07],
    timeBias: [0, 0.06],
    overshoot: [0, 0.4],
    wander: [0, 0.4],
    endSigma: [0, 0.3],
    speed: [4, 30],
    fingers: [1, 5],
    reach: [0.3, 2.5],
    onCells: [1, 40],
};
const FLAGS = ['touchButtons', 'lift'];

/** A user-supplied style object reduced to known fields within their limits (never trusted as is). */
function cleanCustom(input) {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
        const v = Number(input[key]);
        if (Number.isFinite(v)) out[key] = Math.min(hi, Math.max(lo, v));
    }
    if (out.fingers !== undefined) out.fingers = Math.round(out.fingers);
    for (const key of FLAGS) if (typeof input[key] === 'boolean') out[key] = input[key];
    if (input.tapMode === 'button' || input.tapMode === 'screen') out.tapMode = input.tapMode;
    if (['mixed', 'free', 'side', 'role'].includes(input.habit)) out.habit = input.habit;
    return out;
}

/** A style with some options overridden (used for the custom style from the page). */
function customStyle(base, overrides) {
    return {
        ...(STYLES[base] || STYLES.fingerPad),
        ...cleanCustom(overrides),
        id: 'custom',
        label: 'Custom',
        about: 'The style you set yourself.',
    };
}

/** The ids of the everyday styles (the personas are only run when asked for). */
const DEFAULT_STYLE_IDS = Object.values(STYLES)
    .filter((x) => !x.extra)
    .map((x) => x.id);

module.exports = { STYLES, BASE, LIMITS, DEFAULT_STYLE_IDS, cleanCustom, customStyle };
