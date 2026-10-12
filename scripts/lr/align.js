// Matches a captured L. R. Breakdown video to its chart and reads off which hand colour
// each note has.
//
//   node scripts/lr/align.js <capture.json> "<song title>" <difficulty> <dx|std> <out.json>
//
// The video's notes are drawn by MajdataView and coloured by hand (cyan one hand,
// pink the other). For every tap, break and hold head the colours seen along its lane
// at the moments it passes are added up; touches use the colour on their sensor.
// Which colour is the left hand is decided later, from which side of the screen each
// colour mostly plays (summary.js).
const fs = require('fs');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');

const RADII = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

function frameAt(times, t) {
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (times[m] < t) lo = m + 1;
        else hi = m;
    }
    return lo;
}

/** The video-minus-chart time at which colour along lane positions best matches the taps, per radius. */
function findShifts(cap, taps, keyIndex, times, scale) {
    const tmax = times[times.length - 1];
    const shifts = {};
    for (const rho of RADII.concat([1])) {
        let best = [0, -1];
        for (let shift = 0; shift <= 14; shift += 0.025) {
            let sum = 0;
            let n = 0;
            for (const e of taps) {
                const t = e.time / scale + shift;
                if (t < 2 || t > tmax - 0.5) continue;
                const row = cap.frames[frameAt(times, t)][1][keyIndex[`L${e.lane}@${rho}`]];
                sum += row[0] + row[1];
                n++;
            }
            if (n > 20 && sum / n > best[1]) best = [shift, sum / n];
        }
        shifts[rho] = best[0];
    }
    return shifts;
}

async function align(capFile, title, difficulty, type, out, scale = 1) {
    const cap = JSON.parse(fs.readFileSync(capFile));
    const found = await getChartText(title, difficulty, type);
    if (!found.success) throw new Error(found.error);
    const chart = buildChart(found.text);
    const times = cap.frames.map((f) => f[0]);
    const keyIndex = Object.fromEntries(cap.keys.map((k, i) => [k, i]));
    const tmax = times[times.length - 1];
    const heads = chart.events.filter(
        (e) => e.kind === 'tap' || e.kind === 'break' || e.kind === 'hold'
    );
    const shifts = findShifts(
        cap,
        heads.filter((e) => e.time / scale < tmax - 12),
        keyIndex,
        times,
        scale
    );
    const notes = [];
    for (const e of chart.events) {
        if (e.kind !== 'tap' && e.kind !== 'break' && e.kind !== 'hold') continue;
        let pink = 0;
        let cyan = 0;
        let seen = 0;
        for (const rho of RADII) {
            const t = e.time / scale + shifts[rho];
            if (t > tmax) continue;
            seen++;
            const i = frameAt(times, t);
            for (let k = Math.max(0, i - 1); k <= Math.min(times.length - 1, i + 1); k++) {
                const row = cap.frames[k][1][keyIndex[`L${e.lane}@${rho}`]];
                cyan += row[0];
                pink += row[1];
            }
        }
        if (!seen) continue;
        const total = cyan + pink;
        notes.push({
            kind: e.kind,
            time: Math.round(e.time * 1000) / 1000,
            lane: e.lane,
            star: !!e.star,
            colour: total < 20 ? null : cyan > pink ? 'cyan' : 'pink',
            share: total ? Math.round((Math.max(cyan, pink) / total) * 100) / 100 : 0,
            cyan,
            pink,
        });
    }
    // touches: the colour on the sensor around the moment it is hit
    const colourOf = (pink, cyan) => {
        const total = pink + cyan;
        return {
            colour: total < 20 ? null : cyan > pink ? 'cyan' : 'pink',
            share: total ? Math.round((Math.max(cyan, pink) / total) * 100) / 100 : 0,
        };
    };
    const base = shifts[1];
    const window = (from, to) => {
        const a = frameAt(times, from);
        const b = frameAt(times, to);
        return [a, Math.max(a, b)];
    };
    for (const e of chart.events) {
        if (e.kind === 'touch' || e.kind === 'touchHold') {
            const name = e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`;
            const [a, b] = window(e.time / scale + base - 0.3, e.time / scale + base);
            let pink = 0;
            let cyan = 0;
            for (let k = a; k <= b && k < times.length; k++) {
                const row = cap.frames[k][1][keyIndex[name]];
                pink = Math.max(pink, row[1]);
                cyan = Math.max(cyan, row[0]);
            }
            if (e.time / scale + base > tmax) continue;
            notes.push({
                kind: e.kind,
                time: Math.round(e.time * 1000) / 1000,
                sensor: name,
                ...colourOf(pink, cyan),
                cyan,
                pink,
            });
        } else if (e.kind === 'slide') {
            // the slide's arrows are on its path before the star sets off
            const { slideTracks } = require('../../src/chart/slidePaths');
            const tracks = slideTracks(e);
            if (!tracks) continue;
            const [a, b] = window(e.time / scale + base - 0.25, e.start / scale + base - 0.05);
            if (e.start / scale + base > tmax) continue;
            let pink = 0;
            let cyan = 0;
            for (const step of tracks[0].slice(1, -1)) {
                for (const name of step) {
                    for (let k = a; k <= b && k < times.length; k += 2) {
                        const row = cap.frames[k][1][keyIndex[name]];
                        pink += row[1];
                        cyan += row[0];
                    }
                    break;
                }
            }
            notes.push({
                kind: 'slide',
                time: Math.round(e.time * 1000) / 1000,
                start: Math.round(e.start * 1000) / 1000,
                end: Math.round(e.end * 1000) / 1000,
                head: e.head,
                ...colourOf(pink, cyan),
                cyan,
                pink,
            });
        }
    }
    notes.sort((x, y) => x.time - y.time);
    const result = { videoId: cap.videoId, title, difficulty, scale, shifts, notes };
    fs.writeFileSync(out, JSON.stringify(result));
    return result;
}

module.exports = { align };

if (require.main === module) {
    const [capFile, title, difficulty, type, out, scale] = process.argv.slice(2);
    align(capFile, title, difficulty, type || 'dx', out, scale ? Number(scale) : 1).then((r) => {
        const known = r.notes.filter((n) => n.colour);
        console.log(
            `${r.notes.length} notes, ${known.length} with a colour; sure (one colour over 80%): ${known.filter((n) => n.share >= 0.8).length}`
        );
        console.log('shifts', JSON.stringify(r.shifts));
    });
}
