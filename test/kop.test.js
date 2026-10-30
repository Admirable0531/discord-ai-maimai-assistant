const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRanking, formatUpdate, withMovement } = require('../src/web/kopRanking');
const { kopMessage, rankingLine, PARTS } = require('../src/discord/kopText');

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

test('KOP text: lines are searchable, friends starred, movement shown', () => {
    const [first] = withMovement(parseRanking(body), [{ rank: 2, name: 'TNT_M+7R' }]);
    assert.equal(rankingLine(first, false), '`  1` TNT\\_M+7R — 3,029,466 · DX 9,367 ▲1');
    const [, second] = withMovement(parseRanking(body), [{ rank: 9, name: 'x' }]);
    assert.equal(rankingLine(second, true), '`  2` ⭐ **Minjin** — 3,029,447 · DX 9,382 🆕');
});

test("KOP text: the top 100 in three messages, each within Discord's limit", () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
        rank: i + 1,
        name: 'ＷＷＷＷＷＷＷＷ', // eight full-width characters, the longest maimai allows
        score: 3029999 - i,
        dxScore: 9999,
        move: i % 2 ? 'new' : -12,
    }));
    const parts = PARTS.map((_, index) =>
        kopMessage({
            region: 'International',
            updated: '2026/10/30 02:00 JST',
            pageUrl: 'https://example.com/r',
            entries,
            index,
        })
    );
    assert.ok(
        parts.every((t) => t.length <= 2000),
        parts.map((t) => t.length).join()
    );
    assert.match(parts[0], /^\*\*KOP8th maimai — International\*\* · updated/);
    assert.match(parts[0], /ranks 1–34/);
    assert.match(parts[2], /ranks 68–100/);
    assert.equal(parts.join('\n').match(/^`/gm).length, 100);
});
