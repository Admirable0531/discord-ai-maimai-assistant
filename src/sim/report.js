// Runs the simulation for several styles and turns the per-note outcomes into
// "spots": a moment, how likely a splash is in each style, and what causes it.
const { STYLES, DEFAULT_STYLE_IDS } = require('./styles');
const { monteCarlo, simulate } = require('./run');

const SPLASH = ['foreign', 'blocked', 'early'];
const round = (x) => Math.round(x * 100) / 100;

/** A note as a player says it. */
function describe(e) {
    if (!e) return 'a note';
    if (e.kind === 'slide') return `the slide from ${e.head}`;
    if (e.sensor)
        return `the ${e.sensor === 'C' ? 'C' : e.sensor + e.number} touch${e.kind === 'touchHold' ? ' hold' : ''}`;
    if (e.kind === 'break') return `the break on button ${e.lane}`;
    if (e.kind === 'hold') return `the hold on button ${e.lane}`;
    return `the ${e.star ? 'star' : 'tap'} on button ${e.lane}`;
}

const WHY = {
    foreign: (note, cause) =>
        `${cause} reaches the sensor of ${note} before its time, so ${note} is hit early (an early Great or Good).`,
    blocked: (note, cause) =>
        `${cause} is still pressing the sensor of ${note}, so the press for ${note} makes no new touch and it is missed or late.`,
    early: (note) => `${note} is finished far too early by another hand's contact.`,
};

/**
 * Plays the chart in each style and returns
 *   {styles: [{id, label, runs, unreachable: n}], spots: [...]}.
 * A spot: {id, t, bar, note, p (worst style), perStyle: {styleId: {p, kind, cause}}, text}.
 */
function simulateSpots(
    events,
    { styleIds = DEFAULT_STYLE_IDS, runs = 24, seed = 1, minP = 0.2, styles = STYLES } = {}
) {
    const bySpot = new Map();
    const info = [];
    for (const sid of styleIds) {
        const style = styles[sid];
        const mc = monteCarlo(events, style, runs, seed);
        let unreachable = 0;
        for (const [id, s] of mc.stats) {
            if ((mc.late.get(id) || 0) >= runs / 2) {
                unreachable++;
                continue;
            }
            const n = s.n || 1;
            let p = 0;
            let top = null;
            for (const kind of SPLASH) {
                const k = (s.kinds[kind] || 0) / n;
                p += k;
                if (!top || k > top.k) top = { kind, k };
            }
            if (p < minP) continue;
            let cause = null;
            if (s.causes.size) cause = [...s.causes.entries()].sort((a, b) => b[1] - a[1])[0][0];
            if (!bySpot.has(id)) bySpot.set(id, { id, perStyle: {} });
            bySpot.get(id).perStyle[sid] = { p: round(p), kind: top.kind, cause };
        }
        info.push({ id: sid, label: style.label, about: style.about, runs, unreachable });
    }
    const spots = [];
    for (const s of bySpot.values()) {
        const e = events[s.id];
        const worst = Object.entries(s.perStyle).sort((a, b) => b[1].p - a[1].p)[0];
        const note = describe(e);
        const cause =
            worst[1].cause !== null
                ? `${describe(events[worst[1].cause])} (at ${events[worst[1].cause].time.toFixed(1)} s)`
                : 'another hand';
        const styleLabel = (id) => (styles[id] ? styles[id].label : id);
        const list = Object.entries(s.perStyle)
            .sort((a, b) => b[1].p - a[1].p)
            .map(([id, v]) => `${styleLabel(id)} ${Math.round(v.p * 100)}%`)
            .join(', ');
        spots.push({
            id: s.id,
            t: e.time,
            bar: e.bar,
            note,
            p: worst[1].p,
            perStyle: s.perStyle,
            text: `${WHY[worst[1].kind](note, cause)} Chance by style: ${list}.`,
        });
    }
    spots.sort((a, b) => a.t - b.t);
    // one representative run per style (the seed-1 error) for the replay
    const replay = {};
    for (const sid of styleIds)
        replay[sid] = simulate(events, styles[sid], seed, { record: true }).replay;
    return { styles: info, spots, replay };
}

/**
 * Which rule findings does the simulation back up? {rule: {total, confirmed, chance}}:
 * `confirmed` counts findings with a simulated splash within `window` seconds,
 * `chance` the same count with every finding moved 3.7 s later (what luck alone
 * would give, since simulated splashes are fairly common).
 */
function agreement(findings, spots, window = 0.35) {
    const out = {};
    const near = (t) => spots.some((s) => Math.abs(s.t - t) <= window);
    for (const f of findings) {
        if (/^B|^A14$/.test(f.rule)) continue;
        const r = (out[f.rule] ||= { total: 0, confirmed: 0, chance: 0 });
        r.total++;
        if (near(f.time)) r.confirmed++;
        if (near(f.time + 3.7)) r.chance++;
    }
    return out;
}

module.exports = { simulateSpots, agreement, describe };
