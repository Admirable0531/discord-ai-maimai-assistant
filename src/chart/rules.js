// Phase 1 rules. Each returns findings: {rule, severity (1-3), time, bar,
// text, notes}. Thresholds are placeholders until calibrated against charts
// the user has marked; they live in DEFAULTS so they can be tuned in one place.
const { neighbouringButtons, ringDistance, sensorName } = require('./geometry');
const { slideTracks } = require('./slidePaths');

const DEFAULTS = {
    splashWindow: 0.15, // s: a touch this close to a tap can splash it
    sameTick: 0.03, // s: counts as simultaneous
    brushNps: 9, // notes/s on neighbouring buttons that makes the hand brush the next one
    jackNps: 8,
    burstNps: 11,
    burstWindow: 1.5,
    // Perfect windows (s), from the judging constants of a reimplementation of the game:
    // a tap is only +-50 ms, a touch is Perfect from 150 ms early to 200 ms late,
    // a slide's end is Perfect up to roughly 200 ms either way. Touches and slide
    // ends can therefore be taken earlier or later to keep a splash off a neighbour.
    touchEarly: 0.15,
    touchLate: 0.2,
    slideEndWindow: 0.2,
    // A finger that has just slid over a sensor is still on or near it when a tap arrives there.
    passWindow: 0.25,
    slideEndNext: 0.09, // s: a note this soon after a slide ends beside it (A7)
};

/**
 * A finding that the player can dodge by timing a lenient note differently:
 * one step less severe, and the sentence says how far it can move.
 */
function lenient(finding, what, early, late) {
    return {
        ...finding,
        severity: Math.max(1, finding.severity - 1),
        text: `${finding.text} ${what} is forgiving: it stays Perfect from ${Math.round(early * 1000)} ms early to ${Math.round(late * 1000)} ms late, so you can hit it a little earlier or later to keep your hand off the other note.`,
    };
}

const isButtonHit = (e) => e.kind === 'tap' || e.kind === 'break' || e.kind === 'hold';
/** A note as a player says it: "the tap on button 6", "the E6 touch". */
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const phrase = (e) => {
    if (e.sensor) return `the ${sensorName(e)} touch`;
    if (e.kind === 'break') return `the break on button ${e.lane}`;
    if (e.kind === 'hold') return `the hold on button ${e.lane}`;
    return `the tap on button ${e.lane}`;
};
const label = (e) =>
    e.sensor
        ? sensorName(e)
        : `button ${e.lane}${e.kind === 'hold' ? ' hold' : e.kind === 'break' ? ' break' : ''}`;

/** A1/A2: a touch note on a sensor bordering a button note's A sensor, close in time. */
function touchBesideButton(events, cfg) {
    const out = [];
    const touches = events.filter((e) => e.kind === 'touch' || e.kind === 'touchHold');
    const buttons = events.filter(isButtonHit);
    const slideHeads = events.filter((e) => e.kind === 'slide');
    for (const t of touches) {
        const near = neighbouringButtons(t.sensor, t.number);
        if (!near.length) continue;
        const targets = [
            ...buttons.map((b) => ({
                b,
                lane: b.lane,
                time: b.time,
                what: label(b),
                say: phrase(b),
            })),
            ...slideHeads.map((s) => ({
                b: s,
                lane: s.head,
                time: s.time,
                what: `slide start on ${s.head}`,
                say: `the slide start on ${s.head}`,
            })),
        ];
        for (const { lane, time, what, say } of targets) {
            const hit = near.find((n) => n.button === lane);
            if (!hit) continue;
            const gap = time - t.time; // > 0: the touch comes first
            if (gap < -cfg.sameTick || gap > cfg.splashWindow) continue;
            const simultaneous = Math.abs(gap) <= cfg.sameTick;
            const severity = simultaneous ? 3 : hit.closeness === 0 ? 3 : 2;
            const finding = {
                rule: 'A1',
                severity,
                time: Math.min(t.time, time),
                bar: t.bar,
                notes: [sensorName(t), what],
                text: simultaneous
                    ? `The ${sensorName(t)} touch and ${say} happen together. Reaching for the touch can press the A${lane} sensor next to it (a splash), so that note may be hit early.`
                    : `The ${sensorName(t)} touch comes ${Math.round(gap * 1000)} ms before ${say}. On the way to the touch your hand can brush the A${lane} sensor (a splash), which hits that note early or blocks it.`,
            };
            out.push(lenient(finding, 'The touch', cfg.touchEarly, cfg.touchLate));
        }
    }
    return out;
}

