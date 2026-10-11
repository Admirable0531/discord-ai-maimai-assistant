const test = require('node:test');
const assert = require('node:assert/strict');
const { extractChart } = require('../src/chart/simaiPage');
const { buildChart, countEvents } = require('../src/chart/chartModel');
const { analyse } = require('../src/chart/rules');
const { slideTracks } = require('../src/chart/slidePaths');
const { neighbouringButtons } = require('../src/chart/geometry');

const names = (track) => track.map((alts) => alts.join('/')).join('>');
const slide = (head, shape, via) => ({ head, segments: [{ shape, via }] });
const rules = (text) => analyse(buildChart(text)).map((f) => f.rule);

test('extractChart reads a chart split over several blocks and decodes entities', () => {
    const html =
        '<h2 id="a">MASTER</h2><div>\n(120)<br />\n{4}1,2,<br />\n</div><br /><div>\n3&gt;5[4:1],E\n</div>\n<a id="Re:MASTER">';
    assert.equal(extractChart(html, 'master').replace(/\n+/g, '\n'), '(120)\n{4}1,2,\n3>5[4:1],E');
    assert.equal(extractChart(html, 'expert'), null);
});

test('extractChart ignores wiki comments before the chart and reports a missing chart', () => {
    const html = '<h2>Re:MASTER</h2><ul><li>added -- someone (2024)</li></ul><a id="x">';
    assert.equal(extractChart(html, 'remaster'), null);
});

test('buildChart gives times in seconds and counts note kinds', () => {
    const chart = buildChart('(120){4}1,2h[4:1],3-5[4:1]b,A1,E');
    const counts = countEvents(chart.events);
    assert.deepEqual(counts, { tap: 2, hold: 1, slide: 0, touch: 1, break: 1 });
    assert.equal(chart.events[1].time, 0.5); // 120 bpm, a quarter note
});

test('sensor geometry: E6 borders buttons 5 and 6, E1 borders 8 and 1', () => {
    const buttons = (s, n) =>
        neighbouringButtons(s, n)
            .map((x) => x.button)
            .sort();
    assert.deepEqual(buttons('E', 6), [5, 6]);
    assert.deepEqual(buttons('E', 1), [1, 8]);
});

test('slide paths follow the guide, rotated and mirrored', () => {
    assert.equal(names(slideTracks(slide(1, 'StraightLine', [3]))[0]), 'A1>A2/B2>A3');
    assert.equal(names(slideTracks(slide(6, 'StraightLine', [2]))[0]), 'A6>B6>C>B2>A2');
    assert.equal(names(slideTracks(slide(1, 'EdgeFold', [7, 5]))[0]), 'A1>A8/B8>A7>A6/B6>A5');
    assert.equal(names(slideTracks(slide(3, 'CurveCcw', [7]))[0]), 'A3>B2>B1>B8>A7');
    assert.equal(slideTracks(slide(1, 'Fan', [5])).length, 3);
});

test('A2: a touch beside a held button is flagged', () => {
    assert.ok(rules('(120){4}5h[2:1],E6,,,E').includes('A2'));
    assert.ok(!rules('(120){4}2h[2:1],E6,,,E').includes('A2'));
});

test('A1: a touch just before a neighbouring tap is flagged, a far one is not', () => {
    assert.ok(rules('(120){16}E6,6,,,,,,,E').includes('A1'));
    assert.ok(!rules('(120){16}E6,3,,,,,,,E').includes('A1'));
});

test('A6: two slides on the same sensor at the same time are flagged', () => {
    assert.ok(rules('(120){4}1-3[2:1]/5-3[2:1],,,,E').includes('A6'));
});

test('A13: a note on the sensor a slide just ended on is flagged', () => {
    assert.ok(rules('(120){4}1-3[4:1],,3,,,E').includes('A13'));
});

