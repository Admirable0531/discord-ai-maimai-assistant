// What a comparison of two players' best 50s says, as data: totals side by side, the charts both have with how far
// apart they are (in achievement and in rating points), and the charts only one of them has with what the other
// would need to score on them to get them into their own best 50. Pure: two snapshots in, numbers out.
const { chartKey, sum } = require('./maimaiPlayerSnapshot');
const { getRankByAchievement, getSongRating, findMinAchvForRating } = require('./maimaiRatingMath');

const B15 = 15;
const B35 = 35;

const rankOf = (achv) => getRankByAchievement(Math.min(achv, 100.5))?.title ?? '';

function tagged(snapshot) {
    return [
        ...snapshot.newPlays.map((p) => ({ ...p, section: 'new' })),
        ...snapshot.oldPlays.map((p) => ({ ...p, section: 'old' })),
    ];
}

/** The lowest rating in a section, i.e. what a new chart has to beat to get in; null while the section has room. */
function cutoff(plays, size) {
    if (plays.length < size) return null;
    return Math.min(...plays.map((p) => p.rating));
}

function summarise(snapshot) {
    const all = tagged(snapshot);
    const levels = all.map((p) => p.level).filter(Number.isFinite);
    const achv = all.map((p) => p.achievement).filter(Number.isFinite);
    return {
        rating: snapshot.rating,
        b15: sum(snapshot.newPlays),
        b35: sum(snapshot.oldPlays),
        charts: all.length,
        avgLevel: levels.length ? levels.reduce((x, y) => x + y, 0) / levels.length : null,
        hardest: levels.length ? Math.max(...levels) : null,
        level14: all.filter((p) => p.level >= 14).length,
        avgAchv: achv.length ? achv.reduce((x, y) => x + y, 0) / achv.length : null,
        sssPlus: all.filter((p) => p.achievement >= 100.5).length,
        sssUp: all.filter((p) => p.achievement >= 100).length,
        cutoffNew: cutoff(snapshot.newPlays, B15),
        cutoffOld: cutoff(snapshot.oldPlays, B35),
    };
}

/**
 * For a chart the other player does not have in their best 50: what the same score would be worth to them, and the lowest
 * score that would get it in. `gain` is the rating it would add over their weakest chart in that section (the whole
 * rating while the section has room); `needed` is null when any score gets it in, and `unreachable` when even 100.5% cannot.
 */
function chase(play, otherSummary) {
    const cut = play.section === 'new' ? otherSummary.cutoffNew : otherSummary.cutoffOld;
    const same = getSongRating(play.level, play.achievement)?.rating ?? play.rating;
    if (cut === null) return { gain: same, needed: null, neededRank: null, unreachable: false };
    const found = findMinAchvForRating(play.level, cut + 1);
    return {
        gain: Math.max(0, same - cut),
        needed: found ? found.achv_needed : null,
        neededRank: found ? found.rank : null,
        unreachable: !found,
    };
}

/**
 * @returns {{sa, sb, shared: Array, onlyA: Array, onlyB: Array, netRating: number, aAhead: number, bAhead: number}}
 * `shared` is every chart in both best 50s, biggest achievement gap first; gaps are A minus B.
 */
function compareSnapshots(a, b) {
    const sa = summarise(a);
    const sb = summarise(b);
    const keyed = (snapshot) =>
        new Map(tagged(snapshot).map((p) => [chartKey(p.song, p.chartType, p.difficulty), p]));
    const ma = keyed(a);
    const mb = keyed(b);

    const shared = [];
    for (const [key, pa] of ma) {
        const pb = mb.get(key);
        if (!pb) continue;
        shared.push({
            song: pa.song,
            chartType: pa.chartType,
            difficulty: pa.difficulty,
            level: pa.level,
            a: { achievement: pa.achievement, rating: pa.rating, rank: rankOf(pa.achievement) },
            b: { achievement: pb.achievement, rating: pb.rating, rank: rankOf(pb.achievement) },
            gap: pa.achievement - pb.achievement,
            ratingGap: pa.rating - pb.rating,
        });
    }
    shared.sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));

    const onlyA = [...ma.entries()]
        .filter(([key]) => !mb.has(key))
        .map(([, p]) => ({ ...p, rank: rankOf(p.achievement), chase: chase(p, sb) }))
        .sort((x, y) => y.rating - x.rating);
    const onlyB = [...mb.entries()]
        .filter(([key]) => !ma.has(key))
        .map(([, p]) => ({ ...p, rank: rankOf(p.achievement), chase: chase(p, sa) }))
        .sort((x, y) => y.rating - x.rating);

    return {
        sa,
        sb,
        shared,
        onlyA,
        onlyB,
        netRating: shared.reduce((total, s) => total + s.ratingGap, 0),
        aAhead: shared.filter((s) => s.gap > 0).length,
        bAhead: shared.filter((s) => s.gap < 0).length,
    };
}

module.exports = { summarise, compareSnapshots, chase, rankOf };