/** A2: a touch beside a button that is being held, so the resting finger can be caught by it. */
function touchBesideHold(events, cfg) {
    const out = [];
    const holds = events.filter((e) => e.kind === 'hold');
    for (const t of events.filter((e) => e.kind === 'touch')) {
        const near = neighbouringButtons(t.sensor, t.number);
        for (const h of holds) {
            if (!(h.time < t.time - cfg.sameTick && t.time < h.end + cfg.splashWindow)) continue;
            if (!near.some((n) => n.button === h.lane)) continue;
            const during = t.time <= h.end;
            const finding = {
                rule: 'A2',
                severity: during ? 2 : 1,
                time: t.time,
                bar: t.bar,
                notes: [sensorName(t), `hold ${h.lane}`],
                text: during
                    ? `The ${sensorName(t)} touch has to be hit while button ${h.lane} is still held. Your touching hand ends up right beside the held button's sensor and can bump it (a splash), so keep it clear.`
                    : `The ${sensorName(t)} touch comes just after the hold on button ${h.lane} lets go, while your hand is still near that spot.`,
            };
            out.push(lenient(finding, 'The touch', cfg.touchEarly, cfg.touchLate));
        }
    }
    return out;
}

/**
 * A14 (information): a group of simultaneous touches. Once more than half of
 * the group is activated, the rest are credited the same judgement, so a
 * group of n only needs floor(n/2)+1 of its sensors touched, and a stray
 * sensor inside the group is harmless.
 */
function touchGroups(events, cfg) {
    const out = [];
    const touches = events.filter((e) => e.kind === 'touch' || e.kind === 'touchHold');
    for (let i = 0; i < touches.length;) {
        let j = i + 1;
        while (j < touches.length && touches[j].time - touches[i].time <= cfg.sameTick) j++;
        const n = j - i;
        if (n >= 3) {
            const need = Math.floor(n / 2) + 1;
            out.push({
                rule: 'A14',
                severity: 1,
                time: touches[i].time,
                bar: touches[i].bar,
                notes: touches.slice(i, j).map(sensorName),
                text: `A group of ${n} touches at the same time (${touches.slice(i, j).map(sensorName).join(', ')}). The game only needs more than half of them pressed, so ${need} of the ${n} is enough to clear the whole group.`,
            });
        }
        i = j;
    }
    return out;
}

/** A9: fast runs on neighbouring buttons, where the finger brushes the next one. */
function adjacentBrush(events, cfg) {
    const out = [];
    const taps = events.filter((e) => e.kind === 'tap' || e.kind === 'break');
    let runStart = null;
    for (let i = 1; i < taps.length; i++) {
        const gap = taps[i].time - taps[i - 1].time;
        const adjacent = gap > cfg.sameTick && ringDistance(taps[i].lane, taps[i - 1].lane) === 1;
        const fast = adjacent && 1 / gap >= cfg.brushNps;
        if (fast && runStart === null) runStart = i - 1;
        if ((!fast || i === taps.length - 1) && runStart !== null) {
            const end = fast ? i : i - 1;
            const length = end - runStart + 1;
            if (length >= 4) {
                out.push({
                    rule: 'A9',
                    severity: length >= 8 ? 3 : 2,
                    time: taps[runStart].time,
                    bar: taps[runStart].bar,
                    notes: taps.slice(runStart, end + 1).map((t) => t.lane),
                    text: `${length} taps in a row on neighbouring buttons, about ${((length - 1) / (taps[end].time - taps[runStart].time)).toFixed(0)} a second (a trill or stream). At that speed a finger tends to slide across and press the next button early.`,
                });
            }
            runStart = null;
        }
    }
    return out;
}

