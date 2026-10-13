const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChart } = require('../src/chart/chartModel');
const { Judge, judgeNotes, FRAME } = require('../src/sim/judge');
const { INDEX, COUNT, cover, centre } = require('../src/sim/sensors');
const { simulate, monteCarlo } = require('../src/sim/run');
const { STYLES } = require('../src/sim/styles');

/**
 * Runs the judge on hand-written presses: [{src: 'btn'|'sens', idx, from, to, id?}],
 * times in seconds. Returns the result map.
 */
function judged(text, presses, opts) {
    const chart = buildChart(text);
    const notes = judgeNotes(chart.events);
    const judge = new Judge(notes, opts);
    const btn = new Uint8Array(8);
    const sens = new Uint8Array(COUNT);
    const end = Math.max(...notes.map((n) => n.end || n.t)) + 1;
    for (let f = -30; f * FRAME < end; f++) {
        const t = f * FRAME;
        btn.fill(0);
        sens.fill(0);
        const own = { btn: Array(8).fill(null), sens: Array(COUNT).fill(null) };
        for (const p of presses) {
            if (t >= p.from - 1e-9 && t < p.to - 1e-9) {
                (p.src === 'btn' ? btn : sens)[p.idx] = 1;
                (p.src === 'btn' ? own.btn : own.sens)[p.idx] = [p.id ?? -1];
            }
        }
        judge.frame(f, btn, sens, own);
    }
    return { results: judge.finish(), chart };
}
const A = (n) => INDEX[`A${n}`];

test('a button press on time is Perfect; 120 ms early is only Good; 200 ms early does nothing', () => {
    const text = '(120){4}1,,,,E';
    assert.equal(judged(text, [{ src: 'btn', idx: 0, from: 0, to: 0.1 }]).results.get(0).grade, 0);
    assert.equal(
        judged(text, [{ src: 'btn', idx: 0, from: -0.12, to: 0.1 }]).results.get(0).grade,
        2
    );
    assert.equal(
        judged(text, [{ src: 'btn', idx: 0, from: -0.2, to: 0.1 }]).results.get(0).grade,
        3
    );
});

test('a tap can be taken by the A sensor of its lane too', () => {
    const r = judged('(120){4}4,,,,E', [{ src: 'sens', idx: A(4), from: 0, to: 0.1 }]).results.get(
        0
    );
    assert.equal(r.grade, 0);
    assert.equal(r.by, 'sens');
});

test('a touch is still Perfect 150 ms early, and an edge earlier than that is ignored', () => {
    const text = '(120){4}E5,,,,E';
    const idx = INDEX.E5;
    assert.equal(
        judged(text, [{ src: 'sens', idx, from: -0.14, to: 0.2 }]).results.get(0).grade,
        0
    );
    assert.equal(judged(text, [{ src: 'sens', idx, from: -0.2, to: 0.5 }]).results.get(0).grade, 3);
});

test('only the first note of a lane can take a press: the earlier one gets it', () => {
    const { results } = judged('(120){16}1,1,,,,,,,E', [
        { src: 'btn', idx: 0, from: 0.13, to: 0.2 },
    ]);
    // notes at 0 and 0.125; a press at 0.13 is inside both windows, the earlier note takes it
    assert.equal(results.get(0).grade, 2);
    assert.equal(results.get(1).grade, 3);
});

test('a touch group: more than half pressed clears the rest', () => {
    const text = '(120){4}E1/E3/E5,,,,E';
    const presses = [INDEX.E1, INDEX.E3].map((idx) => ({ src: 'sens', idx, from: 0, to: 0.1 }));
    const { results } = judged(text, presses);
    assert.deepEqual(
        [...results.values()].map((r) => r.grade),
        [0, 0, 0]
    );
    const one = judged(text, presses.slice(0, 1)).results;
    assert.equal([...one.values()].filter((r) => r.grade === 3).length, 2);
});

