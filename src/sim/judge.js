// A copy of the game's judging, written from facts (see docs/judge-facts.md), run
// at 60 frames a second on "which buttons and sensors are ON this frame".
//
// Grades: 0 perfect, 1 great, 2 good, 3 miss.
const { INDEX, COUNT } = require('./sensors');
const { slideTracks } = require('../chart/slidePaths');

const FRAME = 1 / 60;
const TAP_GOOD = 9 * FRAME; // 150 ms: the window of a tap, either side
const TOUCH_EARLY = 9 * FRAME;
const TOUCH_WINDOW_END = 0.316667;
const TOUCH_MISS = 18 * FRAME; // late beyond this is a miss

const tapGrade = (d) =>
    Math.abs(d) <= 3 * FRAME + 1e-9 ? 0 : Math.abs(d) <= 6 * FRAME + 1e-9 ? 1 : 2;
const touchGrade = (d) => {
    if (d <= 12 * FRAME + 1e-9) return 0; // 9 frames early .. 12 late
    return d <= 15 * FRAME + 1e-9 ? 1 : 2;
};
function slideGrade(d, duration) {
    const perfect = 14 * FRAME + Math.min((duration * 1000) / 4, 22 * FRAME * 1000) / 1000;
    const a = Math.abs(d);
    return a <= perfect ? 0 : a <= 29 * FRAME ? 1 : 2;
}

