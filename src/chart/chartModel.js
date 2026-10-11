// Turns simai chart text into a flat, time-ordered list of events the analysis
// rules can work on. Times are seconds from the chart start; lanes are 1-8
// (button/screen position, clockwise from the top-right); touch notes carry a
// sensor group + number instead.
const { SimaiConvert, NoteType, NoteGroup, NoteStyles, SlideType } = require('simai.js');

const SENSOR_GROUP = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E' };
const SLIDE_SHAPE = Object.fromEntries(
    Object.entries(SlideType)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => [v, k])
);

/**
 * Flatten a parsed simai chart.
 * Event kinds: tap, break, hold, touch, touchHold, slide (one per track; `head`
 * is the lane of its star), each with `time`, and for slides `start`/`end`
 * times (when the track becomes active and when it should be cleared).
 */
function buildChart(text) {
    const parsed = SimaiConvert.deserialize(text);
    const events = [];
    for (const group of parsed.noteCollections) {
        const time = group.time;
        for (const note of group) {
            const isSensor = note.location.group !== NoteGroup.Tap;
            const place = isSensor
                ? { sensor: SENSOR_GROUP[note.location.group], number: note.location.index + 1 }
                : { lane: note.location.index + 1 };
            const ex = (note.styles & NoteStyles.Ex) !== 0;
            const base = { time, ...place, ...(ex ? { ex: true } : {}) };
            for (const path of note.slidePaths) {
                events.push({
                    kind: 'slide',
                    time,
                    head: path.startLocation.index + 1,
                    start: time + path.delay,
                    end: time + path.delay + path.duration,
                    segments: path.segments.map((seg) => ({
                        shape: SLIDE_SHAPE[seg.slideType],
                        via: seg.vertices.map((v) => v.index + 1),
                    })),
                    isBreak: path.type === NoteType.Break,
                });
            }
            if (note.type === NoteType.Hold) {
                events.push({
                    ...base,
                    kind: isSensor ? 'touchHold' : 'hold',
                    end: time + note.length,
                });
            } else if (note.type === NoteType.Touch || isSensor) {
                events.push({ ...base, kind: 'touch' });
            } else if (note.type === NoteType.Break) {
                events.push({ ...base, kind: 'break' });
            } else {
                events.push({ ...base, kind: 'tap', star: note.slidePaths.length > 0 });
            }
        }
    }
    events.sort((a, b) => a.time - b.time);
    const tempoChanges = parsed.timingChanges;
    for (const e of events) e.bar = barAt(tempoChanges, e.time);
    return { events, finish: parsed.finishTiming, tempoChanges };
}

/** Bar number (1-based, assuming 4 beats a bar) at `time`, following tempo changes. */
function barAt(tempoChanges, time) {
    let beats = 0;
    for (let i = 0; i < tempoChanges.length; i++) {
        const from = tempoChanges[i].time;
        if (from >= time) break;
        const to = Math.min(time, tempoChanges[i + 1]?.time ?? Infinity);
        beats += ((to - from) * tempoChanges[i].tempo) / 60;
    }
    return Math.floor(beats / 4) + 1;
}

/** Counts per kind, comparable with a chart's published note counts. */
function countEvents(events) {
    const counts = { tap: 0, hold: 0, slide: 0, touch: 0, break: 0 };
    for (const e of events) {
        if (e.kind === 'slide') counts[e.isBreak ? 'break' : 'slide'] += 1;
        else if (e.kind === 'hold' || e.kind === 'touchHold') counts.hold += 1;
        else if (e.kind === 'touch') counts.touch += 1;
        else if (e.kind === 'break') counts.break += 1;
        else counts.tap += 1;
    }
    return counts;
}

module.exports = { buildChart, countEvents };