/** B5: the same button repeated quickly. */
function jacks(events, cfg) {
    const out = [];
    const last = new Map();
    const runs = new Map();
    for (const e of events.filter((x) => x.kind === 'tap' || x.kind === 'break')) {
        const prev = last.get(e.lane);
        const gap = prev ? e.time - prev.time : Infinity;
        if (gap > cfg.sameTick && 1 / gap >= cfg.jackNps) {
            const run = runs.get(e.lane) || { start: prev, count: 1 };
            run.count += 1;
            runs.set(e.lane, run);
            if (run.count === 3) {
                out.push({
                    rule: 'B5',
                    severity: 2,
                    time: run.start.time,
                    bar: run.start.bar,
                    notes: [e.lane],
                    text: `Button ${e.lane} comes again and again, about ${(1 / gap).toFixed(0)} times a second (a jack). Alternate fingers or hands instead of hammering it with one.`,
                });
            }
        } else {
            runs.delete(e.lane);
        }
        last.set(e.lane, e);
    }
    return out;
}

/** B4: the densest windows. */
function bursts(events, cfg) {
    const out = [];
    const hits = events.filter((e) => e.kind !== 'slide' || true).map((e) => e.time);
    let reportedUntil = -Infinity;
    for (let i = 0, j = 0; i < hits.length; i++) {
        while (hits[i] - hits[j] > cfg.burstWindow) j++;
        const nps = (i - j + 1) / cfg.burstWindow;
        if (nps >= cfg.burstNps && hits[j] >= reportedUntil) {
            const e = events.find((x) => x.time === hits[j]);
            out.push({
                rule: 'B4',
                severity: nps >= cfg.burstNps * 1.3 ? 3 : 2,
                time: hits[j],
                bar: e.bar,
                notes: [],
                text: `A dense stretch: about ${Math.round(nps)} notes a second for ${cfg.burstWindow} seconds (a burst). Keep your hands loose and steady until it ends.`,
            });
            reportedUntil = hits[i];
        }
    }
    return out;
}

/** B2: tempo changes. */
function tempoChanges(chart) {
    const out = [];
    chart.tempoChanges.forEach((t, i, all) => {
        if (i === 0 || t.tempo === all[i - 1].tempo) return;
        const was = Math.round(all[i - 1].tempo);
        const now = Math.round(t.tempo);
        out.push({
            rule: 'B2',
            severity: 2,
            time: t.time,
            bar: chart.events.find((e) => e.time >= t.time)?.bar ?? null,
            notes: [],
            text: `The BPM changes from ${was} to ${now}, so the notes ${now > was ? 'speed up' : 'slow down'} here. Adjust your timing to the new pulse.`,
        });
    });
    return out;
}

/** Tempo (BPM) in force at `time`. */
function tempoAt(chart, time) {
    let tempo = chart.tempoChanges[0]?.tempo ?? 120;
    for (const c of chart.tempoChanges) if (c.time <= time) tempo = c.tempo;
    return tempo;
}

/**
 * B1: the rhythm itself changes (not just the way the chart is written):
 * straight <-> triplet spacing, or the spacing halving/doubling inside a dense
 * passage. Gaps are measured in beats between successive distinct note times.
 */
