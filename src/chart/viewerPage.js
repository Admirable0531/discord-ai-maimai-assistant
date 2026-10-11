// A self-contained HTML page for a whole chart: a density timeline with the
// findings marked, the sensor ring at any moment (scrub or play, notes arrive
// toward their sensor), and the findings list to jump around. All data is
// inlined and nothing is requested from anywhere, so the file works opened
// from a download. The chart's notes are drawn from the parsed data; this page
// never contains the original chart text.
const fs = require('fs');
const path = require('path');
const { sensorName } = require('./geometry');
const { RULE_NAMES, formatTime } = require('./report');

const round = (n) => Math.round(n * 1000) / 1000;

/** The compact event list the page draws. */
function pageEvents(events) {
    // Notes sharing a moment are drawn yellow, as in the game ("each" notes).
    const perMoment = new Map();
    for (const e of events) {
        if (e.kind === 'slide') continue; // its star is already counted as a tap
        const key = Math.round(e.time * 200);
        perMoment.set(key, (perMoment.get(key) || 0) + 1);
    }
    return events.map((e) => {
        const each = perMoment.get(Math.round(e.time * 200)) > 1 ? 1 : undefined;
        const out = pageEvent(e);
        if (each) out.e = 1;
        if (e.ex) out.x = 1;
        return out;
    });
}

function pageEvent(e) {
    if (e.kind === 'slide') {
        return {
            k: 's',
            t: round(e.time),
            a: round(e.start),
            z: round(e.end),
            h: e.head,
            b: e.isBreak ? 1 : 0,
            w: e.segments.length === 1 && e.segments[0].shape === 'Fan' ? 1 : 0,
            g: e.segments.map((seg) => ({ s: seg.shape, v: seg.via })),
        };
    }
    const base = { t: round(e.time) };
    if (e.sensor)
        return {
            ...base,
            k: e.kind === 'touchHold' ? 'th' : 'c',
            n: sensorName(e),
            z: e.end ? round(e.end) : undefined,
        };
    const kind = { tap: 't', break: 'b', hold: 'h' }[e.kind] || 't';
    return {
        ...base,
        k: kind,
        l: e.lane,
        z: e.end ? round(e.end) : undefined,
        st: e.star ? 1 : undefined,
    };
}

const safeJson = (value) =>
    JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/[\u2028\u2029]/g, '');

