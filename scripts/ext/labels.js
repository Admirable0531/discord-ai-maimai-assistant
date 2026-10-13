// eslint-env browser
// Plays an "external output" video (the game's own screen) in a headless browser and records, for every
// video frame, how many pixels of each hue sit where a judgement label appears (8 lanes, 33 touch sensors).
//
//   node scripts/lr/capture.js <videoId> <out.json> [playbackRate]
//
// Needs playwright and a Chromium (run it inside the bot container: docker exec).
const { chromium } = require('playwright');
const fs = require('fs');

const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';

/** One stretch of a video, from `from` to `to` seconds, in a fresh page (the player resets itself after about 40 s). */
async function captureSegment(videoId, rate, from, to) {
    const browser = await chromium.launch({
        executablePath: CHROME,
        args: [
            '--no-sandbox',
            '--autoplay-policy=no-user-gesture-required',
            '--mute-audio',
            '--disable-dev-shm-usage',
        ],
    });
    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        locale: 'en-US',
    });
    const page = await ctx.newPage();
    if (process.env.LR_DEBUG) page.on('console', (m) => console.log('[page]', m.text()));
    // starting a page at an offset (&t=) is the only way to play later parts: a seek past what is
    // buffered never loads, and playback resets itself after about 45 s
    await page.goto(
        `https://www.youtube.com/watch?v=${videoId}${from > 0 ? `&t=${Math.floor(from)}s` : ''}`,
        {
            waitUntil: 'domcontentloaded',
        }
    );
    // hold the video still while the page settles, so the first seconds are not played unseen
    await page.waitForSelector('video', { timeout: 20000 });
    await page.evaluate(() => document.querySelector('video').pause());
    await page.waitForTimeout(3000);
    for (const sel of ['button:has-text("Accept all")', 'button:has-text("Reject all")']) {
        try {
            await page.click(sel, { timeout: 1000 });
        } catch {
            // no consent dialog
        }
    }
    await page.evaluate(() => {
        const pl = document.querySelector('#movie_player');
        try {
            pl.setPlaybackQualityRange('hd1080', 'hd1080');
        } catch {
            // the default quality will do
        }
    });
    await page.waitForTimeout(2500);
    const positions = [];
    const result = await page.evaluate(
        async ({ rate, from, to }) => {
            const v = document.querySelector('video');
            v.muted = true;
            v.playbackRate = rate;
            if (from === 0) v.currentTime = 0;
            await new Promise((r) => setTimeout(r, 1500));
            const W = 960;
            const H = Math.round((W * v.videoHeight) / v.videoWidth);
            const cv = document.createElement('canvas');
            cv.width = W;
            cv.height = H;
            const g = cv.getContext('2d', { willReadFrequently: true });
            // find the judgement ring: the radius, from the middle of the frame, where most pure white pixels are
            g.drawImage(v, 0, 0, W, H);
            const cx = W / 2;
            const cy = H / 2;
            const hist = new Float32Array(Math.ceil(H));
            const img = g.getImageData(0, 0, W, H).data;
            for (let y = 0; y < H; y++) {
                for (let x = Math.floor(W * 0.2); x < W * 0.7; x++) {
                    const i = (y * W + x) * 4;
                    if (img[i] > 200 && img[i + 1] > 200 && img[i + 2] > 200) {
                        const r = Math.round(Math.hypot(x - cx, y - cy));
                        if (r < hist.length) hist[r]++;
                    }
                }
            }
            let R = Math.round(H * 0.4465);
            for (let r = Math.floor(H * 0.41); r < H * 0.48; r++) if (hist[r] > hist[R]) R = r;
            const frames = [];
            // judgement label colours: 0 yellow (Critical Perfect), 1 orange (Perfect), 2 red, 3 pink/magenta,
            // 4 green, 5 cyan, 6 blue, 7 white, 8 grey-violet
            // label colours: 0 yellow (Critical Perfect), 1 orange (Perfect), 2 salmon pink (Great text)
            const classify = (r, gg, b) => {
                if (r > 220 && gg > 190 && b < 100) return 0;
                if (r > 220 && gg > 105 && gg <= 190 && b < 90) return 1;
                if (r >= 224 && gg >= 96 && gg <= 124 && b >= 144 && b <= 176) return 2;
                return -1;
            };
            const CELL = 24;
            await new Promise((resolve) => {
                let lastFrame = Date.now();
                // the player sometimes resets itself and the frames stop: give up on this stretch
                const watchdog = setInterval(() => {
                    if (Date.now() - lastFrame > 7000) {
                        clearInterval(watchdog);
                        resolve();
                    }
                }, 1000);
                const step = (now, meta) => {
                    lastFrame = Date.now();
                    g.drawImage(v, 0, 0, W, H);
                    const row = [];
                    const d = g.getImageData(0, 0, W, H).data;
                    const cells = new Map();
                    for (let y = 0; y < H; y += 2) {
                        for (let x = 0; x < W; x += 2) {
                            const i = (y * W + x) * 4;
                            const k = classify(d[i], d[i + 1], d[i + 2]);
                            if (k < 0) continue;
                            const key = ((y / CELL) | 0) * 100 + ((x / CELL) | 0);
                            let c = cells.get(key);
                            if (!c) cells.set(key, (c = [0, 0, 0]));
                            c[k]++;
                        }
                    }
                    for (const [key, c] of cells)
                        if (c[0] + c[1] + c[2] >= 3) row.push([key, ...c]);
                    frames.push([Math.round(meta.mediaTime * 1000) / 1000, row]);
                    if (frames.length % 300 === 0)
                        console.log('frames', frames.length, 'at', meta.mediaTime);
                    if (v.ended || meta.mediaTime > to) {
                        clearInterval(watchdog);
                        resolve();
                    } else v.requestVideoFrameCallback(step);
                };
                v.addEventListener('ended', () => resolve(), { once: true });
                v.requestVideoFrameCallback(step);
                v.play();
            });
            return { R, W, H, CELL, cx, cy, frames, duration: v.duration };
        },
        { rate, from, to }
    );
    await browser.close();
    return result;
}

