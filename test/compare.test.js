const test = require('node:test');
const assert = require('node:assert/strict');
const { compareSnapshots, chase } = require('../src/web/maimaiCompare');
const { buildCompareHtml } = require('../src/render/compareCard');

const play = (song, level, achievement, rating, over = {}) => ({
    song,
    chartType: 'dx',
    difficulty: 'master',
    version: 'X',
    level,
    achievement,
    rating,
    ...over,
});
const snap = (name, rating, newPlays, oldPlays) => ({
    success: true,
    player: { name, id: name },
    rating,
    newPlays,
    oldPlays,
    stale: false,
});

// 15 new and 35 old plays each, so both have a cutoff
function full(prefix, newPlays, oldPlays, rating) {
    const fillNew = Array.from({ length: 15 - newPlays.length }, (_, i) =>
        play(`${prefix} new ${i}`, 13.0, 99, 270)
    );
    const fillOld = Array.from({ length: 35 - oldPlays.length }, (_, i) =>
        play(`${prefix} old ${i}`, 13.0, 99, 270)
    );
    return snap(prefix, rating, [...newPlays, ...fillNew], [...oldPlays, ...fillOld]);
}

test('shared charts carry both scores, the gap and the rating gap, biggest gap first', () => {
    const a = full(
        'A',
        [play('Song One', 14.8, 100.08, 311)],
        [play('Song Two', 14.5, 100.5, 326)],
        16000
    );
    const b = full(
        'B',
        [play('Song One', 14.8, 100.98, 322)],
        [play('Song Two', 14.5, 100.4, 325)],
        16100
    );
    const d = compareSnapshots(a, b);
    assert.equal(d.shared.length, 2);
    assert.equal(d.shared[0].song, 'Song One'); // |gap| 0.90 beats 0.10
    assert.equal(d.shared[0].a.rank, 'SSS');
    assert.equal(d.shared[0].b.rank, 'SSS+');
    assert.equal(d.shared[0].ratingGap, 311 - 322);
    assert.equal(d.aAhead, 1);
    assert.equal(d.bAhead, 1);
    assert.equal(d.netRating, 311 - 322 + 326 - 325);
});

test('a chart only one player has says what the other would need to get it into their best 50', () => {
    const a = full('A', [play('Only A', 14.7, 100.5, 330)], [], 16000);
    const b = full('B', [], [], 16000);
    const d = compareSnapshots(a, b);
    const row = d.onlyA.find((p) => p.song === 'Only A');
    assert.ok(row);
    // B's weakest new-version chart is 270 rating; 330 at the same score beats it by 60
    assert.equal(row.chase.gain, 60);
    assert.ok(row.chase.needed >= 97 && row.chase.needed <= 100.5, String(row.chase.needed));
    assert.equal(row.chase.unreachable, false);
    assert.equal(row.chase.cutoff, 270);
});

test('a section with room takes any score, and an impossible chart is out of reach', () => {
    const room = { cutoffNew: null, cutoffOld: 300 };
    const p = { ...play('X', 14.0, 99.0, 291), section: 'new' };
    assert.equal(chase(p, room).needed, null);
    const hard = { ...play('Y', 12.0, 100.5, 270), section: 'old' };
    assert.equal(chase(hard, { cutoffNew: null, cutoffOld: 400 }).unreachable, true);
});

test('the card escapes names and titles and shows both players', () => {
    const a = full('A', [play('<b>Song</b>', 14.8, 100.08, 311)], [], 16000);
    const b = full('B <script>', [play('<b>Song</b>', 14.8, 100.98, 322)], [], 16100);
    const html = buildCompareHtml({
        nameA: 'Ａｌｉｃｅ',
        nameB: b.player.name,
        data: compareSnapshots(a, b),
    });
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<b>Song</b>'));
    assert.ok(html.includes('Alice')); // full-width name folded for reading
    assert.ok(html.includes('1 shared chart'));
    assert.ok(html.includes('16,000') && html.includes('16,100'));
});

test('no shared chart and identical sets do not break the card', () => {
    const a = full('A', [], [], 15000);
    const html = buildCompareHtml({ nameA: 'A', nameB: 'B', data: compareSnapshots(a, a) });
    assert.ok(html.includes('shared chart'));
});