function buildViewerHtml({ title, difficulty, events, finish, findings }) {
    const data = {
        title,
        difficulty,
        finish: round(finish),
        events: pageEvents(events),
        findings: findings.map((f) => ({
            r: f.rule,
            n: RULE_NAMES[f.rule] || f.rule,
            s: f.severity,
            bar: f.bar,
            t: round(f.time),
            c: formatTime(f.time),
            x: f.text,
        })),
    };
    return TEMPLATE.replace('__PLAYFIELD__', () => PLAYFIELD)
        .replace('__DATA__', () => safeJson(data))
        .replace(/__TITLE__/g, () => `${title} — ${difficulty}`.replace(/[<>&"]/g, ''));
}

const PLAYFIELD = fs.readFileSync(path.join(__dirname, 'client', 'playfield.js'), 'utf8');

const TEMPLATE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{--bg:#fff;--card:#f4f3ee;--ink:#1a1a19;--mute:#6b6a64;--line:#d8d6cc;--s1:#d6a100;--s2:#e8742a;--s3:#d93b3b;--tap:#e0488a;--brk:#f08a24;--hold:#d4a017;--touch:#18a999;--slide:#3b74dd}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--card:#242422;--ink:#fff;--mute:#a09f97;--line:#3a3a36}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,"Noto Sans CJK JP",sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:0 0 2px}.sub{color:var(--mute);font-size:13px}
.panel.dark{background:#05060a;color:#cfd0d4}.panel.dark .now{color:#a6a8b0}
.panel{background:var(--card);border-radius:12px;padding:12px;margin-top:12px}
canvas{display:block;width:100%}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
button{font:inherit;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer}
button.on{background:var(--ink);color:var(--bg)}
input[type=range]{flex:1;min-width:120px}
.chips button{padding:3px 9px;font-size:13px}
.f{display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--line);cursor:pointer}
.f:first-child{border-top:0}.f .sev{flex:none;width:10px;border-radius:5px}
.f .m{color:var(--mute);font-size:12px}.f .t{margin-top:2px}.f.cur{background:rgba(127,127,127,.12)}
.now{font-size:13px;color:var(--mute);min-height:2.6em}
.sw{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:14px}.sw label{flex:0 0 120px}.sw input[type=range]{flex:1}.sw output{flex:0 0 40px;text-align:right;color:var(--mute)}summary{cursor:pointer;font-weight:600}
.foot{color:var(--mute);font-size:12px;margin-top:14px}
</style></head><body><div class="wrap">
<h1 id="ttl"></h1><div class="sub" id="sub"></div>
<div class="panel"><canvas id="tl" height="90"></canvas>
<div class="row" style="margin-top:8px"><button id="play">▶ Play</button><button id="prev">◀ Prev</button><button id="next">Next ▶</button>
<button id="spd">1×</button><input id="seek" type="range" min="0" step="0.01"><span id="clock" class="sub"></span></div></div>
<div class="panel dark"><canvas id="ring" height="380"></canvas><div class="now" id="now"></div></div>
<details class="panel" id="cfgbox"><summary>Display settings</summary><div id="cfg"></div></details>
<div class="panel"><div class="row chips" id="chips"></div><div id="list" style="margin-top:6px"></div></div>
<div class="foot">Risks read from a fan transcription of the chart, not certainties; thresholds are not calibrated yet. Slide timing assumes even travel. Generated by Atri.</div>
</div>
<script>
const D=__DATA__;
const $=id=>document.getElementById(id);
$('ttl').textContent=D.title;$('sub').textContent=D.difficulty+' · '+Math.round(D.finish)+'s · '+D.findings.length+' findings';
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SEV={1:'--s1',2:'--s2',3:'--s3'};
let at=0,playing=false,speed=1,last=0,active=new Set(Object.keys(D.findings.reduce((a,f)=>(a[f.r]=1,a),{})));
const WIN_BEFORE=0.2,WIN_AFTER=0.7;
function xy(name,R,C){if(name==='C')return[C,C];const L=name[0],n=+name.slice(1);const al=(L==='A'||L==='B')?22.5+45*(n-1):45*(n-1);const a=al*Math.PI/180;const r={A:.8,B:.5,D:.97,E:.68}[L]*R;return[C+r*Math.sin(a),C-r*Math.cos(a)]}
function setup(c,h){const dpr=window.devicePixelRatio||1,w=c.clientWidth;c.width=w*dpr;c.height=h*dpr;c.style.height=h+'px';const g=c.getContext('2d');g.scale(dpr,dpr);return[g,w]}
const bins=Math.max(1,Math.ceil(D.finish)),dens=new Array(bins).fill(0);D.events.forEach(e=>{dens[Math.min(bins-1,Math.floor(e.t))]++});const dmax=Math.max(...dens,1);
function drawTL(){const[g,w]=setup($('tl'),90);const h=90;g.clearRect(0,0,w,h);g.fillStyle=css('--line');
 dens.forEach((d,i)=>{const bh=(d/dmax)*(h-26);g.fillRect(i/D.finish*w,h-bh,Math.max(1,w/bins-0.5),bh)});
 D.findings.filter(f=>active.has(f.r)).forEach(f=>{g.fillStyle=css(SEV[f.s]);const x=f.t/D.finish*w;g.fillRect(x-1,2,2,10+f.s*4)});
 g.fillStyle=css('--ink');const x=at/D.finish*w;g.fillRect(x-1,0,2,h)}
__PLAYFIELD__
function nowText(){const near=D.findings.filter(f=>active.has(f.r)&&at-0.2<=f.t&&f.t<=at+0.7);$('now').innerHTML=near.length?near.slice(0,3).map(f=>'<b>'+f.r+'</b> '+esc(f.x)).join('<br>'):'';}
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function draw(){$('seek').value=at;$('clock').textContent=Math.floor(at/60)+':'+(at%60).toFixed(1).padStart(4,'0');drawTL();drawRing();nowText();
 document.querySelectorAll('.f').forEach(el=>el.classList.toggle('cur',Math.abs(+el.dataset.t-at)<0.35))}
function go(t){at=Math.max(0,Math.min(D.finish,t));draw()}
function list(){const visible=D.findings.filter(f=>active.has(f.r));$('list').innerHTML=visible.map(f=>'<div class="f" data-t="'+f.t+'"><div class="sev" style="background:'+css(SEV[f.s])+'"></div><div><div class="m">'+f.r+' · '+esc(f.n)+' · bar '+f.bar+' · '+f.c+'</div><div class="t">'+esc(f.x)+'</div></div></div>').join('')||'<div class="sub">Nothing flagged.</div>';
 document.querySelectorAll('.f').forEach(el=>el.onclick=()=>{go(+el.dataset.t-0.25)})}
const rules=[...new Set(D.findings.map(f=>f.r))].sort();
$('chips').innerHTML=rules.map(r=>'<button class="on" data-r="'+r+'">'+r+'</button>').join('');
document.querySelectorAll('#chips button').forEach(b=>b.onclick=()=>{active.has(b.dataset.r)?active.delete(b.dataset.r):active.add(b.dataset.r);b.classList.toggle('on');list();draw()});
$('seek').max=D.finish;$('seek').oninput=e=>go(+e.target.value);
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'⏸ Pause':'▶ Play';last=0;if(playing)requestAnimationFrame(tick)};
$('spd').onclick=()=>{speed=speed===1?.5:speed===.5?.25:1;$('spd').textContent=speed+'×'};
function jump(d){const v=D.findings.filter(f=>active.has(f.r)).map(f=>f.t-0.25);const t=d>0?v.find(x=>x>at+0.05):[...v].reverse().find(x=>x<at-0.05);if(t!==undefined)go(t)}
$('next').onclick=()=>jump(1);$('prev').onclick=()=>jump(-1);
$('tl').onclick=e=>go((e.offsetX/e.target.clientWidth)*D.finish);
function tick(ts){if(!playing)return;if(last)at=Math.min(D.finish,at+(ts-last)/1000*speed);last=ts;draw();if(at>=D.finish){playing=false;$('play').textContent='▶ Play'}else requestAnimationFrame(tick)}
addEventListener('resize',draw);list();go(D.findings.length?Math.max(0,D.findings.find(f=>f.s===3)?.t-0.25||0):0);
</script></body></html>`;

module.exports = { buildViewerHtml };
