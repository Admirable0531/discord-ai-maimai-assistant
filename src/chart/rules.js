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
};

const isButtonHit = (e) => e.kind === 'tap' || e.kind === 'break' || e.kind === 'hold';
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
            ...buttons.map((b) => ({ b, lane: b.lane, time: b.time, what: label(b) })),
            ...slideHeads.map((s) => ({
                b: s,
                lane: s.head,
                time: s.time,
                what: `slide start on ${s.head}`,
            })),
        ];
        for (const { lane, time, what } of targets) {
            const hit = near.find((n) => n.button === lane);
            if (!hit) continue;
            const gap = time - t.time; // > 0: the touch comes first
            if (gap < -cfg.sameTick || gap > cfg.splashWindow) continue;
            const simultaneous = Math.abs(gap) <= cfg.sameTick;
            const severity = simultaneous ? 3 : hit.closeness === 0 ? 3 : 2;
            out.push({
                rule: 'A1',
                severity,
                time: Math.min(t.time, time),
                bar: t.bar,
                notes: [sensorName(t), what],
                text: simultaneous
                    ? `${sensorName(t)} lands together with ${what}; the hand reaching the touch can switch on the neighbouring A sensor.`
                    : `${sensorName(t)} lands ${Math.round(gap * 1000)} ms before ${what}; brushing the A sensor on the way hits it early or blocks it.`,
            });
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
            out.push({
                rule: 'A2',
                severity: during ? 2 : 1,
                time: t.time,
                bar: t.bar,
                notes: [sensorName(t), `hold ${h.lane}`],
                text: during
                    ? `${sensorName(t)} is touched while button ${h.lane} is held; the touch hand sits next to the held button's sensor.`
                    : `${sensorName(t)} lands just after hold ${h.lane} ends.`,
            });
        }
    }
    return out;
}

/** A3: two touches on neighbouring areas close in time. */
function touchBesideTouch(events, cfg) {
    const out = [];
    const touches = events.filter((e) => e.kind === 'touch' && e.sensor !== 'C');
    for (let i = 0; i < touches.length; i++) {
        for (let j = i + 1; j < touches.length; j++) {
            const a = touches[i];
            const b = touches[j];
            const gap = b.time - a.time;
            if (gap > cfg.splashWindow) break;
            if (gap <= cfg.sameTick) continue; // a deliberate group
            const shares = neighbouringButtons(a.sensor, a.number).some((n) =>
                neighbouringButtons(b.sensor, b.number).some((m) => m.button === n.button)
            );
            if (!shares || sensorName(a) === sensorName(b)) continue;
            out.push({
                rule: 'A3',
                severity: 1,
                time: a.time,
                bar: a.bar,
                notes: [sensorName(a), sensorName(b)],
                text: `${sensorName(a)} then ${sensorName(b)} ${Math.round(gap * 1000)} ms later, sharing a neighbouring sensor.`,
            });
        }
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
                    text: `${length} taps in a row on neighbouring buttons at about ${((length - 1) / (taps[end].time - taps[runStart].time)).toFixed(0)} per second; the finger can brush the next button.`,
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
                    text: `Button ${e.lane} repeated at about ${(1 / gap).toFixed(0)} per second.`,
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
                text: `${nps.toFixed(1)} notes per second over ${cfg.burstWindow} s.`,
            });
            reportedUntil = hits[i];
        }
    }
    return out;
}

/** B2: tempo changes. */
function tempoChanges(chart) {
    return chart.tempoChanges
        .filter((t, i, all) => i > 0 && t.tempo !== all[i - 1].tempo)
        .map((t, i, list) => ({
            rule: 'B2',
            severity: 2,
            time: t.time,
            bar: chart.events.find((e) => e.time >= t.time)?.bar ?? null,
            notes: [],
            text: `BPM changes to ${Math.round(t.tempo)}.`,
        }));
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
function rhythmChanges(chart, cfg) {
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
                    ? 'Straight rhythm turns into triplets.'
                    : 'Triplets turn back into straight rhythm.',
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
                        ? `Notes get ${ratio.toFixed(1)}x faster (about ${(1 / meanAfter).toFixed(0)} per second).`
                        : `Notes get ${(1 / ratio).toFixed(1)}x slower after a fast part.`,
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
                if (Math.abs(gap) > cfg.splashWindow) continue;
                if (
                    note.time < slide.start - cfg.splashWindow ||
                    note.time > slide.end + cfg.splashWindow
                )
                    continue;
                const before = gap < 0;
                out.push({
                    rule: before ? 'A5' : 'A4',
                    severity: Math.abs(gap) <= 0.06 ? 3 : 2,
                    time: Math.min(note.time, step.time),
                    bar: note.bar,
                    notes: [slideLabel(slide), label(note)],
                    text: before
                        ? `${label(note)} lands ${Math.round(-gap * 1000)} ms before the ${slideLabel(slide)} reaches ${name}; hitting it can advance the slide early.`
                        : `The ${slideLabel(slide)} passes ${name} ${Math.round(gap * 1000)} ms before ${label(note)}; the sliding finger can catch the note.`,
                });
                break;
            }
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
                    if (Math.abs(sa.time - sb.time) > cfg.splashWindow) continue;
                    // Crossing through the centre (C) is normal, so it is not counted.
                    const common = sa.alternatives.filter(
                        (x) => x !== 'C' && sb.alternatives.includes(x)
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
                severity: worst.gap <= 0.06 ? 3 : 2,
                time: worst.time,
                bar: a.slide.bar,
                notes: [slideLabel(a.slide), slideLabel(b.slide)],
                text: `The ${slideLabel(a.slide)} and the ${slideLabel(b.slide)} both pass ${worst.sensor} within ${Math.round(worst.gap * 1000)} ms; one finger can clear the other.`,
            });
        }
    }
    return out;
}

/** A7/A13: a note on, or right next to, the sensor a slide ends on, just after it ends. */
function slideEndBesideNote(paths, events, cfg) {
    const out = [];
    const notes = events.filter((e) => isButtonHit(e) || e.kind === 'touch');
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
            if (!same && !near) continue;
            out.push({
                rule: same ? 'A13' : 'A7',
                severity: same ? 3 : 2,
                time: slide.end,
                bar: note.bar,
                notes: [slideLabel(slide), label(note)],
                text: same
                    ? `${label(note)} is on ${name}, where the ${slideLabel(slide)} ends ${Math.round(gap * 1000)} ms earlier; if that finger is still down the note cannot activate.`
                    : `${label(note)} lands ${Math.round(gap * 1000)} ms after the ${slideLabel(slide)} ends on the next sensor.`,
            });
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
        ...touchBesideTouch(chart.events, cfg),
        ...adjacentBrush(chart.events, cfg),
        ...jacks(chart.events, cfg),
        ...bursts(chart.events, cfg),
        ...tempoChanges(chart),
        ...rhythmChanges(chart, cfg),
    ];
    findings.unknownSlides = paths.unknown.length;
    return findings.sort((a, b) => a.time - b.time);
}

module.exports = { analyse, DEFAULTS };
