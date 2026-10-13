// Reads a list of external-output videos: label capture, alignment, GREAT events. Skips what is already done.
//
//   node scripts/ext/run.js <list.json>      list: [{id, title}] with titles like "【maimaiDX Splash 外部出力】Song / MASTER SSS"
//   (needs Chromium: run in a container)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getChartText } = require('../../src/chart/simaiWiki');
const { buildChart } = require('../../src/chart/chartModel');
const { judged } = require('./align');
const { events, shiftFromLabels, applyRing } = require('./events');

const DIR = path.join(__dirname, '..', '..', 'data', 'ext');

// Blanc's videos: the game screen on the left, a hand camera on the right ("[Maimai] Song SS+ [Master 14]")
const BLANC_RING = '301.5,269.5,240.5';

function parse(title) {
    const b =
        /^\[Maimai[^\]]*\]\s*(.+?)\s+(?:初\s*)?(SSS\+|SSS|SS\+|SS|S\+|S|AP\+?)(?:\s+FC\+?)?\s+\[\s*(Master|Re:\s?Master|Expert)\s*([\d+]*)\s*\]/i.exec(
            title
        );
    if (b) {
        let song = b[1].trim();
        let types = ['dx', 'std'];
        const tag = /\s*\[(ST|DX)\]\s*$/i.exec(song);
        if (tag) {
            song = song.slice(0, tag.index).trim();
            types = [tag[1].toUpperCase() === 'ST' ? 'std' : 'dx'];
        }
        const d = b[3].toLowerCase().replace(/\s/g, '');
        return {
            song,
            difficulty: d === 'master' ? 'master' : d === 'expert' ? 'expert' : 'remaster',
            types,
            rank: b[2].toUpperCase(),
            level: b[4],
            ring: BLANC_RING,
        };
    }
    const m = /】\s*(.+?)\s*\/\s*(Re:MASTER|MASTER)/.exec(title);
    if (!m) return null;
    return {
        song: m[1],
        difficulty: m[2] === 'MASTER' ? 'master' : 'remaster',
        types: /スタンダード/.test(title) ? ['std'] : ['dx', 'std'],
        rank: 'SSS',
    };
}

async function one(v) {
    const p = parse(v.title);
    if (!p) return `${v.id}: cannot read the title`;
    let chartText = null;
    let type = null;
    for (const t of p.types) {
        const r = await getChartText(p.song, p.difficulty, t);
        if (r.success) {
            chartText = r.text;
            type = t;
            break;
        }
    }
    if (!chartText) return `${v.id} ${p.song}: no chart on the wiki`;
    const lab = path.join(DIR, `${v.id}.lab.json`);
    if (!fs.existsSync(lab))
        execFileSync('node', [path.join(__dirname, 'labels.js'), v.id, lab, '1'], {
            stdio: 'inherit',
            env: { ...process.env, RING: p.ring || '' },
        });
    const cap = JSON.parse(fs.readFileSync(lab));
    applyRing(cap, p.ring);
    const { shift, score, contrast } = shiftFromLabels(cap, judged(buildChart(chartText)));
    const list = await events(v.id, p.song, p.difficulty, type, shift, p.ring);
    fs.writeFileSync(path.join(DIR, `${v.id}.great.json`), JSON.stringify(list, null, 1));
    fs.writeFileSync(
        path.join(DIR, `${v.id}.meta.json`),
        JSON.stringify({ ...v, ...p, type, shift, score, contrast })
    );
    return `${v.id} ${p.song} ${p.difficulty}: shift ${shift.toFixed(2)} (label ${score.toFixed(0)}, contrast ${contrast.toFixed(1)}), ${list.length} greats`;
}

if (require.main === module) {
    fs.mkdirSync(DIR, { recursive: true });
    const list = JSON.parse(fs.readFileSync(process.argv[2]));
    (async () => {
        for (const v of list) {
            try {
                console.log(await one(v));
            } catch (e) {
                console.log(`${v.id}: failed (${String(e.message).split('\n')[0]})`);
            }
        }
    })();
}
