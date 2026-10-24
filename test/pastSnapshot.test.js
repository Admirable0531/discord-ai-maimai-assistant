const test = require('node:test');
const assert = require('node:assert/strict');
const { pickDay } = require('../src/web/maimaiPastSnapshot');

const day = (iso) => Date.UTC(...iso.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
const points = [
    { t: day('2025-01-10'), rating: 15980 },
    { t: day('2025-01-14'), rating: 16000 },
    { t: day('2025-01-20'), rating: 16030 },
];

test('past B50: the first day a rating was reached', () => {
    assert.equal(pickDay(points, { reachedRating: 16000 }).point.t, day('2025-01-14'));
    assert.equal(pickDay(points, { reachedRating: 15000 }).point.t, day('2025-01-10'));
    assert.match(pickDay(points, { reachedRating: 17000 }).error, /highest is 16030/);
});

test('past B50: a date reads that day or the last snapshot before it', () => {
    assert.equal(pickDay(points, { date: '2025-01-14' }).point.t, day('2025-01-14'));
    assert.equal(pickDay(points, { date: '2025-01-17' }).point.t, day('2025-01-14'));
    assert.match(pickDay(points, { date: '2024-12-01' }).error, /start on 2025-01-10/);
    assert.match(pickDay(points, { date: '14 Jan' }).error, /YYYY-MM-DD/);
    assert.match(pickDay([], { date: '2025-01-14' }).error, /No snapshots/);
});
