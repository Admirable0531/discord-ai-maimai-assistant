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

/** A style with some options overridden (used for custom styles from the page). */
function customStyle(base, overrides) {
    return { ...(STYLES[base] || STYLES.fingertips), ...overrides, id: 'custom', label: 'Custom' };
}

module.exports = { STYLES, BASE, customStyle };