/** Notes for the judge from chart events (ids are positions in the event list). */
function judgeNotes(events) {
    const notes = [];
    events.forEach((e, id) => {
        if (e.kind === 'tap' || e.kind === 'break')
            notes.push({ id, kind: 'tap', t: e.time, lane: e.lane });
        else if (e.kind === 'hold')
            notes.push({ id, kind: 'hold', t: e.time, end: e.end, lane: e.lane });
        else if (e.kind === 'touch' || e.kind === 'touchHold') {
            const name = e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`;
            notes.push({
                id,
                kind: e.kind,
                t: e.time,
                end: e.end,
                sIdx: INDEX[name],
                lane: e.sensor === 'A' ? e.number : null,
            });
        } else if (e.kind === 'slide') {
            const tracks = slideTracks(e);
            if (!tracks) return;
            notes.push({
                id,
                kind: 'slide',
                t: e.time,
                start: e.start,
                end: e.end,
                tracks,
                head: e.head,
            });
        }
    });
    // touches written on one tick are a group: more than half pressed clears all
    for (const kind of ['touch', 'touchHold']) {
        const list = notes.filter((n) => n.kind === kind).sort((a, b) => a.t - b.t);
        for (let i = 0; i < list.length;) {
            let j = i + 1;
            while (j < list.length && list[j].t - list[i].t < 0.001) j++;
            if (j - i >= 2) {
                const g = { size: j - i, registered: 0, grade: null };
                for (let k = i; k < j; k++) list[k].group = g;
            }
            i = j;
        }
    }
    return notes;
}

class Judge {
    constructor(notes, { touchButtons = false } = {}) {
        this.touchButtons = touchButtons;
        this.notes = notes;
        this.results = new Map();
        this.tapQ = Array.from({ length: 8 }, () => ({ list: [], i: 0 }));
        this.touchQ = Array.from({ length: COUNT }, () => ({ list: [], i: 0 }));
        this.slides = [];
        this.holds = [];
        for (const n of notes) {
            if (n.kind === 'tap' || n.kind === 'hold') this.tapQ[n.lane - 1].list.push(n);
            else if (n.kind === 'touch' || n.kind === 'touchHold') this.touchQ[n.sIdx].list.push(n);
            else if (n.kind === 'slide') this.slides.push(this.slideState(n));
        }
        for (const q of [...this.tapQ, ...this.touchQ]) q.list.sort((a, b) => a.t - b.t);
        this.prevB = new Uint8Array(8);
        this.prevS = new Uint8Array(COUNT);
    }

    slideState(n) {
        const queues = n.tracks.map((steps) =>
            steps.map((alts, i) => ({
                alts: alts.map((name) => ({ idx: INDEX[name], on: false, off: false })),
                last: i === steps.length - 1,
            }))
        );
        return { n, queues, done: false };
    }

    record(note, grade, extra) {
        this.results.set(note.id, { grade, ...extra });
    }

    /** One frame. `own` gives, per source, the ids of the notes whose hand covers it. */
    frame(f, btn, sens, own) {
        const t = f * FRAME;
        const usedB = new Uint8Array(8);
        const usedS = new Uint8Array(COUNT);
        const edgeB = (i) => btn[i] && !this.prevB[i];
        const edgeS = (i) => sens[i] && !this.prevS[i];
        const ownersB = (i) => (own && own.btn[i]) || [];
        const ownersS = (i) => (own && own.sens[i]) || [];

        // taps and hold heads, lane by lane, in order
        for (let lane = 0; lane < 8; lane++) {
            const q = this.tapQ[lane];
            const aIdx = INDEX[`A${lane + 1}`];
            while (q.i < q.list.length) {
                const n = q.list[q.i];
                const d = t - n.t;
                if (d > TAP_GOOD + 1e-9) {
                    this.record(n, 3, { diff: TAP_GOOD, by: null, owners: [] });
                    this.afterHead(n);
                    q.i++;
                    continue;
                }
                if (d < -TAP_GOOD - 1e-9) break;
                let by = null;
                if (edgeB(lane) && !usedB[lane]) {
                    usedB[lane] = 1;
                    by = { src: 'btn', owners: ownersB(lane) };
                } else if (edgeS(aIdx) && !usedS[aIdx]) {
                    usedS[aIdx] = 1;
                    by = { src: 'sens', owners: ownersS(aIdx) };
                }
                if (!by) break;
                this.record(n, tapGrade(d), { diff: d, by: by.src, owners: by.owners });
                this.afterHead(n);
                q.i++;
            }
        }

        // touches, sensor by sensor
        for (let s = 0; s < COUNT; s++) {
            const q = this.touchQ[s];
            while (q.i < q.list.length) {
                const n = q.list[q.i];
                const d = t - n.t;
                if (d > TOUCH_MISS + 1e-9) {
                    this.record(n, 3, { diff: TOUCH_MISS, by: null, owners: [] });
                    this.afterHead(n);
                    q.i++;
                    continue;
                }
                if (n.group && n.group.registered * 2 > n.group.size && n.group.grade !== null) {
                    this.record(n, n.group.grade, { diff: d, by: 'group', owners: [] });
                    this.afterHead(n);
                    q.i++;
                    continue;
                }
                if (d < -TOUCH_EARLY - 1e-9 || d > TOUCH_WINDOW_END) break;
                let by = null;
                if (this.touchButtons && n.lane && edgeB(n.lane - 1) && !usedB[n.lane - 1]) {
                    usedB[n.lane - 1] = 1;
                    by = { src: 'btn', owners: ownersB(n.lane - 1) };
                } else if (edgeS(s) && !usedS[s]) {
                    usedS[s] = 1;
                    by = { src: 'sens', owners: ownersS(s) };
                }
                if (!by) break;
                const grade = touchGrade(d);
                this.record(n, grade, { diff: d, by: by.src, owners: by.owners });
                if (n.group) {
                    n.group.registered++;
                    if (n.group.registered * 2 <= n.group.size) n.group.grade = grade;
                }
                this.afterHead(n);
                q.i++;
            }
        }
        // a group over half pressed clears the members still waiting
        for (let s = 0; s < COUNT; s++) {
            const q = this.touchQ[s];
            const n = q.list[q.i];
            if (
                n &&
                n.group &&
                n.group.registered * 2 > n.group.size &&
                n.group.grade !== null &&
                t >= n.t - TOUCH_EARLY
            ) {
                this.record(n, n.group.grade, { diff: t - n.t, by: 'group', owners: [] });
                this.afterHead(n);
                q.i++;
            }
        }

        // hold bodies
        for (const h of this.holds) {
            if (h.done || t < h.n.t) continue;
            const aIdx = h.n.kind === 'hold' ? INDEX[`A${h.n.lane}`] : h.n.sIdx;
            const pressed =
                sens[aIdx] ||
                (h.n.lane && (h.n.kind === 'hold' || this.touchButtons) && btn[h.n.lane - 1]);
            const bodyFrom = h.n.t + h.headIgnore;
            const bodyTo = h.n.end - h.tailIgnore;
            if (pressed) h.wait = 0;
            else if (t >= bodyFrom && t <= bodyTo) {
                // letting go for up to 2 frames is forgiven, once
                if (!h.released && h.wait < 2 * FRAME - 1e-9) h.wait += FRAME;
                else {
                    h.release += h.wait + FRAME;
                    h.wait = 0;
                    h.released = true;
                }
            }
            if (t >= h.n.end) this.finishHold(h);
        }

        // slides, by the sensors that are ON now
        for (const s of this.slides) {
            if (s.done) continue;
            if (t >= s.n.start - 0.05) this.slideStep(s, sens);
            const finished = s.queues.every((q) => q.length === 0);
            if (finished) {
                const d = t - s.n.end;
                const grade = slideGrade(d, s.n.end - s.n.start);
                this.record(s.n, grade, { diff: d, by: 'sens', owners: [] });
                s.done = true;
            } else if (t - s.n.end > 36 * FRAME) {
                this.record(s.n, 3, { diff: 36 * FRAME, by: null, owners: [] });
                s.done = true;
            }
        }

        this.prevB.set(btn);
        this.prevS.set(sens);
    }

    slideStep(s, sens) {
        for (let qi = 0; qi < s.queues.length; qi++) {
            let q = s.queues[qi];
            while (q.length) {
                const first = q[0];
                this.checkArea(first, sens);
                const second = q[1];
                if (second) {
                    // every step may be skipped, so the one after is always looked at
                    this.checkArea(second, sens);
                    if (this.areaFinished(second)) {
                        q = q.slice(2);
                        s.queues[qi] = q;
                        continue;
                    }
                    if (this.areaOn(second)) {
                        q = q.slice(1);
                        s.queues[qi] = q;
                        continue;
                    }
                }
                if (this.areaFinished(first)) {
                    q = q.slice(1);
                    s.queues[qi] = q;
                } else break;
            }
        }
    }
    checkArea(area, sens) {
        for (const a of area.alts) {
            if (sens[a.idx]) a.on = true;
            else if (a.on) a.off = true;
        }
    }
    areaOn(area) {
        return area.alts.some((a) => a.on);
    }
    areaFinished(area) {
        return area.alts.some((a) => (area.last ? a.on : a.on && a.off));
    }

    afterHead(n) {
        if (n.kind === 'hold' || n.kind === 'touchHold') {
            const head = this.results.get(n.id);
            const len = n.end - n.t;
            const headIgnore = (n.kind === 'hold' ? 6 : 15) * FRAME;
            const tailIgnore = 12 * FRAME;
            this.holds.push({
                n,
                head,
                release: 0,
                wait: 0,
                released: false,
                done: false,
                headIgnore,
                tailIgnore,
                real: Math.min(Math.max(len - headIgnore - tailIgnore, 0), Math.max(len - 0.3, 0)),
            });
        }
    }
    finishHold(h) {
        h.done = true;
        const head = h.head;
        let grade = head.grade;
        if (h.real > 0) {
            const percent = Math.min(Math.max((h.real - h.release) / h.real, 0), 1);
            const body = percent >= 1 ? 0 : percent >= 0.67 ? 1 : percent >= 0.33 ? 2 : 3;
            grade = Math.max(head.grade, body);
        }
        this.results.set(h.n.id, { ...head, grade, holdRelease: h.release });
    }

    /** Anything still waiting at the end of the chart is a miss. */
    finish() {
        for (const n of this.notes) {
            if (!this.results.has(n.id))
                this.results.set(n.id, { grade: 3, diff: 0, by: null, owners: [] });
        }
        for (const h of this.holds) if (!h.done) this.finishHold(h);
        return this.results;
    }
}

module.exports = { Judge, judgeNotes, FRAME, tapGrade, touchGrade, slideGrade };
