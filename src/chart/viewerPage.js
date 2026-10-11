// A self-contained HTML page for a whole chart: a density timeline with the
// findings marked, the sensor ring at any moment (scrub or play, notes arrive
// toward their sensor), and the findings list to jump around. All data is
// inlined and nothing is requested from anywhere, so the file works opened
// from a download. The chart's notes are drawn from the parsed data; this page
// never contains the original chart text.
const { slideTracks } = require('./slidePaths');
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
        const tracks = slideTracks(e);
        return {
            k: 's',
            t: round(e.time),
            a: round(e.start),
            z: round(e.end),
            h: e.head,
            b: e.isBreak ? 1 : 0,
            w: e.segments.length === 1 && e.segments[0].shape === 'Fan' ? 1 : 0,
            p: tracks ? tracks.map((track) => track.map((alts) => alts[0])) : [],
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
    return TEMPLATE.replace('__DATA__', () => safeJson(data)).replace(/__TITLE__/g, () =>
        `${title} — ${difficulty}`.replace(/[<>&"]/g, '')
    );
}

const TEMPLATE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{--bg:#fff;--card:#f4f3ee;--ink:#1a1a19;--mute:#6b6a64;--line:#d8d6cc;--s1:#d6a100;--s2:#e8742a;--s3:#d93b3b;--tap:#e0488a;--brk:#f08a24;--hold:#d4a017;--touch:#18a999;--slide:#3b74dd}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--card:#242422;--ink:#fff;--mute:#a09f97;--line:#3a3a36}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,"Noto Sans CJK JP",sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:0 0 2px}.sub{color:var(--mute);font-size:13px}
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
<div class="panel"><canvas id="ring" height="380"></canvas><div class="now" id="now"></div></div>
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
const DEF={speed:5,note:1,slideSize:1,slideGap:1,appear:0.8,labels:1,guides:1};
let cfg=Object.assign({},DEF);
try{Object.assign(cfg,JSON.parse(localStorage.getItem('chartViewerCfg')||'{}'))}catch(e){}
const saveCfg=()=>{try{localStorage.setItem('chartViewerCfg',JSON.stringify(cfg))}catch(e){}};
const approach=()=>4/cfg.speed,TRAIL=0.25;
const PAL={single:'#ff5fa2',each:'#ffd23f',brk:'#ff8a2a',slide:'#4d8dff',slideEach:'#ffd23f',ex:'#fff3b0'};
const pick=e=>e.k==='b'?PAL.brk:e.e?PAL.each:PAL.single;
const WHITE='rgba(255,255,255,.92)';
function ring(g,x,y,r,c,ex,brk){const band=Math.max(2.5,r*.34);
 g.save();if(ex){g.shadowColor=PAL.ex;g.shadowBlur=14}
 g.lineWidth=band+3;g.strokeStyle=WHITE;g.beginPath();g.arc(x,y,r,0,7);g.stroke();g.restore();
 g.lineWidth=band;g.strokeStyle=c;g.beginPath();g.arc(x,y,r,0,7);g.stroke();
 g.lineWidth=1.3;g.strokeStyle=WHITE;g.beginPath();g.arc(x,y,r-band*.55,0,7);g.stroke();
 if(ex){g.lineWidth=1.6;g.strokeStyle=PAL.ex;g.beginPath();g.arc(x,y,r+band*.9,0,7);g.stroke()}
 if(brk){g.fillStyle=WHITE;for(const a of[-.8,2.3]){g.beginPath();g.arc(x+Math.cos(a)*r,y+Math.sin(a)*r,band*.28,0,7);g.fill()}}}
function star(g,x,y,r,c,ex){g.save();if(ex){g.shadowColor=PAL.ex;g.shadowBlur=14}g.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.46:r;g.lineTo(x+rr*Math.cos(a),y+rr*Math.sin(a))}g.closePath();g.fillStyle=c;g.fill();g.lineJoin='round';g.lineWidth=2.4;g.strokeStyle=WHITE;g.stroke();g.restore()}
function hexPath(g,x1,y1,x2,y2,w,k){const dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L,nx=-uy,ny=ux;
 g.beginPath();g.moveTo(x1-ux*k,y1-uy*k);g.lineTo(x1+nx*w,y1+ny*w);g.lineTo(x2+nx*w,y2+ny*w);g.lineTo(x2+ux*k,y2+uy*k);g.lineTo(x2-nx*w,y2-ny*w);g.lineTo(x1-nx*w,y1-ny*w);g.closePath()}
function hold(g,tx,ty,hx,hy,r,c,ex){g.save();if(ex){g.shadowColor=PAL.ex;g.shadowBlur=14}hexPath(g,tx,ty,hx,hy,r,r*.7);g.fillStyle=c;g.fill();g.lineJoin='round';g.lineWidth=3;g.strokeStyle=WHITE;g.stroke();g.restore();
 hexPath(g,tx,ty,hx,hy,r*.45,r*.3);g.lineWidth=1.4;g.strokeStyle='rgba(255,255,255,.75)';g.stroke()}
function touch(g,x,y,r,c,gap,ex){g.save();if(ex){g.shadowColor=PAL.ex;g.shadowBlur=12}for(let i=0;i<4;i++){g.save();g.translate(x,y);g.rotate(i*Math.PI/2);g.beginPath();g.moveTo(0,-(r*.22+gap));g.lineTo(-r*.78,-(r*1.12+gap));g.lineTo(r*.78,-(r*1.12+gap));g.closePath();g.fillStyle=c;g.fill();g.lineJoin='round';g.lineWidth=2;g.strokeStyle=WHITE;g.stroke();g.restore()}g.restore()}
function chevron(g,x,y,ux,uy,size,c){const px=-uy,py=ux,h=size,d=size*.8;
 const path=()=>{g.beginPath();g.moveTo(x-ux*d+px*h,y-uy*d+py*h);g.lineTo(x+ux*d,y+uy*d);g.lineTo(x-ux*d-px*h,y-uy*d-py*h)};
 g.lineJoin='round';g.lineCap='round';path();g.lineWidth=size*.95+3;g.strokeStyle=WHITE;g.stroke();path();g.lineWidth=size*.95;g.strokeStyle=c;g.stroke()}
function trail(g,pts,c,passed,size,gapPx){let d=0,walked=0;for(let i=0;i<pts.length-1;i++){const[x1,y1]=pts[i],[x2,y2]=pts[i+1],L=Math.hypot(x2-x1,y2-y1)||1,ux=(x2-x1)/L,uy=(y2-y1)/L;
 for(;d<L-2;d+=gapPx){if(walked+d>=passed)chevron(g,x1+ux*d,y1+uy*d,ux,uy,size,c)}walked+=L;d-=L}}
function pathLen(pts){let n=0;for(let i=0;i<pts.length-1;i++)n+=Math.hypot(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]);return n}
function along(pts,dist){for(let i=0;i<pts.length-1;i++){const L=Math.hypot(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1])||1;if(dist<=L||i===pts.length-2){const k=Math.min(1,dist/L);return[pts[i][0]+(pts[i+1][0]-pts[i][0])*k,pts[i][1]+(pts[i+1][1]-pts[i][1])*k]}dist-=L}return pts[pts.length-1]}
function drawRing(){const c=$('ring'),[g,w]=setup(c,Math.min(c.clientWidth,380));const S=Math.min(w,380),C=S/2,R=C-14,ox=(w-S)/2,AP=approach();g.clearRect(0,0,w,S);g.save();g.translate(ox,0);
 const noteR=R*.1*cfg.note,slideSz=R*.045*cfg.slideSize,slideGap=R*.1*cfg.slideSize*cfg.slideGap;
 g.strokeStyle=css('--line');g.lineWidth=1.5;g.beginPath();g.arc(C,C,R,0,7);g.stroke();
 if(cfg.guides){g.lineWidth=1;g.setLineDash([3,5]);for(let n=1;n<=8;n++){const[x,y]=xy('A'+n,R,C);g.beginPath();g.moveTo(C+(x-C)*.16,C+(y-C)*.16);g.lineTo(x,y);g.stroke()}g.beginPath();g.arc(C,C,R*.8,0,7);g.stroke();g.setLineDash([])}
 for(let n=1;n<=8;n++){const[x,y]=xy('A'+n,R,C);g.lineWidth=2;g.strokeStyle=css('--line');g.beginPath();g.arc(x,y,noteR*1.05,0,7);g.stroke();if(cfg.labels){g.fillStyle=css('--mute');g.font='11px sans-serif';g.textAlign='center';g.fillText(n,x,y+4)}}
 const prog=t=>Math.max(0,Math.min(1,1-(t-at)/AP));
 const lane=(l,p)=>{const[tx,ty]=xy('A'+l,R,C),sx=C+(tx-C)*.16,sy=C+(ty-C)*.16;return[sx+(tx-sx)*p,sy+(ty-sy)*p]};
 const scale=p=>.42+.58*p;
 // slides
 D.events.forEach(e=>{if(e.k!=='s')return;if(e.z<at-TRAIL||e.a-cfg.appear>at)return;
  const on=at>=e.a&&at<=e.z,col=e.b?PAL.brk:e.e?PAL.slideEach:PAL.slide,k=on&&e.z>e.a?Math.min(1,(at-e.a)/(e.z-e.a)):0;
  g.globalAlpha=Math.min(1,(at-(e.a-cfg.appear))/.25+.05)*(at>e.z?Math.max(0,1-(at-e.z)/TRAIL):1);
  if(e.w){const S0=xy('A'+e.h,R,C),ends=e.p.map(p=>xy(p[p.length-1],R,C));
   g.globalAlpha*=.16;g.fillStyle=col;g.beginPath();g.moveTo(S0[0],S0[1]);ends.forEach(q=>g.lineTo(q[0],q[1]));g.closePath();g.fill();g.globalAlpha/=.16;
   const N=7;for(let i=0;i<N;i++){const f=(i+1)/N;if(f<=k)continue;ends.forEach(q=>{const dx=q[0]-S0[0],dy=q[1]-S0[1],L=Math.hypot(dx,dy)||1;chevron(g,S0[0]+dx*f,S0[1]+dy*f,dx/L,dy/L,slideSz*(.7+.55*f),col)})}
   if(on){ends.forEach(q=>star(g,S0[0]+(q[0]-S0[0])*k,S0[1]+(q[1]-S0[1])*k,slideSz*1.5,col));}
  }else e.p.forEach(path=>{const pts=path.map(s=>xy(s,R,C)),tot=pathLen(pts);trail(g,pts,col,k*tot,slideSz,slideGap);
   if(on&&e.z>e.a){const[x,y]=along(pts,k*tot);star(g,x,y,noteR*.95,col)}});
  g.globalAlpha=1});
 // notes
 D.events.forEach(e=>{
  if(e.k==='s'){if(e.t<=at+AP&&e.t>=at-TRAIL&&at<=e.a+TRAIL){const p=prog(Math.min(e.t,e.a)),[x,y]=lane(e.h,at>=e.t?1:p);g.globalAlpha=at>e.t?Math.max(0,1-(at-e.t)/TRAIL):1;const col=e.b?PAL.brk:e.e?PAL.slideEach:PAL.slide;star(g,x,y,noteR*(e.w?1.35:1)*scale(at>=e.t?1:p),col);g.globalAlpha=1}return}
  const end=e.z&&e.z>e.t?e.z:e.t;if(e.t>at+AP||end<at-TRAIL)return;
  g.globalAlpha=at>end?Math.max(0,1-(at-end)/TRAIL):1;
  if(e.n){const[x,y]=xy(e.n,R,C),p=prog(e.t),r=noteR*.8,gap=(1-p)*noteR*1.6,c=e.e?PAL.each:PAL.slide;
   if(e.k==='th'&&at>=e.t&&at<=e.z){g.lineWidth=3;g.strokeStyle=c;g.beginPath();g.arc(x,y,r*2,0,7);g.stroke()}
   touch(g,x,y,r,c,gap,e.x);if(e.k==='th'){g.fillStyle=WHITE;g.beginPath();g.arc(x,y,r*.22,0,7);g.fill()}
   if(cfg.labels){g.fillStyle=css('--mute');g.font='9px sans-serif';g.textAlign='center';g.fillText(e.n,x,y-r*1.7-gap)}}
  else{const p=at>=e.t?1:prog(e.t),[x,y]=lane(e.l,p),r=noteR*scale(p);
   if(e.k==='h'){const[tx,ty]=lane(e.l,prog(e.z));hold(g,tx,ty,x,y,r*.95,pick(e),e.x)}
   else if(e.st){star(g,x,y,r*1.1,pick(e),e.x)}else ring(g,x,y,r,pick(e),e.x,e.k==='b')}
  g.globalAlpha=1});
 g.restore()}
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
const CFG=[['speed','Note speed',1,10,.5],['note','Note size',.6,1.6,.05],['slideSize','Slide size',.6,1.8,.05],['slideGap','Slide gap',.6,2,.05],['appear','Slide appears (s before)',0,2,.1]];
$('cfg').innerHTML=CFG.map(([k,l,mn,mx,st])=>'<div class="sw"><label>'+l+'</label><input type="range" data-k="'+k+'" min="'+mn+'" max="'+mx+'" step="'+st+'" value="'+cfg[k]+'"><output>'+cfg[k]+'</output></div>').join('')+
 '<div class="sw"><label><input type="checkbox" data-k="labels"'+(cfg.labels?' checked':'')+'> Labels</label><label><input type="checkbox" data-k="guides"'+(cfg.guides?' checked':'')+'> Guides</label><button id="cfgreset">Reset</button></div>';
document.querySelectorAll('#cfg input').forEach(i=>i.oninput=()=>{cfg[i.dataset.k]=i.type==='checkbox'?(i.checked?1:0):+i.value;if(i.nextElementSibling)i.nextElementSibling.textContent=cfg[i.dataset.k];saveCfg();draw()});
$('cfgreset').onclick=()=>{cfg=Object.assign({},DEF);saveCfg();document.querySelectorAll('#cfg input').forEach(i=>{if(i.type==='checkbox')i.checked=!!cfg[i.dataset.k];else{i.value=cfg[i.dataset.k];i.nextElementSibling.textContent=cfg[i.dataset.k]}});draw()};
addEventListener('resize',draw);list();go(D.findings.length?Math.max(0,D.findings.find(f=>f.s===3)?.t-0.25||0):0);
</script></body></html>`;

module.exports = { buildViewerHtml };
