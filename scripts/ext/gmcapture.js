// Second label capture with the GOOD (green) and MISS (grey) colours added: node scripts/ext/gmcapture.js <list.json>
// Writes data/ext_goodmiss/<id>.lab.json for every video of the list that is not there yet.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', '..', 'data', 'ext_goodmiss');
const RING = '301.5,269.5,240.5'; // Blanc's layout: game screen left, hand camera right
fs.mkdirSync(OUT, { recursive: true });
for (const v of JSON.parse(fs.readFileSync(process.argv[2]))) {
    const out = path.join(OUT, `${v.id}.lab.json`);
    if (fs.existsSync(out)) continue;
    try {
        execFileSync('node', [path.join(__dirname, 'labels.js'), v.id, out, '1'], {
            stdio: 'inherit',
            env: { ...process.env, RING },
        });
        console.log('done', v.id);
    } catch (e) {
        console.log('failed', v.id, String(e.message).split('\n')[0]);
    }
}
