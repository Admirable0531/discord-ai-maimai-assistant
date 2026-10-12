// What the L. R. Breakdown videos say about how players share a chart between hands.
//
//   node scripts/lr/summary.js [dir]           (default data/lr)
//
// Reads the per-video files from run.js, works out which colour is the left hand (the one that
// mostly plays on the left of the screen) and prints how often hands cross over, who plays
// slides, holds and touches, how often the hand that tapped a slide's star is not the one that
// slides, and how simultaneous notes are split.
const fs = require('fs');
const path = require('path');
const { centre } = require('../../src/sim/sensors');

const DIR = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'lr');
const laneX = (l) => Math.sin(((22.5 + 45 * (l - 1)) * Math.PI) / 180);
const x = (n) => (n.lane ? laneX(n.lane) : n.sensor ? centre(n.sensor)[0] : 0);

/** The notes of one video with `hand` 'L' or 'R' (null when the colour was not clear). */
function withHands(video) {
    const notes = video.notes.filter((n) => n.colour && n.share >= 0.7);
    let cyan = 0;
    let pink = 0;
    for (const n of notes) {
        if (n.kind === 'slide') continue;
        if (n.colour === 'cyan') cyan += x(n);
        else pink += x(n);
    }
    // the colour with the smaller summed x (more notes on the left) is the left hand
    const leftColour = cyan < pink ? 'cyan' : 'pink';
    return notes.map((n) => ({ ...n, hand: n.colour === leftColour ? 'L' : 'R' }));
}

function analyse(videos) {
    const t = {
        notes: 0,
        byKind: {},
        cross: { all: 0, n: 0 },
        slideSolo: { same: 0, n: 0 },
        handoff: { diff: 0, n: 0 },
        pair: { split: 0, n: 0, leftToLeft: 0 },
        holdSolo: { same: 0, n: 0 },
        alternate: { switch: 0, n: 0 },
        laneL: Array(9).fill(0),
        laneN: Array(9).fill(0),
        perVideo: [],
    };
    for (const v of videos) {
        const notes = withHands(v).sort((a, b) => a.time - b.time);
        const vid = { title: v.song, notes: notes.length, cross: 0, n: 0, handoff: [0, 0] };
        for (const n of notes) {
            t.notes++;
            const k = (t.byKind[
                n.kind === 'break' ? 'tap' : n.kind === 'touchHold' ? 'touch' : n.kind
            ] ||= { L: 0, R: 0 });
            k[n.hand]++;
            const px = x(n);
            if (n.kind !== 'slide' && Math.abs(px) > 0.25) {
                t.cross.n++;
                vid.n++;
                if ((n.hand === 'L' && px > 0) || (n.hand === 'R' && px < 0)) {
                    t.cross.all++;
                    vid.cross++;
                }
            }
            if (n.lane) {
                t.laneN[n.lane]++;
                if (n.hand === 'L') t.laneL[n.lane]++;
            }
        }
        const taps = notes.filter((n) => n.kind === 'tap' || n.kind === 'break');
        // slides: who slides, did the same hand tap the star, and does that hand also tap meanwhile?
        for (const s of notes.filter((n) => n.kind === 'slide')) {
            const star = taps.find(
                (n) => n.lane === s.head && Math.abs(n.time - s.time) < 0.01 && n.star
            );
            if (star) {
                t.handoff.n++;
                vid.handoff[1]++;
                if (star.hand !== s.hand) {
                    t.handoff.diff++;
                    vid.handoff[0]++;
                }
            }
            const during = taps.filter((n) => n.time > s.start && n.time < s.end && n !== star);
            for (const n of during) {
                t.slideSolo.n++;
                if (n.hand === s.hand) t.slideSolo.same++;
            }
        }
        for (const h of notes.filter((n) => n.kind === 'hold')) {
            const end = h.time + 0.01;
            void end;
        }
        // simultaneous notes: split between hands?
        for (let i = 0; i < notes.length - 1; i++) {
            const a = notes[i];
            const b = notes[i + 1];
            if (
                a.kind === 'slide' ||
                b.kind === 'slide' ||
                Math.abs(a.time - b.time) > 0.005 ||
                a === b
            )
                continue;
            t.pair.n++;
            if (a.hand !== b.hand) {
                t.pair.split++;
                const left = x(a) < x(b) ? a : b;
                if (left.hand === 'L') t.pair.leftToLeft++;
            }
        }
        // alternation in a run of taps
        for (let i = 0; i < taps.length - 1; i++) {
            if (taps[i + 1].time - taps[i].time > 0.6 || taps[i + 1].time === taps[i].time)
                continue;
            t.alternate.n++;
            if (taps[i].hand !== taps[i + 1].hand) t.alternate.switch++;
        }
        t.perVideo.push(vid);
    }
    return t;
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');

if (require.main === module) {
    const videos = fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith('.json') && !f.includes('capture'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f))))
        .filter((v) => v.notes);
    const t = analyse(videos);
    console.log(`${videos.length} videos, ${t.notes} notes with a clear hand colour`);
    for (const [k, v] of Object.entries(t.byKind))
        console.log(
            `  ${k}: left ${pct(v.L, v.L + v.R)}, right ${pct(v.R, v.L + v.R)} (${v.L + v.R})`
        );
    console.log(
        `notes played across the middle (hand on the other side's notes, taps and touches beyond 0.25 of the radius): ${pct(t.cross.all, t.cross.n)} of ${t.cross.n}`
    );
    console.log(
        `slide set off by a different hand than the one that tapped its star: ${pct(t.handoff.diff, t.handoff.n)} of ${t.handoff.n}`
    );
    console.log(
        `taps played during a slide by the slide's own hand: ${pct(t.slideSolo.same, t.slideSolo.n)} of ${t.slideSolo.n}`
    );
    console.log(
        `simultaneous notes split between the two hands: ${pct(t.pair.split, t.pair.n)} of ${t.pair.n}; left note to the left hand when split: ${pct(t.pair.leftToLeft, t.pair.split)}`
    );
    console.log(
        `consecutive taps (within 0.6 s) played by different hands: ${pct(t.alternate.switch, t.alternate.n)} of ${t.alternate.n}`
    );
    console.log(
        'share of each lane played by the left hand:',
        t.laneL
            .slice(1)
            .map((v, i) => `${i + 1}:${pct(v, t.laneN[i + 1])}`)
            .join(' ')
    );
    console.log('per video crossing / handoff:');
    for (const v of t.perVideo)
        console.log(
            `  ${v.title.slice(0, 28).padEnd(28)} crossing ${pct(v.cross, v.n)}  star by other hand ${pct(v.handoff[0], v.handoff[1])}`
        );
}

module.exports = { analyse, withHands };
