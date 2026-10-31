const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRanking, formatUpdate, withMovement } = require('../src/web/kopRanking');
const { kopEmbeds, packMessages, percent, percentDelta } = require('../src/discord/kopEmbeds');

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

const region = { key: 'intl', label: 'International', pageUrl: 'https://example.com/r' };

test('KOP embeds: scores as summed percentages, with the change since last time', () => {
    assert.equal(percent(3029910), '302.9910%');
    assert.equal(percentDelta(123), '+0.0123%');
    assert.equal(percentDelta(-5), '−0.0005%');

    const previous = [
        { rank: 1, name: 'Ｍｉｎｊｉｎ', score: 3029300 },
        { rank: 2, name: 'TNT_M+7R', score: 3029466 },
        { rank: 3, name: 'Gone', score: 3029000 },
    ];
    const entries = withMovement(parseRanking(body), previous);
    const embeds = kopEmbeds({
        region,
        updated: '2026/10/31 02:00 JST',
        entries,
        previous,
        ours: new Set([2]),
    });
    const list = embeds[0].description;
    assert.match(list, /`01\.` \*\*TNT\\_M\+7R\*\* — 302\.9466% ⬆️1/); // same score: no (+), moved up
    assert.match(list, /`02\.` ⭐ \*\*Minjin\*\* — 302\.9447% \(\+0\.0147%\) ⬇️1/);
    assert.match(list, /`03\.` \*\*67tify☆\*\* — 302\.9367% 🆕/);
    assert.match(list, /Friends:\*\* Minjin #2/);

    const report = embeds[embeds.length - 1].description;
    assert.match(report, /BIGGEST IMPROVERS/);
    assert.match(report, /Minjin\*\* — \+0\.0147% → 302\.9447%/);
    assert.match(report, /New in the top 3:\*\* 1/);
    assert.match(report, /Gone \(was #3\)/);
});

test("KOP embeds: the first update has no report, and 100 lines fit Discord's limits", () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
        rank: i + 1,
        name: 'ＷＷＷＷＷＷＷＷ', // eight full-width characters, the longest maimai allows
        score: 3029999 - i * 150,
        dxScore: 9000,
        move: null,
    }));
    const first = kopEmbeds({ region, updated: '', entries, previous: null });
    assert.equal(first.length, 2);
    assert.match(first[1].footer.text, /first update/);

    const previous = entries.map((e) => ({ ...e, score: e.score - 5000 }));
    const moved = withMovement(entries, previous);
    const embeds = kopEmbeds({ region, updated: '', entries: moved, previous });
    assert.equal(embeds.length, 3);
    assert.ok(embeds.every((e) => e.description.length <= 4096));
    const messages = packMessages(embeds);
    assert.ok(
        messages.every(
            (m) =>
                m.reduce(
                    (n, e) =>
                        n + e.title.length + e.description.length + (e.footer?.text.length || 0),
                    0
                ) <= 6000
        )
    );
    assert.equal(messages.flat().length, 3);
});
