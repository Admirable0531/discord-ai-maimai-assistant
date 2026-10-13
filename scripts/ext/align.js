// Matches a captured external-output video (capture.js) to its chart and reads, for every tap and break,
// which judgement label appeared on its lane: how much yellow (Critical Perfect), orange (Perfect), red
// (LATE tag), pink, green, blue showed there in the second after the note.
//
//   node scripts/ext/align.js <capture.json> "<song>" <difficulty> <dx|std> <out.json>
const fs = require('fs');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { slideTracks } = require('../../src/chart/slidePaths');

const CLASSES = ['yellow', 'orange', 'red', 'pink', 'green', 'cyan', 'blue', 'white'];
const WINDOW = 0.6; // s after the hit in which the label is on screen

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

/** Per class, the highest pixel count on the lane's label area between `from` and `to`. */
function peak(cap, times, col, from, to) {
    const out = new Array(8).fill(0);
    const a = frameAt(times, from);
    for (let i = a; i < times.length && times[i] <= to; i++) {
        const row = cap.frames[i][1][col];
        for (let k = 0; k < 8; k++) if (row[k] > out[k]) out[k] = row[k];
    }
    return out;
}

/** What is judged, when, and where its label shows: {kind, time, when, key: 'L3' | 'E5' ...}. */
function judged(chart) {
    const out = [];
    for (const e of chart.events) {
        const base = { kind: e.kind, time: Math.round(e.time * 1000) / 1000 };
        if (e.kind === 'tap' || e.kind === 'break')
            out.push({ ...base, when: e.time, key: `L${e.lane}`, lane: e.lane });
        else if (e.kind === 'hold')
            out.push({ ...base, when: e.end, key: `L${e.lane}`, lane: e.lane });
        else if (e.kind === 'touch' || e.kind === 'touchHold') {
            const name = e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`;
            out.push({ ...base, when: e.kind === 'touch' ? e.time : e.end, key: name });
        } else if (e.kind === 'slide') {
            const tracks = slideTracks(e);
            if (!tracks) continue;
            const last = tracks[0][tracks[0].length - 1][0];
            out.push({
                ...base,
                when: e.end,
                key: /^A\d$/.test(last) ? `L${last[1]}` : last,
                head: e.head,
            });
        }
    }
    return out;
}

async function align(capFile, title, difficulty, type, out) {
    const cap = JSON.parse(fs.readFileSync(capFile));
    const found = await getChartText(title, difficulty, type);
    if (!found.success) throw new Error(found.error);
    const chart = buildChart(found.text);
    const times = cap.frames.map((f) => f[0]);
    const all = judged(chart);
    const colOf = (key) => cap.keys.indexOf(key);
    // the video clock minus the chart clock: where the yellow/orange labels follow the taps best
    const taps = all.filter((n) => n.kind === 'tap' || n.kind === 'break');
    let best = [0, -1];
    for (let shift = 0; shift <= 30; shift += 0.025) {
        let sum = 0;
        let n = 0;
        for (const e of taps) {
            const t = e.when + shift;
            if (t > times[times.length - 1] - 1) continue;
            const p = peak(cap, times, colOf(e.key), t, t + WINDOW);
            sum += Math.min(400, p[0] + p[1]);
            n++;
        }
        if (n > 20 && sum / n > best[1]) best = [shift, sum / n];
    }
    const shift = best[0];
    const notes = [];
    for (const e of all) {
        const t = e.when + shift;
        if (t > times[times.length - 1] - 1 || colOf(e.key) < 0) continue;
        const rest = { ...e };
        delete rest.when;
        notes.push({ ...rest, peak: peak(cap, times, colOf(e.key), t - 0.05, t + WINDOW) });
    }
    const result = {
        videoId: cap.videoId,
        title,
        difficulty,
        type,
        shift,
        score: best[1],
        classes: CLASSES,
        notes,
    };
    fs.writeFileSync(out, JSON.stringify(result));
    return result;
}

module.exports = { align, CLASSES, judged };

if (require.main === module) {
    const [capFile, title, difficulty, type, out] = process.argv.slice(2);
    align(capFile, title, difficulty, type || 'dx', out).then((r) => {
        console.log(
            `${r.notes.length} taps, shift ${r.shift.toFixed(3)} s, mean yellow+orange ${r.score.toFixed(1)}`
        );
    });
}
