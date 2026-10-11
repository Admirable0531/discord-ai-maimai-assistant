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
    });
    assert.ok(!html.includes('<b>x</b>'));
    assert.ok(!html.includes(text));
    assert.ok(!/https?:\/\//.test(html), 'no external requests');
    assert.ok(html.includes('const D={'));
});