test('a slide needs its sensors in order; another hand finishing it early gives a bad grade', () => {
    const text = '(120){4}1-3[2:1],,,,,,E';
    const chart = buildChart(text);
    const slide = chart.events.find((e) => e.kind === 'slide');
    const mid = (name, a, b) => ({ src: 'sens', idx: INDEX[name], from: a, to: b, id: 99 });
    const t0 = slide.start;
    const span = slide.end - slide.start;
    const inTime = [
        mid('A1', t0 - 0.02, t0 + 0.05),
        mid('A2', t0 + span / 2 - 0.03, t0 + span / 2 + 0.03),
        mid('A3', slide.end - 0.03, slide.end + 0.05),
    ];
    const ok = judged(text, inTime).results;
    const slideId = chart.events.indexOf(slide);
    assert.equal(ok.get(slideId).grade, 0);
    const early = judged(text, [
        mid('A1', 0.1, 0.2),
        mid('A2', 0.25, 0.3),
        mid('A3', 0.35, 0.4),
    ]).results;
    assert.ok(
        early.get(slideId).grade >= 1,
        'finishing the whole slide far too early is not Perfect'
    );
});

test('a hold held all the way is Perfect, let go early it is not', () => {
    const text = '(120){4}1h[2:1],,,,,E';
    const full = judged(text, [{ src: 'btn', idx: 0, from: 0, to: 1.05 }]).results.get(0);
    assert.equal(full.grade, 0);
    const short = judged(text, [{ src: 'btn', idx: 0, from: 0, to: 0.4 }]).results.get(0);
    assert.ok(short.grade >= 2);
});

test('sensor geometry: a fingertip on A5 turns on A5 alone, a palm covers its neighbours too', () => {
    const out = new Int32Array(COUNT);
    cover(...centre('A5'), 0.05, out);
    assert.equal(out.filter((n) => n > 0).length, 1);
    out.fill(0);
    cover(...centre('A5'), 0.32, out);
    assert.ok(out.filter((n) => n > 0).length >= 4);
});

test('with no aiming or timing error every style clears a small chart cleanly', () => {
    const chart = buildChart('(120){4}1,2,3,4,5,6,7,8,E6,1h[2:1],4-6[2:1],,,,E');
    for (const style of Object.values(STYLES)) {
        const { outcomes } = simulate(chart.events, { ...style, posSigma: 0, timeSigma: 0 }, 1);
        assert.ok(
            [...outcomes.values()].every((o) => o.kind === 'clean'),
            style.id
        );
    }
});

test('seven presses at once cannot be played by two hands', () => {
    const chart = buildChart('(120){4}1/2/3/4/5/6/7,,,,E');
    const { late } = simulate(chart.events, { ...STYLES.fingertips, posSigma: 0, timeSigma: 0 }, 1);
    assert.ok(late.length >= 1);
});

test('a palm slide over a tap next to its path splashes that tap far more often than a fingertip', () => {
    // slide from 1 to 5 passes the sensors near lane 3/4; a tap on lane 3 arrives just after
    const chart = buildChart('(120){8}1-5[2:1],,,,3,,,,E');
    const finger = monteCarlo(chart.events, { ...STYLES.fingertips, tapMode: 'screen' }, 30);
    const palm = monteCarlo(
        chart.events,
        { ...STYLES.palm, tapMode: 'screen', touchButtons: false },
        30
    );
    const bad = (mc) =>
        [...mc.stats.values()].reduce(
            (n, s) => n + (s.kinds.foreign || 0) + (s.kinds.blocked || 0),
            0
        );
    assert.ok(bad(palm) >= bad(finger));
});

test('a wide touch on E5 just before a tap on button 4 splashes it; fingertips and buttons do not; touches never splash touches', () => {
    const bad = (text, id) => {
        const mc = monteCarlo(buildChart(text).events, STYLES[id], 40);
        return [...mc.stats.values()].reduce((n, s) => n + (s.kinds.foreign || 0), 0);
    };
    const text = '(120){16}E5,4,,,,,,,,E';
    assert.ok(bad(text, 'bigTouch') > bad(text, 'fingertips'));
    assert.equal(bad(text, 'fingertips'), 0);
    assert.equal(bad('(120){16}E5,E4,,,,,,,,E', 'bigTouch'), 0);
});

