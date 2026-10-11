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
/**
 * simai.js misreads a slide length written with its own BPM, `[BPM#x:y]`, giving
 * slides tens of seconds long. Rewrite each to the same length as `[1000:n]` in the
 * BPM in force at that point, which it reads correctly.
 */
function normaliseSlideLengths(text) {
    const bpmAt = [];
    for (const m of text.matchAll(/\((\d+(?:\.\d+)?)\)/g)) bpmAt.push([m.index, Number(m[1])]);
    return text.replace(/\[(\d+(?:\.\d+)?)#(\d+):(\d+)\]/g, (all, own, x, y, at) => {
        let bpm = 120;
        for (const [i, v] of bpmAt) if (i < at) bpm = v;
        const n = Math.max(1, Math.round(1000 * (Number(y) / Number(x)) * (bpm / Number(own))));
        return `[1000:${n}]`;
    });
}

function buildChart(text) {
    const parsed = SimaiConvert.deserialize(normaliseSlideLengths(text));
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
                events.push({ ...base, kind: 'break', star: note.slidePaths.length > 0 });
            } else {
                events.push({ ...base, kind: 'tap', star: note.slidePaths.length > 0 });
            }
        }
    }
    events.sort((a, b) => a.time - b.time);
    // a slide that still comes out far too long is a parse problem, not a slide: leave it out
    let dropped = 0;
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].kind === 'slide' && events[i].end - events[i].start > 12) {
            events.splice(i, 1);
            dropped++;
        }
    }
    const tempoChanges = parsed.timingChanges;
    for (const e of events) e.bar = barAt(tempoChanges, e.time);
    return { events, finish: parsed.finishTiming, tempoChanges, droppedSlides: dropped };
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