function rhythmChanges(chart) {
    const times = [...new Set(chart.events.map((e) => Math.round(e.time * 1000) / 1000))];
    const gaps = [];
    for (let i = 1; i < times.length; i++) {
        const beats = ((times[i] - times[i - 1]) * tempoAt(chart, times[i - 1])) / 60;
        const straight = Math.abs(beats * 16 - Math.round(beats * 16)) < 0.06;
        const triplet = !straight && Math.abs(beats * 12 - Math.round(beats * 12)) < 0.06;
        gaps.push({
            at: times[i - 1],
            beats,
            seconds: times[i] - times[i - 1],
            type: triplet ? 'triplet' : 'straight',
        });
    }
    const out = [];
    let lastReported = -Infinity;
    const barOf = (t) => chart.events.find((e) => e.time >= t)?.bar ?? null;
    for (let i = 2; i < gaps.length - 2; i++) {
        const before = gaps.slice(i - 2, i);
        const after = gaps.slice(i, i + 2);
        if (gaps[i].at - lastReported < 1) continue;
        const tripBefore = before.every((g) => g.type === 'triplet');
        const tripAfter = after.every((g) => g.type === 'triplet');
        const straightBefore = before.every((g) => g.type === 'straight');
        const straightAfter = after.every((g) => g.type === 'straight');
        if ((tripBefore && straightAfter) || (straightBefore && tripAfter)) {
            out.push({
                rule: 'B1',
                severity: 3,
                time: gaps[i].at,
                bar: barOf(gaps[i].at),
                notes: [],
                text: tripAfter
                    ? 'The rhythm switches from even beats to triplets (notes in groups of three). The spacing feels different, so count it carefully.'
                    : 'Back from triplets to even beats. Settle into the normal pulse again.',
            });
            lastReported = gaps[i].at;
            continue;
        }
        const meanBefore = (before[0].seconds + before[1].seconds) / 2;
        const meanAfter = (after[0].seconds + after[1].seconds) / 2;
        const ratio = meanBefore / meanAfter;
        const fastest = Math.min(meanBefore, meanAfter);
        if ((ratio >= 1.9 || ratio <= 1 / 1.9) && 1 / fastest >= 7) {
            out.push({
                rule: 'B1',
                severity: 2,
                time: gaps[i].at,
                bar: barOf(gaps[i].at),
                notes: [],
                text:
                    ratio > 1
                        ? `The notes bunch up: about ${Math.round(1 / meanBefore)} a second before, about ${Math.round(1 / meanAfter)} after. Be ready to move your hands faster.`
                        : `The pace relaxes after a fast part: from about ${Math.round(1 / meanBefore)} notes a second down to about ${Math.round(1 / meanAfter)}. Do not rush the next note.`,
            });
            lastReported = gaps[i].at;
        }
    }
    return out;
}

/** When each step of a track is reached, assuming even travel between start and end. */
function stepTimes(slide, track) {
    const span = slide.end - slide.start;
    return track.map((alternatives, i) => ({
        alternatives,
        time: slide.start + (track.length === 1 ? 0 : (i / (track.length - 1)) * span),
        first: i === 0,
        last: i === track.length - 1,
    }));
}

const slideLabel = (s) => `slide from ${s.head}`;

/** Slides with their sensor paths; slides the table does not cover are returned in `unknown`. */
function pathsOf(events) {
    const known = [];
    const unknown = [];
    for (const slide of events.filter((e) => e.kind === 'slide')) {
        const tracks = slideTracks(slide);
        if (tracks) known.push({ slide, steps: tracks.flatMap((t) => stepTimes(slide, t)) });
        else unknown.push(slide);
    }
    return { known, unknown };
}

/** A4/A5: a note whose sensor lies on a slide's path at about the time the slide passes it. */
function slideBesideNote(paths, events, cfg) {
    const out = [];
    const notes = events.filter(
        (e) => isButtonHit(e) || e.kind === 'touch' || e.kind === 'touchHold'
    );
    for (const { slide, steps } of paths) {
        for (const note of notes) {
            const name = note.sensor ? sensorName(note) : `A${note.lane}`;
            for (const step of steps) {
                if (step.first && !note.sensor && note.lane === slide.head) continue; // the slide's own star
                if (!step.alternatives.includes(name)) continue;
                const gap = note.time - step.time; // > 0: the note comes after the slide passes
                if (gap < -cfg.splashWindow || gap > cfg.passWindow) continue;
                if (
                    note.time < slide.start - cfg.splashWindow ||
                    note.time > slide.end + cfg.splashWindow
                )
                    continue;
                const before = gap < 0;
                // A slide sweeping over a touch just triggers it early or on time, which a touch
                // allows (Perfect from 150 ms early to 200 ms late), so that is not a splash.
                if (note.sensor && !before) continue;
                const finding = {
                    rule: before ? 'A5' : 'A4',
                    severity: Math.abs(gap) <= 0.06 ? 3 : 2,
                    time: Math.min(note.time, step.time),
                    bar: note.bar,
                    notes: [slideLabel(slide), label(note)],
                    text: before
                        ? `${cap(phrase(note))} comes ${Math.round(-gap * 1000) < 5 ? 'at the same moment as' : `${Math.round(-gap * 1000)} ms before`} the ${slideLabel(slide)} reaches ${name}. Hitting it that early can push the slide forward a step too soon.`
                        : `The ${slideLabel(slide)} sweeps over ${name} ${Math.round(gap * 1000)} ms before ${phrase(note)}. The sliding finger can catch that note and hit it early.`,
                };
                out.push(
                    note.sensor
                        ? lenient(finding, 'The touch', cfg.touchEarly, cfg.touchLate)
                        : finding
                );
                break;
            }
        }
    }
    return out;
}