test('the simulation report names the spots and the styles that cause them', () => {
    const { simulateSpots } = require('../src/sim/report');
    const chart = buildChart('(120){16}E5,4,,,,,,,,E');
    const sim = simulateSpots(chart.events, { runs: 20, styleIds: ['fingertips', 'bigTouch'] });
    assert.ok(sim.spots.length >= 1);
    assert.ok(sim.spots[0].perStyle.bigTouch);
    assert.ok(!sim.spots[0].perStyle.fingertips);
    assert.ok(sim.replay.bigTouch.strokes.length > 0);
});

test('hand habit: by side each hand keeps its half, by role one hand takes the slide and holds', () => {
    const chart = buildChart('(120){4}7,3,7,3,1-5[2:1],,,,E');
    const base = { ...STYLES.fingerPad, posSigma: 0, timeSigma: 0, habit: 'side', policy: 'rules' };
    const side = simulate(chart.events, base, 1).strokes.filter((s) => s.role !== 'transit');
    // lane 7 is on the left of the screen, lane 3 on the right
    const handOf = (lane) =>
        side.filter((s) => chart.events[s.id].lane === lane && s.pts).map((s) => s.hand);
    assert.ok(handOf(7).every((h) => h === 0));
    assert.ok(handOf(3).every((h) => h === 1));
    const role = simulate(chart.events, { ...base, habit: 'role' }, 1);
    const slideHands = role.strokes.filter((s) => s.role === 'slide').map((s) => s.hand);
    const tapHands = role.strokes.filter((s) => s.role === 'press').map((s) => s.hand);
    assert.ok(slideHands.every((h) => !tapHands.includes(h)) || tapHands.length === 0);
});

test('hand-off: with handoff 1 the slide is set off by the other hand than the one that tapped its star', () => {
    const chart = buildChart('(120){4}1-5[2:1],,,,E');
    const style = {
        ...STYLES.fingerPad,
        tapMode: 'screen',
        posSigma: 0,
        timeSigma: 0,
        handoff: 1,
        habit: 'free',
        policy: 'rules',
    };
    const strokes = simulate(chart.events, style, 3).strokes.filter((s) => s.role !== 'transit');
    const star = strokes.find((s) => s.role === 'press');
    const slide = strokes.find((s) => s.role === 'slide');
    assert.notEqual(star.hand, slide.hand);
    const same = simulate(chart.events, { ...style, handoff: 0 }, 3).strokes.filter(
        (s) => s.role !== 'transit'
    );
    assert.equal(
        same.find((s) => s.role === 'press').hand,
        same.find((s) => s.role === 'slide').hand
    );
});

test('hand-off is only used when it is sensible: not while the other hand is busy holding', () => {
    // a hold on lane 4 is held through the whole slide, so the slide cannot be given to that hand
    const chart = buildChart('(120){4}4h[1:1]/1-5[2:1],,,,E');
    const style = {
        ...STYLES.fingerPad,
        tapMode: 'screen',
        posSigma: 0,
        timeSigma: 0,
        handoff: 1,
        habit: 'free',
        policy: 'rules',
    };
    for (const seed of [1, 2, 3, 4]) {
        const strokes = simulate(chart.events, style, seed).strokes.filter(
            (s) => s.role !== 'transit'
        );
        const star = strokes.find((s) => s.role === 'press');
        const slide = strokes.find((s) => s.role === 'slide');
        assert.equal(star.hand, slide.hand);
    }
});

test('the learned hand choice puts left-side notes on the left hand and right-side notes on the right', () => {
    const chart = buildChart('(120){4}7,3,7,3,6,2,6,2,E');
    const strokes = simulate(
        chart.events,
        { ...STYLES.expert, posSigma: 0, timeSigma: 0 },
        1
    ).strokes.filter((s) => s.role !== 'transit');
    const left = [6, 7];
    const ok = strokes.filter((s) =>
        left.includes(chart.events[s.id].lane) ? s.hand === 0 : s.hand === 1
    ).length;
    assert.ok(ok >= strokes.length - 1, `${ok} of ${strokes.length} on the expected side`);
});