test('viewer page is self-contained, escapes the title and never embeds chart text', () => {
    const { buildViewerHtml } = require('../src/chart/viewerPage');
    const text = '(120){4}1,2h[4:1],E6,3-5[4:1],E';
    const chart = buildChart(text);
    const html = buildViewerHtml({
        title: '<b>x</b> & y',
        difficulty: 'master',
        events: chart.events,
        finish: chart.finish,
        findings: analyse(chart),
        tempoChanges: chart.tempoChanges,
    });
    assert.ok(!html.includes('<b>x</b>'));
    assert.ok(!html.includes(text));
    assert.ok(!/https?:\/\//.test(html), 'no external requests');
    assert.ok(html.includes('const D={'));
});

test('A1 is one step softer because a touch has a wide Perfect window, and says so', () => {
    const found = analyse(buildChart('(120){16}E6/6,,,,E')).find((f) => f.rule === 'A1');
    assert.ok(found);
    assert.equal(found.severity, 2); // simultaneous would be 3 for a strict note
    assert.match(found.text, /150 ms early to 200 ms late/);
});

test('A14: a group of three simultaneous touches needs only two', () => {
    const found = analyse(buildChart('(120){4}E1/E3/E5,,,,E')).find((f) => f.rule === 'A14');
    assert.ok(found);
    assert.match(found.text, /2 of the 3 is enough/);
    assert.ok(!analyse(buildChart('(120){4}E1/E3,,,,E')).some((f) => f.rule === 'A14'));
});

test('a slide sweeping over a touch is not a splash, but a touch landing just before it is, softened', () => {
    const same = analyse(buildChart('(120){8}1-5[4:1],,,C,,,E')).map((f) => f.rule);
    assert.ok(!same.includes('A4'));
    const early = analyse(buildChart('(120){16}1-5[4:1],,,,,C,,,,,,,,,E')).find(
        (f) => f.rule === 'A5'
    );
    if (early) assert.match(early.text, /Perfect from/);
});

test('maidata lines follow the source lines and carry the time of every step', () => {
    const { maidataLines } = require('../src/chart/maidata');
    const lines = maidataLines('(120){4}1,2,\n,3,E');
    assert.deepEqual(
        maidataLines('(120){4}E3,,E5,,E').map((l) => l.s),
        ['(120){4}E3,,E5,,']
    );
});

test('search folds accents and finds a song from part of its name', async () => {
    const { fold } = require('../src/chart/simaiWiki');
    assert.equal(fold('RONDØ'), 'rondo');
    assert.equal(fold('Straight into the lights'), 'straightintothelights');
    assert.ok(fold('RONDØ').startsWith(fold('rond')));
});

test('a pasted maidata file gives the chosen difficulty, and raw text is used as it is', () => {
    const { parseCustomChart } = require('../src/chart/customChart');
    const file =
        '&title=My Song\n&lv_4=12\n&inote_4=(120){4}1,2,E\n&inote_5=(120){4}3,4,5,E\n&first=0.1';
    const auto = parseCustomChart(file);
    assert.equal(auto.title, 'My Song');
    assert.equal(auto.label, 'Master');
    assert.equal(auto.text, '(120){4}3,4,5,E');
    assert.equal(parseCustomChart(file, { difficulty: 'expert' }).text, '(120){4}1,2,E');
    assert.match(parseCustomChart(file, { difficulty: 'basic' }).error, /no Basic chart/);
    assert.equal(parseCustomChart('(120){4}1,2,E').text, '(120){4}1,2,E');
    assert.ok(!parseCustomChart('   ').success);
});

test('a break that starts a slide is a star, and counts once', () => {
    const chart = buildChart('(120){4}1b-5[4:1],E');
    const head = chart.events.find((e) => e.kind === 'break');
    assert.ok(head && head.star);
    assert.deepEqual(countEvents(chart.events), { tap: 0, hold: 0, slide: 1, touch: 0, break: 1 });
});

test('only a double slide makes a slide strip yellow; a simultaneous tap only yellows its head', () => {
    const { buildViewerHtml } = require('../src/chart/viewerPage');
    const dataOf = (text) => {
        const chart = buildChart(text);
        const html = buildViewerHtml({
            title: 't',
            difficulty: 'master',
            events: chart.events,
            finish: chart.finish,
            findings: [],
            tempoChanges: chart.tempoChanges,
        });
        return JSON.parse(/const D=(\{.*?\});\n/s.exec(html)[1].replace(/\\u003c/g, '<'));
    };
    const withTap = dataOf('(120){4}1-5[4:1]/3,,,,E').events.find((e) => e.k === 's');
    assert.ok(!withTap.e, 'strip stays blue');
    assert.ok(withTap.he, 'head is yellow');
    const double = dataOf('(120){4}1-5[4:1]/2-6[4:1],,,,E').events.filter((e) => e.k === 's');
    assert.ok(double.every((e) => e.e));
});

test('a tap beside a slide start is flagged (A16), and two touches beside each other are not', () => {
    const rules = (text) => analyse(buildChart(text)).map((f) => f.rule);
    assert.ok(rules('(120){4}1-5[4:1],2,,,\nE').includes('A16'));
    assert.ok(!rules('(120){4}1-5[4:1],5,,,\nE').includes('A16'));
    assert.ok(!rules('(120){4}A1,A2,,,\nE').includes('A3'));
});