/**
 * A15: a tap arriving beside the sensor a slide has just passed. A sliding finger
 * is wider than one sensor and keeps travelling, so it can clip the tap next to
 * its path and hit it early (or block it). Softer than A4, which is the same
 * sensor.
 */
function tapOnSlideRoute(paths, events, cfg) {
    const out = [];
    const notes = events.filter(isButtonHit);
    for (const { slide, steps } of paths) {
        for (const note of notes) {
            if (
                note.time < slide.start - cfg.splashWindow ||
                note.time > slide.end + cfg.passWindow
            )
                continue;
            for (const step of steps) {
                if (step.first) continue;
                const gap = note.time - step.time; // > 0: the slide passed before the note
                if (gap < 0 || gap > cfg.splashWindow) continue; // only the tap that follows the pass
                const beside = step.alternatives.find(
                    (x) => x[0] === 'A' && ringDistance(Number(x.slice(1)), note.lane) === 1
                );
                if (!beside) continue;
                // the exact sensor is A4/A5's business
                if (step.alternatives.includes(`A${note.lane}`)) continue;
                out.push({
                    rule: 'A15',
                    severity: 1,
                    time: step.time,
                    bar: note.bar,
                    notes: [slideLabel(slide), label(note)],
                    text: `The ${slideLabel(slide)} passes ${beside} ${Math.round(gap * 1000)} ms before ${phrase(note)}, right beside it. A sliding finger is wider than one sensor and can clip that note and hit it early.`,
                });
                break;
            }
        }
    }
    return out;
}

/**
 * A16: a tap on the lane next to a slide's start, just as the slide begins moving.
 * Button players take the star, then touch the screen on that lane to start the
 * slide; the touching finger covers the neighbouring sensor and catches that tap
 * early (an "early Good"). Named from the Japanese guides' 巻き込み advice.
 */
function tapBesideSlideStart(events) {
    const out = [];
    const notes = events.filter(isButtonHit);
    for (const slide of events.filter((e) => e.kind === 'slide')) {
        for (const note of notes) {
            if (ringDistance(note.lane, slide.head) !== 1) continue;
            const gap = note.time - slide.start; // > 0: the tap comes after the slide starts moving
            if (gap < -0.1 || gap > 0.15) continue;
            out.push({
                rule: 'A16',
                severity: Math.abs(gap) <= 0.06 ? 2 : 1,
                time: Math.min(note.time, slide.start),
                bar: note.bar,
                notes: [slideLabel(slide), label(note)],
                text: `${cap(phrase(note))} sits next to the start of the ${slideLabel(slide)}, ${gap >= 0 ? `${Math.round(gap * 1000)} ms after the slide starts moving` : `${Math.round(-gap * 1000)} ms before the slide starts moving`}. The finger that sets the slide off covers the neighbouring sensor and can catch that note early.`,
            });
        }
    }
    return out;
}

