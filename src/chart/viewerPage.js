// A self-contained HTML page for a whole chart: a density timeline with the
// findings marked, the sensor ring at any moment (scrub or play, notes arrive
// toward their sensor), and the findings list to jump around. All data is
// inlined and nothing is requested from anywhere, so the file works opened
// from a download. The chart's notes are drawn from the parsed data; this page
// never contains the original chart text.
const fs = require('fs');
const path = require('path');
const { sensorName } = require('./geometry');
const { RULE_NAMES, formatTime, GLOSSARY, SENSORS } = require('./report');

const round = (n) => Math.round(n * 1000) / 1000;

/** Beats (quarter notes) elapsed at `time`, following tempo changes. */
function beatsAt(tempoChanges, time) {
    let beats = 0;
    for (let i = 0; i < tempoChanges.length; i++) {
        const from = tempoChanges[i].time;
        if (from >= time) break;
        const to = Math.min(time, tempoChanges[i + 1]?.time ?? Infinity);
        beats += ((to - from) * tempoChanges[i].tempo) / 60;
    }
    return beats;
}

/** 0 quarter, 1 eighth, 2 sixteenth, 3 triplet, 4 twenty-fourth, 5 thirty-second, 6 other. */
function rhythmClass(beats) {
    const frac = beats - Math.floor(beats);
    const near = (x) =>
        Math.abs(frac - x) < 0.02 || Math.abs(frac - x - 1) < 0.02 || Math.abs(frac - x + 1) < 0.02;
    if (near(0)) return 0;
    if (near(0.5)) return 1;
    if (near(1 / 3) || near(2 / 3)) return 3;
    if (near(0.25) || near(0.75)) return 2;
    if (near(1 / 6) || near(5 / 6)) return 4;
    for (const k of [1, 3, 5, 7]) if (near(k / 8)) return 5;
    return 6;
}

