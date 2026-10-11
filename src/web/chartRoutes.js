const express = require('express');
const logger = require('../utils/logger');
const { getChartText, searchSongs } = require('../chart/simaiWiki');
const { buildChart } = require('../chart/chartModel');
const { analyse } = require('../chart/rules');
const { buildViewerHtml } = require('../chart/viewerPage');
const { maidataLines } = require('../chart/maidata');
const { parseCustomChart, describeParseError } = require('../chart/customChart');

const DIFFICULTIES = ['basic', 'advanced', 'expert', 'master', 'remaster'];
const escapeHtml = (v) =>
    String(v).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

const CHART_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chart viewer</title>
<style>
:root{--bg:#fff;--card:#f4f3ee;--ink:#1a1a19;--mute:#6b6a64;--line:#d8d6cc;--accent:#2f6fe0}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--card:#242422;--ink:#fff;--mute:#a09f97;--line:#3a3a36;--accent:#6aa0ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 system-ui,"Noto Sans CJK JP",sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:4px 0 12px}
.search{position:sticky;top:0;background:var(--bg);padding:8px 0 10px;z-index:2}
input{font:inherit;width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
.hint{color:var(--mute);font-size:13px;margin:6px 2px}
.song{background:var(--card);border-radius:12px;padding:12px 14px;margin-top:10px}
.title{font-weight:650;overflow-wrap:anywhere}.artist{color:var(--mute);font-size:13px;margin-top:2px}
.badge{font-size:11px;font-weight:700;padding:1px 6px;border-radius:5px;background:var(--line);margin-left:6px;vertical-align:middle}
.diffs{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.diffs a{text-decoration:none;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:14px;background:var(--bg)}
.diffs a:active{border-color:var(--accent)}
.d-expert{border-left:4px solid #e44}.d-master{border-left:4px solid #a455e6}.d-remaster{border-left:4px solid #ddd}.d-basic{border-left:4px solid #3c3}.d-advanced{border-left:4px solid #fa0}
.empty{color:var(--mute);margin:24px 4px}
.song summary{cursor:pointer}
.recent h2{font-size:14px;color:var(--mute);margin:18px 2px 0;font-weight:600}
</style></head><body><div class="wrap">
<h1>Chart viewer</h1>
<div class="search"><input id="q" type="search" placeholder="Search a song or artist (accents and symbols are optional)" autocomplete="off" autofocus>
<div class="hint" id="hint">Type a few letters, for example <b>rond</b> finds RONDØ.</div></div>
<div id="out"></div>
<details class="song" id="custom"><summary class="title">Use your own chart</summary>
<div class="hint">Paste simai text or a whole maidata.txt, or choose the file. It is only read for this view and not saved.</div>
<input id="ctitle" type="text" placeholder="Title (optional)" style="margin-top:8px">
<textarea id="ctext" rows="7" placeholder="(120){4}1,2,3,4,E" style="width:100%;margin-top:8px;font:13px ui-monospace,monospace;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)"></textarea>
<div class="diffs"><input id="cfile" type="file" accept=".txt,.simai,text/plain" style="width:auto;padding:6px">
<select id="cdiff" style="font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)"><option value="auto">If a maidata file: hardest chart</option><option value="basic">Basic</option><option value="advanced">Advanced</option><option value="expert">Expert</option><option value="master">Master</option><option value="remaster">Re:Master</option></select>
<a href="#" id="copen" style="font-weight:650">Open chart</a></div>
<div class="hint" id="cmsg" style="color:#b3261e"></div></details>
<div class="recent" id="recent"></div>
</div>
<script>
const out=document.getElementById('out'),q=document.getElementById('q'),hint=document.getElementById('hint');
const LV={basic:'Basic',advanced:'Advanced',expert:'Expert',master:'Master',remaster:'Re:Master'};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
function link(s,d){return '/chart?song='+encodeURIComponent(s.title)+'&difficulty='+d+'&type='+s.type}
function render(list){
  if(!list.length){out.innerHTML='<div class="empty">No song matches. The simai wiki only has charts for some songs.</div>';return}
  out.innerHTML=list.map(s=>'<div class="song"><div class="title">'+esc(s.title)+'<span class="badge">'+(s.type==='std'?'STD':'DX')+'</span></div><div class="artist">'+esc(s.artist)+'</div><div class="diffs">'+
   (s.difficulties.length?s.difficulties.map(d=>'<a class="d-'+d+'" href="'+link(s,d)+'" data-s="'+esc(s.title)+'">'+LV[d]+(s.levels[d]?' '+esc(s.levels[d]):'')+'</a>').join(''):'<span class="artist">No chart on the wiki yet</span>')+'</div></div>').join('');
}
let timer=0,seq=0;
function search(){
  const v=q.value.trim();
  if(!v){out.innerHTML='';hint.textContent='Type a few letters, for example rond finds RONDØ.';return}
  const my=++seq;
  fetch('/chart/search?q='+encodeURIComponent(v)).then(r=>r.json()).then(r=>{if(my!==seq)return;hint.textContent=r.songs.length+(r.songs.length===1?' song':' songs');render(r.songs)}).catch(()=>{hint.textContent='Search failed; try again.'});
}
document.getElementById('cfile').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{document.getElementById('ctext').value=String(r.result);if(!document.getElementById('ctitle').value)document.getElementById('ctitle').value=f.name.replace(/\\.[^.]+$/,'')};r.readAsText(f)});
document.getElementById('copen').addEventListener('click',async e=>{e.preventDefault();const msg=document.getElementById('cmsg');msg.textContent='';
 try{const res=await fetch('/chart/custom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:document.getElementById('ctext').value,title:document.getElementById('ctitle').value,difficulty:document.getElementById('cdiff').value})});
  const body=await res.text();if(!res.ok){try{msg.textContent=JSON.parse(body).error}catch{msg.textContent='Could not open that chart.'}return}
  document.open();document.write(body);document.close()}catch{msg.textContent='Could not reach the server.'}});
q.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(search,120)});
out.addEventListener('click',e=>{const a=e.target.closest('a');if(!a)return;try{const r=JSON.parse(localStorage.getItem('chartRecent')||'[]').filter(x=>x.u!==a.getAttribute('href'));r.unshift({u:a.getAttribute('href'),t:a.dataset.s+' · '+a.textContent});localStorage.setItem('chartRecent',JSON.stringify(r.slice(0,8)))}catch{}});
try{const r=JSON.parse(localStorage.getItem('chartRecent')||'[]');if(r.length)document.getElementById('recent').innerHTML='<h2>Recently opened</h2>'+r.map(x=>'<div class="song"><a style="color:inherit;text-decoration:none" href="'+esc(x.u)+'">'+esc(x.t)+'</a></div>').join('')}catch{}
</script></body></html>`;

function chartMessage(message) {
    return CHART_HOME.replace(
        '<div id="out"></div>',
        `<div id="out"><div class="empty">${escapeHtml(message)}</div></div>`
    );
}

/** At most `max` requests a minute per visitor. Behind a tunnel the visitor is the forwarded address. */
function rateLimit(max) {
    const hits = new Map();
    setInterval(() => hits.clear(), 60_000).unref();
    return (req, res, next) => {
        const ip = String(req.headers['cf-connecting-ip'] || req.ip || 'unknown');
        const n = (hits.get(ip) || 0) + 1;
        hits.set(ip, n);
        if (n > max)
            return res
                .status(429)
                .json({ error: 'Too many requests. Wait a minute and try again.' });
        next();
    };
}

/**
 * The chart pages. `publicMode` is for a copy that is open to the internet:
 * rate limits, no search-engine indexing, and no chart text from the wiki
 * (only a chart the visitor pasted themselves shows its own text).
 */
function registerChartRoutes(app, { publicMode = false } = {}) {
    const limit = (max) => (publicMode ? rateLimit(max) : (req, res, next) => next());
    if (publicMode) {
        app.use((req, res, next) => {
            res.set({
                'X-Content-Type-Options': 'nosniff',
                'X-Robots-Tag': 'noindex, nofollow',
                'Referrer-Policy': 'no-referrer',
            });
            next();
        });
        app.get('/', (req, res) => res.redirect('/chart'));
    }

    // Song search for the chart page: /chart/search?q=rond
    app.get('/chart/search', limit(90), async (req, res) => {
        try {
            const songs = await searchSongs(String(req.query.q || '').slice(0, 80), { limit: 40 });
            res.json({
                songs: songs.map((x) => ({
                    title: x.title,
                    artist: x.artist,
                    type: x.type,
                    difficulties: x.difficulties,
                    levels: x.levels,
                })),
            });
        } catch (err) {
            logger.error('web', 'GET /chart/search failed', err);
            res.status(500).json({ songs: [], error: 'Search failed.' });
        }
    });

    // A chart the visitor supplies: POST {text, title, difficulty}; the page comes back as the reply.
    app.post('/chart/custom', limit(12), express.json({ limit: '400kb' }), (req, res) => {
        const parsed = parseCustomChart(req.body?.text, {
            difficulty: DIFFICULTIES.includes(req.body?.difficulty) ? req.body.difficulty : 'auto',
        });
        if (!parsed.success) return res.status(400).json({ error: parsed.error });
        try {
            const chart = buildChart(parsed.text);
            if (chart.events.length === 0) {
                return res.status(400).json({ error: 'No notes were found in that chart.' });
            }
            const title =
                String(req.body?.title || '')
                    .trim()
                    .slice(0, 80) ||
                parsed.title ||
                'Custom chart';
            res.type('html').send(
                buildViewerHtml({
                    title,
                    difficulty: parsed.label,
                    events: chart.events,
                    finish: chart.finish,
                    findings: analyse(chart),
                    tempoChanges: chart.tempoChanges,
                    maidata: maidataLines(parsed.text), // the visitor's own text, back to them
                    backUrl: '/chart',
                })
            );
        } catch (err) {
            res.status(400).json({ error: describeParseError(err) });
        }
    });

    // Chart viewer: /chart?song=Titania&difficulty=master&type=dx
    app.get('/chart', limit(30), async (req, res) => {
        const song = String(req.query.song || '')
            .trim()
            .slice(0, 120);
        const difficulty = DIFFICULTIES.includes(req.query.difficulty)
            ? req.query.difficulty
            : 'master';
        const type = req.query.type === 'std' ? 'std' : 'dx';
        if (!song) return res.type('html').send(CHART_HOME);
        try {
            const found = await getChartText(song, difficulty, type);
            if (!found.success) {
                const hint = found.available?.length
                    ? ` Charts the wiki has: ${found.available.join(', ')}.`
                    : '';
                return res
                    .status(404)
                    .type('html')
                    .send(chartMessage(found.error + hint));
            }
            const chart = buildChart(found.text);
            res.type('html').send(
                buildViewerHtml({
                    title: found.title,
                    difficulty,
                    events: chart.events,
                    finish: chart.finish,
                    findings: analyse(chart),
                    tempoChanges: chart.tempoChanges,
                    maidata: publicMode ? null : maidataLines(found.text),
                    backUrl: '/chart',
                })
            );
        } catch (err) {
            logger.error('web', 'GET /chart failed', err);
            res.status(500)
                .type('html')
                .send(chartMessage(`Could not build that chart (${err.message}).`));
        }
    });
}

/** A separate, chart-only server that is safe to put on the internet (nothing else is served). */
function startChartServer(port) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', false);
    registerChartRoutes(app, { publicMode: true });
    return app.listen(port, () => {
        logger.info('web', `Chart server (public-safe) listening on port ${port}`);
    });
}

module.exports = { registerChartRoutes, startChartServer };
