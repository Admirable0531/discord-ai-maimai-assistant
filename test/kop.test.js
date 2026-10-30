const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRanking, formatUpdate, withMovement } = require('../src/web/kopRanking');
const { buildKopHtml } = require('../src/render/kopCard');

const body = {
    update: '2026/10/30 02:00:00 (JST)',
    ranking: [
        {
            rank: '2',
            userName: 'Ｍｉｎｊｉｎ',
            score: '3029447',
            subScore: '9382',
            recordDate: 'x',
        },
        {
            rank: '1',
            userName: 'ＴＮＴ＿Ｍ＋７Ｒ',
            score: '3029466',
            subScore: '9367',
            recordDate: 'y',
        },
        { rank: '3', userName: '６７ｔｉｆｙ☆', score: '3029367', subScore: '9350' },
    ],
};

test('KOP: the JSON becomes ranked entries and a readable update time', () => {
    const entries = parseRanking(body);
    assert.deepEqual(
        entries.map((e) => [e.rank, e.score, e.dxScore]),
        [
            [1, 3029466, 9367],
            [2, 3029447, 9382],
            [3, 3029367, 9350],
        ]
    );
    assert.equal(formatUpdate(body.update), '2026/10/30 02:00 JST');
    assert.equal(formatUpdate('2026/10/30 07:00:00'), '2026/10/30 07:00 JST');
    assert.deepEqual(parseRanking({}), []);
});

test('KOP: movement since the previous update', () => {
    const now = parseRanking(body);
    assert.ok(withMovement(now, null).every((e) => e.move === null));
    const before = [
        { rank: 1, name: 'Ｍｉｎｊｉｎ' },
        { rank: 2, name: 'TNT_M+7R' }, // the same player, written half-width
        { rank: 9, name: 'someone else' },
    ];
    assert.deepEqual(
        withMovement(now, before).map((e) => e.move),
        [1, -1, 'new']
    );
});

test('KOP card: rows, movement glyphs, and friends below the cut', () => {
    const entries = withMovement(parseRanking(body), [{ rank: 1, name: 'Ｍｉｎｊｉｎ' }]);
    const html = buildKopHtml({
        region: 'International',
        updated: '2026/10/30 02:00 JST',
        entries,
        ours: new Set([3]),
        maxRows: 2,
    });
    assert.match(html, /TNT_M\+7R/);
    assert.match(html, /▼1/);
    assert.match(html, /NEW/);
    assert.doesNotMatch(html, /···/); // rank 3 follows rank 2: highlighted, but no gap
    const far = buildKopHtml({
        region: 'Japan',
        updated: '',
        entries: [...entries, { rank: 9, name: 'Far', score: 1, dxScore: 1, move: 0 }],
        ours: new Set([9]),
        maxRows: 2,
    });
    assert.match(far, /···/);
    assert.match(html, /67tify☆<span class="tag">friend/);
    assert.match(html, /3,029,466/);
});