const SEGMENT = 38; // seconds of video per page

async function capture(videoId, out, rate = 1, maxSeconds = Infinity) {
    let all = null;
    let from = 0;
    let stalls = 0;
    for (;;) {
        const to = Math.min(from + SEGMENT + 1, maxSeconds);
        let seg = null;
        for (let attempt = 0; attempt < 3 && !seg; attempt++) {
            try {
                seg = await captureSegment(videoId, rate, from, to);
            } catch (e) {
                console.log(`  segment ${from}s failed (${e.message.split('\n')[0]}), retrying`);
            }
        }
        if (!seg) throw new Error(`could not read ${videoId} at ${from}s`);
        if (!all) all = { ...seg, frames: [] };
        const last = all.frames.length ? all.frames[all.frames.length - 1][0] : -1;
        const fresh = seg.frames.filter((f) => f[0] > last);
        all.frames.push(...fresh);
        all.duration = seg.duration;
        const reached = all.frames.length ? all.frames[all.frames.length - 1][0] : from;
        if (reached >= Math.min(seg.duration, maxSeconds) - 0.5) break;
        // carry on from where the frames stopped (a stalled stretch restarts there)
        stalls = fresh.length ? 0 : stalls + 1;
        if (stalls >= 3) throw new Error(`stuck at ${reached.toFixed(0)}s of ${videoId}`);
        from = fresh.length ? Math.max(0, reached - 9) : from;
    }
    fs.writeFileSync(out, JSON.stringify({ videoId, ...all }));
    return all;
}

module.exports = { capture };

if (require.main === module) {
    const [id, out, rate, max] = process.argv.slice(2);
    capture(id, out, Number(rate) || 1, max ? Number(max) : Infinity)
        .then((r) =>
            console.log(`${id}: ${r.frames.length} frames, ring radius ${r.R}px of ${r.W}x${r.H}`)
        )
        .catch((e) => {
            console.error(e);
            process.exit(1);
        });
}