/** The compact event list the page draws. */
function pageEvents(events, tempoChanges) {
    // Notes sharing a moment are drawn yellow, as in the game ("each" notes). A slide's star
    // head is part of the slide, so it is not counted twice, but every slide track is counted.
    // A slide's own strip is yellow only when another slide starts with it (a double slide); a
    // yellow star head from a simultaneous tap leaves the slide blue.
    const perMoment = new Map();
    const slidesPerMoment = new Map();
    for (const e of events) {
        const key = Math.round(e.time * 200);
        if (e.kind === 'slide') slidesPerMoment.set(key, (slidesPerMoment.get(key) || 0) + 1);
        if ((e.kind === 'tap' || e.kind === 'break') && e.star) continue;
        perMoment.set(key, (perMoment.get(key) || 0) + 1);
    }
    return events.map((e) => {
        const key = Math.round(e.time * 200);
        const each = perMoment.get(key) > 1 ? 1 : undefined;
        const out = pageEvent(e);
        if (e.kind === 'slide') {
            if (slidesPerMoment.get(key) > 1) out.e = 1; // a double slide: the strip is yellow
            if (each) out.he = 1; // the star head is yellow whenever something else is with it
        } else if (each) out.e = 1;
        if (e.ex) out.x = 1;
        out.q = rhythmClass(beatsAt(tempoChanges, e.time));
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

function buildViewerHtml({
    title,
    difficulty,
    events,
    finish,
    findings,
    tempoChanges = [],
    maidata = null,
    backUrl = null,
}) {
    const data = {
        title,
        difficulty,
        finish: round(finish),
        glossary: GLOSSARY.map(([t, d]) => ({ t, d })),
        sensors: SENSORS,
        events: pageEvents(events, tempoChanges),
        tempo: tempoChanges.map((c) => ({
            t: round(c.time),
            bpm: round(c.tempo),
            div: c.subdivisions,
        })),
        // The chart text follows the timeline only on the local-network page; a file sent
        // to Discord never carries it.
        maidata: maidata ? maidata.map((l) => ({ t: l.t, s: l.s, steps: l.steps })) : undefined,
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
        .replace('__BACK__', () =>
            backUrl ? `<a class="back" href="${backUrl.replace(/["<>&]/g, '')}">← Songs</a>` : ''
        )
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
select,input[type=number]{font:inherit;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
button{font:inherit;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer}
button.on{background:var(--ink);color:var(--bg)}
input[type=range]{flex:1;min-width:120px}
.chips button{padding:3px 9px;font-size:13px}
.f{display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--line);cursor:pointer}
.f:first-child{border-top:0}.f .sev{flex:none;width:10px;border-radius:5px}
.f .m{color:var(--mute);font-size:12px}.f .t{margin-top:2px}.f.cur{background:rgba(127,127,127,.12)}
.now{font-size:13px;color:var(--mute);min-height:2.6em}
.sw{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:14px}.sw label{flex:0 0 150px}.sw input[type=range]{flex:1}.sw output{flex:0 0 46px;text-align:right;color:var(--mute)}summary{cursor:pointer;font-weight:600}
.info{height:1.7em;font-size:13px;color:#a6a8b0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.now{height:11em;overflow:auto}
.nl{margin-bottom:6px}.panel.dark .mute{color:#7f818a}.mute{color:var(--mute)}
.term{border-bottom:1px dotted currentColor;cursor:help}
#tip{position:fixed;left:12px;right:12px;bottom:12px;max-width:520px;margin:0 auto;background:#111;color:#fff;border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.4);display:none;z-index:9}
#gloss dt{font-weight:650;margin-top:8px}#gloss dd{margin:2px 0 0;color:var(--mute);font-size:14px}
#clock{display:inline-block;min-width:5.2em;text-align:right;font-variant-numeric:tabular-nums}
#spd{width:6.2em}
#list{max-height:60vh;overflow:auto}
.md{font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;height:15em;overflow:hidden}
.mdl{white-space:pre-wrap;word-break:break-all;padding:1px 4px;margin-bottom:2px}
.mdl mark{background:rgba(255,210,63,.45);color:inherit;border-radius:3px}
.mdl.cur{background:rgba(127,127,127,.28);border-radius:4px}.mdt{color:var(--mute)}
.mdh{font-weight:600;margin-bottom:6px}
.checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 12px;margin-top:10px}
.ck{display:flex;align-items:center;gap:6px;font-size:14px}
.step{padding:2px 6px;font-size:12px;flex:none}
.sw select{flex:1}
.back{display:inline-block;margin:0 0 6px;color:var(--mute);text-decoration:none;font-size:14px;padding:4px 0}
.foot{color:var(--mute);font-size:12px;margin-top:14px}
</style></head><body><div class="wrap">
__BACK__<h1 id="ttl"></h1><div class="sub" id="sub"></div>
<div class="panel"><canvas id="tl" height="90"></canvas>
<div class="row" style="margin-top:8px"><button id="play">▶ Play</button><button id="prev">◀ Prev</button><button id="next">Next ▶</button>
<select id="spd" title="Playback speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option><option value="custom">Custom…</option></select><input id="spdc" type="number" min="0.05" max="4" step="0.05" value="1" style="display:none;width:70px"><input id="seek" type="range" min="0" step="0.01"><span id="clock" class="sub"></span></div></div>
<div class="panel dark"><div class="info" id="info"></div><canvas id="ring" height="380"></canvas><div class="now" id="now"></div></div>
<div class="panel" id="mdp" style="display:none"><div class="mdh">Maidata</div><div class="md" id="md"></div></div>
<details class="panel"><summary>Glossary</summary><dl id="gloss"></dl></details>
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
const BEAT=60/((D.tempo[0]&&D.tempo[0].bpm)||120),LEAD=4*BEAT*Math.max(1,Math.ceil(2.5/(4*BEAT)));
let at=-LEAD,playing=false,speed=1,last=0,active=new Set(Object.keys(D.findings.reduce((a,f)=>(a[f.r]=1,a),{})));
const WIN_BEFORE=0.2,WIN_AFTER=0.7;
function xy(name,R,C){if(name==='C')return[C,C];const L=name[0],n=+name.slice(1);const al=(L==='A'||L==='B')?22.5+45*(n-1):45*(n-1);const a=al*Math.PI/180;const r={A:.8,B:.5,D:.97,E:.68}[L]*R;return[C+r*Math.sin(a),C-r*Math.cos(a)]}
function setup(c,h){const dpr=window.devicePixelRatio||1,w=c.clientWidth;c.width=w*dpr;c.height=h*dpr;c.style.height=h+'px';const g=c.getContext('2d');g.scale(dpr,dpr);return[g,w]}
const bins=Math.max(1,Math.ceil(D.finish)),dens=new Array(bins).fill(0);D.events.forEach(e=>{dens[Math.min(bins-1,Math.floor(e.t))]++});const dmax=Math.max(...dens,1);
function drawTL(){const[g,w]=setup($('tl'),90);const h=90;g.clearRect(0,0,w,h);g.fillStyle=css('--line');
 dens.forEach((d,i)=>{const bh=(d/dmax)*(h-26);g.fillRect(i/D.finish*w,h-bh,Math.max(1,w/bins-0.5),bh)});
 D.findings.filter(f=>active.has(f.r)).forEach(f=>{g.fillStyle=css(SEV[f.s]);const x=f.t/D.finish*w;g.fillRect(x-1,2,2,10+f.s*4)});
 g.fillStyle=css('--ink');const x=Math.max(0,at)/D.finish*w;g.fillRect(x-1,0,2,h)}
__PLAYFIELD__
function nowText(){const near=D.findings.filter(f=>active.has(f.r)&&at-2.5<=f.t&&f.t<=at+1.5).sort((a,b)=>Math.abs(a.t-at)-Math.abs(b.t-at)).slice(0,2).sort((a,b)=>a.t-b.t);$('now').innerHTML=near.length?near.map(f=>{const d=f.t-at;const when=Math.abs(d)<0.25?'now':d>0?'in '+d.toFixed(1)+' s':(-d).toFixed(1)+' s ago';return '<div class="nl"><b>'+f.r+'</b> <span class="mute">'+when+'</span> '+explain(f.x)+'</div>'}).join(''):'<span class="mute">Nothing flagged right here.</span>'}
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function fmtT(t){const a=Math.abs(t);return(t<0?'-':'')+Math.floor(a/60)+':'+(a%60).toFixed(1).padStart(4,'0')}
function countOverlay(){if(at>=0)return;const c=$('ring'),g=c.getContext('2d'),dpr=window.devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;g.setTransform(dpr,0,0,dpr,0,0);const n=Math.floor((at+LEAD)/BEAT)%4+1;g.fillStyle='rgba(255,255,255,.9)';g.font='bold '+Math.round(h*.22)+'px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(String(n),w/2,h/2);g.font=Math.round(h*.05)+'px sans-serif';g.fillStyle='rgba(255,255,255,.6)';g.fillText(Math.round(60/BEAT)+' BPM',w/2,h/2+h*.16)}
function draw(){$('seek').value=at;$('clock').textContent=fmtT(at);drawTL();drawRing();countOverlay();nowText();updateInfo();updateMaidata();
 document.querySelectorAll('.f').forEach(el=>el.classList.toggle('cur',Math.abs(+el.dataset.t-at)<0.35))}
function go(t){if(playing&&!cfg.keepPlay){playing=false;$('play').textContent='▶ Play'}at=Math.max(-LEAD,Math.min(D.finish,t));draw()}
function list(){const visible=D.findings.filter(f=>active.has(f.r));$('list').innerHTML=visible.map(f=>'<div class="f" data-t="'+f.t+'"><div class="sev" style="background:'+css(SEV[f.s])+'"></div><div><div class="m">'+f.r+' · '+esc(f.n)+' · bar '+f.bar+' · '+f.c+'</div><div class="t">'+explain(f.x)+'</div></div></div>').join('')||'<div class="sub">Nothing flagged.</div>';
 document.querySelectorAll('.f').forEach(el=>el.onclick=()=>{go(+el.dataset.t-0.25)})}
const rules=[...new Set(D.findings.map(f=>f.r))].sort();
$('chips').innerHTML=rules.map(r=>'<button class="on" data-r="'+r+'">'+r+'</button>').join('');
document.querySelectorAll('#chips button').forEach(b=>b.onclick=()=>{active.has(b.dataset.r)?active.delete(b.dataset.r):active.add(b.dataset.r);b.classList.toggle('on');list();draw()});
$('seek').min=-LEAD;$('seek').max=D.finish;$('seek').oninput=e=>go(+e.target.value);
$('play').onclick=()=>{primeAudio();playing=!playing;$('play').textContent=playing?'⏸ Pause':'▶ Play';last=0;if(playing)requestAnimationFrame(tick)};
$('spd').onchange=()=>{if($('spd').value==='custom'){$('spdc').style.display='';speed=+$('spdc').value||1}else{$('spdc').style.display='none';speed=+$('spd').value}};$('spdc').oninput=()=>{const v=+$('spdc').value;if(v>0)speed=Math.min(4,v)};
function jump(d){const v=D.findings.filter(f=>active.has(f.r)).map(f=>f.t-0.25);const t=d>0?v.find(x=>x>at+0.05):[...v].reverse().find(x=>x<at-0.05);if(t!==undefined)go(t)}
$('next').onclick=()=>jump(1);$('prev').onclick=()=>jump(-1);
{const tl=$('tl');tl.style.touchAction='none';const at2=e=>{const r=tl.getBoundingClientRect();go(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*D.finish)};let drag=false;tl.onpointerdown=e=>{drag=true;tl.setPointerCapture(e.pointerId);at2(e)};tl.onpointermove=e=>{if(drag)at2(e)};tl.onpointerup=tl.onpointercancel=()=>{drag=false}}
function tick(ts){if(!playing)return;const before=at;if(last)at=Math.min(D.finish,at+(ts-last)/1000*speed);last=ts;countIn(before,at);playSounds(before,at);draw();if(at>=D.finish){playing=false;$('play').textContent='▶ Play'}else requestAnimationFrame(tick)}
addEventListener('resize',draw);list();go(-LEAD);
</script></body></html>`;

module.exports = { buildViewerHtml };