/** A6: two slides that use the same sensor at about the same time. */
function slideBesideSlide(paths, cfg) {
    const out = [];
    for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
            const a = paths[i];
            const b = paths[j];
            if (
                a.slide.end < b.slide.start - cfg.splashWindow ||
                b.slide.end < a.slide.start - cfg.splashWindow
            )
                continue;
            // Slides written from one star share their opening on purpose.
            if (
                a.slide.head === b.slide.head &&
                Math.abs(a.slide.time - b.slide.time) <= cfg.sameTick
            )
                continue;
            const shared = [];
            for (const sa of a.steps) {
                for (const sb of b.steps) {
                    if (sa.first || sb.first) continue;
                    if (Math.abs(sa.time - sb.time) > 0.1) continue;
                    // Crossing through the middle rings (B, C) is how slides normally cross, so only shared A sensors count.
                    const common = sa.alternatives.filter(
                        (x) => x[0] === 'A' && sb.alternatives.includes(x)
                    );
                    if (common.length)
                        shared.push({
                            sensor: common[0],
                            time: Math.min(sa.time, sb.time),
                            gap: Math.abs(sa.time - sb.time),
                        });
                }
            }
            if (!shared.length) continue;
            const worst = shared.reduce((m, x) => (x.gap < m.gap ? x : m));
            out.push({
                rule: 'A6',
                severity: worst.gap <= 0.03 ? 3 : worst.gap <= 0.06 ? 2 : 1,
                time: worst.time,
                bar: a.slide.bar,
                notes: [slideLabel(a.slide), slideLabel(b.slide)],
                text: `The ${slideLabel(a.slide)} and the ${slideLabel(b.slide)} both pass ${worst.sensor} within ${Math.round(worst.gap * 1000)} ms of each other. If both fingers are there together, one can knock the other's slide off its path.`,
            });
        }
    }
    return out;
}

/** A7/A13: a note on, or right next to, the sensor a slide ends on, just after it ends. */
function slideEndBesideNote(paths, events, cfg) {
    const out = [];
    // Touches are left out: a slide ending over a touch is harmless (wide touch window).
    const notes = events.filter(isButtonHit);
    for (const { slide, steps } of paths) {
        const lastSteps = steps.filter((s) => s.last);
        for (const note of notes) {
            const gap = note.time - slide.end;
            if (gap < -cfg.sameTick || gap > cfg.splashWindow) continue;
            const name = note.sensor ? sensorName(note) : `A${note.lane}`;
            const same = lastSteps.some((s) => s.alternatives.includes(name));
            const near =
                !same &&
                lastSteps.some((s) => {
                    const end = s.alternatives[0];
                    return (
                        end[0] === 'A' &&
                        !note.sensor &&
                        ringDistance(Number(end.slice(1)), note.lane) === 1
                    );
                });
            if (!same && (!near || gap > cfg.slideEndNext)) continue;
            const finding = {
                rule: same ? 'A13' : 'A7',
                severity: same ? 3 : 2,
                time: slide.end,
                bar: note.bar,
                notes: [slideLabel(slide), label(note)],
                text: same
                    ? `${cap(phrase(note))} sits on ${name}, where the ${slideLabel(slide)} ends ${Math.round(gap * 1000)} ms earlier. If that slide finger is still resting there, the sensor is already pressed and the note will not register.`
                    : `${cap(phrase(note))} comes ${Math.round(gap * 1000)} ms after the ${slideLabel(slide)} ends on the next sensor along. Lifting off the slide can brush it.`,
            };
            out.push(lenient(finding, 'The slide end', cfg.slideEndWindow, cfg.slideEndWindow));
        }
    }
    return out;
}

function analyse(chart, overrides = {}) {
    const cfg = { ...DEFAULTS, ...overrides };
    const paths = pathsOf(chart.events);
    const findings = [
        ...slideBesideNote(paths.known, chart.events, cfg),
        ...slideBesideSlide(paths.known, cfg),
        ...slideEndBesideNote(paths.known, chart.events, cfg),
        ...touchBesideButton(chart.events, cfg),
        ...touchBesideHold(chart.events, cfg),
        ...tapOnSlideRoute(paths.known, chart.events, cfg),
        ...tapBesideSlideStart(chart.events),
        ...touchGroups(chart.events, cfg),
        ...adjacentBrush(chart.events, cfg),
        ...jacks(chart.events, cfg),
        ...bursts(chart.events, cfg),
        ...tempoChanges(chart),
        ...rhythmChanges(chart),
    ];
    findings.unknownSlides = paths.unknown.length;
    return findings.sort((a, b) => a.time - b.time);
}

module.exports = { analyse, DEFAULTS };
