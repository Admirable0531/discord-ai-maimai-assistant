// Reads every video of the L. R. Breakdown playlist: finds the song and difficulty from the
// title, plays the video (capture.js), matches it to the chart (align.js) and keeps only the
// small result in data/lr/<videoId>.json. Already finished videos are skipped.
//
//   node scripts/lr/run.js [playlistId] [rate]       (run in the bot container: it needs Chromium)
//
// The videos are other people's work: they are only watched, nothing from them is stored but
// which colour each chart note had.
const fs = require('fs');
const path = require('path');
const { capture } = require('./capture');
const { align } = require('./align');
const { searchSongs, fold, getChartText } = require('../../src/chart/simaiWiki');

const OUT = process.env.LR_OUT || path.join(__dirname, '..', '..', 'data', 'lr');
const DIFFS = { MASTER: 'master', 'Re:MASTER': 'remaster', EXPERT: 'expert' };

async function playlist(id) {
    const res = await fetch(`https://www.youtube.com/playlist?list=${id}&hl=en`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' },
    });
    const html = await res.text();
    const data = JSON.parse(/var ytInitialData = (\{.*?\});<\/script>/s.exec(html)[1]);
    const out = [];
    const walk = (o) => {
        if (Array.isArray(o)) return o.forEach(walk);
        if (!o || typeof o !== 'object') return;
        if (o.lockupViewModel) {
            const v = o.lockupViewModel;
            const title = v.metadata?.lockupMetadataViewModel?.title?.content;
            if (v.contentId && title) out.push({ id: v.contentId, title });
        }
        Object.values(o).forEach(walk);
    };
    walk(data);
    return out;
}

/** {song, difficulty, type, scale} from a video title like "有明/Ariake (MASTER) L. R. Breakdown". */
async function identify(title) {
    const m = /^(.*?)\s*\((MASTER|Re:MASTER|EXPERT)\)/.exec(title);
    if (!m) return null;
    const difficulty = DIFFS[m[2]];
    let hits = await searchSongs(m[1], { limit: 8 });
    // "系ぎて (Tsunagite)": try the part before a trailing bracket too
    const plain = m[1].replace(/\s*\([^)]*\)\s*$/, '');
    if (!hits.some((s) => s.levels[difficulty]) && plain !== m[1])
        hits = await searchSongs(plain, { limit: 8 });
    const exact = hits.filter((s) => s.key === fold(m[1]));
    const pick = (exact.length ? exact : hits).find((s) => s.levels[difficulty]);
    if (!pick) return null;
    return {
        song: pick.title,
        difficulty,
        type: pick.type,
        scale: /0\.75x/i.test(title) ? 0.75 : 1,
    };
}

async function main() {
    const listId = process.argv[2] || 'PLPm8jAOlVai5BkIPvWZ5v7WfhY2PCXPeJ';
    const rate = Number(process.argv[3]) || 1;
    fs.mkdirSync(OUT, { recursive: true });
    const videos = await playlist(listId);
    console.log(`${videos.length} videos`);
    for (const v of videos) {
        const file = path.join(OUT, `${v.id}.json`);
        if (fs.existsSync(file)) continue;
        const what = await identify(v.title);
        if (!what) {
            console.log(`skip ${v.id} ${v.title}: song not found`);
            continue;
        }
        // the chart first: a video is only worth playing when its chart can be read
        const chartOk = await getChartText(what.song, what.difficulty, what.type).catch((e) => ({
            success: false,
            error: e.message,
        }));
        if (!chartOk.success) {
            console.log(`skip ${v.id} ${v.title}: ${chartOk.error}`);
            continue;
        }
        const tmp = path.join(OUT, `${v.id}.capture.json`);
        try {
            console.log(`capture ${v.id} ${v.title}`);
            await capture(v.id, tmp, rate);
            const r = await align(tmp, what.song, what.difficulty, what.type, file, what.scale);
            fs.writeFileSync(
                file,
                JSON.stringify({ ...r, videoTitle: v.title, song: what.song, type: what.type })
            );
            console.log(`  ${r.notes.length} notes`);
        } catch (e) {
            console.log(`  failed: ${e.message.split('\n')[0]}`);
        } finally {
            fs.rmSync(tmp, { force: true });
        }
    }
    console.log('done');
}

if (require.main === module) main();

module.exports = { playlist, identify };
