/* ==========================================================================
 * js/games/game-hubs.js
 * Game Hubs & proxies: hub list, proxy browser, iframe viewer, launcher
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

/* ---------- Game Hubs ---------- */
const PROXIES_URL='https://raw.githubusercontent.com/jace01b-web/itsukis-chat-hub-obfuscated/refs/heads/main/app.json';
let _proxyCredit='';
const PROXY_FALLBACK={"credits":"Every proxy here belongs to its original creators. Full credit to all of them. I didn't make any of these.","groups":[{"name":"Shadow","links":["https://studyeconomics.berugy.hu","https://reviewastronomy.dadaclubdearte.ar","https://explorephysics.flyredwing.ru","https://primegrammarhelp.telradio.com.ar","https://studychemistry.artsydomains.com","https://smartcalculuspractice.rostech.mx","https://clearreadinglab.thevictoryseed.org","https://dailygrammaracademy.krl.com.np","https://grammarlab.kominarstvotuzinsky.sk"]},{"name":"Petezah","links":["https://petezahgames11.firebaseapp.com","https://petezahgames12.firebaseapp.com","https://cdn.jsdelivr.net/gh/newrelightedteam/math@master/nirbytes.svg","https://cdn.jsdelivr.net/gh/PeteZah-G/PeteZahStaticDone@main/new.svg","https://cdn.jsdelivr.net/gh/Eraclio28/PeteZahStaticDone@main/new.svg","https://cdn.jsdelivr.net/gh/PeteZah-G/PeteZahStaticDone/main.svg","https://cdn.jsdelivr.net/gh/pineapple-petezah/homework/main.svg","https://petezahgames4.firebaseapp.com","https://123moviesgo.cfd","https://123movieshd.cyou","https://cdn.jsdelivr.net/gh/petezahiscool/svg@main/index.svg","https://cdn.jsdelivr.net/gh/homeworkpractive/svg@main/index.svg","https://quantil.jsdelivr.net/gh/homeworkpractive/svg@acfa607/pizza.svg","https://gcore.jsdelivr.net/gh/homeworkpractive/svg@acfa607/pizza.svg"]},{"name":"Nexora","links":["https://noterplusbunny7447.b-cdn.net","https://noterplusflare06.lucky-mode-2e0e.workers.dev","https://fnourguruh.b-cdn.net","https://bxappeidj4iav6crormf7atzvi0iwpnq.lambda-url.us-east-2.on.aws","https://noterplusfire06.firebaseapp.com/links","https://noterplusfire18.firebaseapp.com/links","https://noterplusfire21.firebaseapp.com/links","https://mirror.nexora-unblocked.workers.dev","https://noterplusflare02.lucky-mode-2e0e.workers.dev","https://dv2e5yktargs5yruv3eqcd6vcm0mwamc.lambda-url.us-east-2.on.aws","https://noterplusfire18.firebaseapp.com","https://noterplus-147.web.app","https://noterplus-177.web.app","https://noterplusfire32.firebaseapp.com"]},{"name":"Lunaar and V2","links":["https://lunar-school.inmobiliariamardelplata.com"]},{"name":"Selenite","links":["https://louispasteuriswformilkthegoatedhimselfdiddy.churchinhuntsville.org"]},{"name":"Void Network","links":["https://bcsdny.net","https://voidthebest.centrodiagnosticogenetico.com","https://iliketocode.majoitus.ee","https://doyourwork.mundra.com","https://voidistuff.rusticrivergear.com","https://bld.share-with.de","https://gmpuj.share-with.uk","https://cko.shared2.uk","https://wypa.anointedacres.com","https://jqwmq.deepee.com","https://bigboy4.pagostepeapulco.gob.mx","https://bigboy2.panel-laboralcj.gob.mx","https://bigboy3.root.sx"]},{"name":"Truffled","links":["https://health.wvpreschool.org","https://for-randomgamer5354.viapointpos.com","https://for-randomgamer5354.glamourfreaks.com","https://truffled.cafemeridiano.com.br","https://truffled.freshmilk.co.za","https://truffled.gparente.net.br","https://truffled.oxsec.com.mx"]},{"name":"Utopia","links":["https://birds.inmobiliariamardelplata.com/","https://utopia-math.inmobiliariamardelplata.com/","https://medf.s3.us-east-1.amazonaws.com/index.html#"]},{"name":"Cherri","links":["https://quantil.jsdelivr.net/gh/NotAbdullahHD/cherri@main/index.svg","https://cdn.jsdelivr.net/gh/NotAbdullahHD/cherri@main/index.svg","https://fastly.jsdelivr.net/gh/NotAbdullahHD/cherri@main/index.svg","https://gcore.jsdelivr.net/gh/NotAbdullahHD/cherri@main/index.svg","https://testingcf.jsdelivr.net/gh/NotAbdullahHD/cherri@main/index.svg","https://originfastly.jsdelivr.net/gh/NotAbdullahHD/cherri@main/index.svg","https://storage.googleapis.com/mathlearning/ilovessp/500klinks/cherri_470","https://storage.googleapis.com/mathlearning/ilovessp/500klinks/cherri_2","https://cherri.cafemeridiano.com.br/","https://cherri.freshmilk.co.za/","https://cherri.gparente.net.br/","https://cherri.oxsec.com.mx/","https://cherri.windowpublication.com.np/","https://cherri.adijaya.id/","https://cherri.mantavyagajjar.com/","https://cherri.nenadic.hr/","https://cherri.studio16.ru/","https://cherri.suliaotongwang.com/","https://cherri.worldmicroscope.com/","https://cherri.moldeointeractive.com.ar/","https://cherri.krepche.com/","https://cherri.buf2.com/","https://cherri.bielenberg.id.au/","https://cherri.djtaylor.me/onboarding/","https://nerd69.stone95.com/","https://nerds.stone95.com/","https://nerdss.stone95.com/","https://nerdsss.stone95.com/","https://nerdssss.stone95.com/","https://flybird.berugy.hu/","https://birdie.flyredwing.ru/","https://kingkong.mantavyagajjar.com/","https://monkey69.robertschulze.name/","https://mantaray.mantavyagajjar.com/","https://a.bulkenergy.cl","https://asd.bulkenergy.cl","https://b.bulkenergy.cl","https://c.bulkenergy.cl","https://d.bulkenergy.cl","https://a.priestella.xyz","https://b.priestella.xyz","https://c.priestella.xyz","https://d.priestella.xyz","https://e.priestella.xyz"]},{"name":"Aether","links":["https://aether-schools.s3.amazonaws.com/study.html","https://graphing-calculator.s3.amazonaws.com/study.html","https://s3.amazonaws.com/ti84/index.html","https://s3.amazonaws.com/graphing-calculator/index.html","https://s3.amazonaws.com/gsuiteclassroom/index.html","https://s3.amazonaws.com/aether-education/study.html","https://d1xprhi2iqpbz6.cloudfront.net/study.html","https://d3b80h8dw7pfqm.cloudfront.net/"]},{"name":"Mist","links":["https://storage.googleapis.com/mathlearning/ilovessp/500klinks/mist_465.html","https://s3.amazonaws.com/mistcalc/index.html","https://storage.googleapis.com/mistedu/index.html","https://s3.amazonaws.com/mistmath/index.html","https://s3.amazonaws.com/mistedu/index.html","https://storage.googleapis.com/mistmath/index.html","https://s3.amazonaws.com/ilovecalc/index.html","https://s3.amazonaws.com/mathisgreataf/index.html","https://s3.amazonaws.com/readingisgreataf/index.html","https://s3.amazonaws.com/bull33isgreataf/index.html","https://s3.amazonaws.com/mistmac/index.html","https://s3.amazonaws.com/macmist/index.html"]},{"name":"Xylora","links":["https://host.echoschool.cfd/","https://location.ronginbari.com/"]},{"name":"Nocturne","links":["https://storage.googleapis.com/mathlearning/ilovessp/500klinks/noc_466.svg","https://noc.sysdsolutions.com/","https://noc.desaulniers.net/","https://noc.stjameskilolo.org/","https://noc.afterthebeep.us/"]},{"name":"Nexus","links":["https://storage.googleapis.com/mathlearning/ilovessp/500klinks/student_467.svg"]},{"name":"Duckmath","links":["https://cdn.jsdelivr.net/gh/freezenovasrl/cdn/duckmath.svg#/","https://storage.googleapis.com/mathlearning/ilovessp/500klinks/duckmath_472","https://storage.googleapis.com/mathlearning/ilovessp/500klinks/duckmath_4","https://storage.googleapis.com/mathlessons/duckmath.svg#/","https://unpkg.com/classroomduck@1.0.0/index.svg","https://storage.googleapis.com/mathlessons/duckmath.html"]},{"name":"Melonsoda","links":["https://unpkg.com/melonsoda@1.0.0/offline/selfupdating.html","https://cdn.jsdelivr.net/gh/linuxfandudeguy/classwork-chemistry@main/ixl.svg","https://fastly.jsdelivr.net/gh/linuxfandudeguy/classwork-chemistry@main/ixl.svg","https://gcore.jsdelivr.net/gh/linuxfandudeguy/classwork-chemistry@main/ixl.svg","https://quantil.jsdelivr.net/gh/linuxfandudeguy/classwork-chemistry@main/ixl.svg","https://originfastly.jsdelivr.net/gh/linuxfandudeguy/classwork-chemistry@main/ixl.svg","https://testingcf.jsdelivr.net/gh/linuxfandudeguy/classwork-chemistry@main/ixl.svg","https://free-french-resources.firebaseapp.com/","https://educational-algebra-study-tutor.edgeone.app/"]},{"name":"Yukios","links":["https://originfastly.jsdelivr.net/gh/reeyuki/YukiOsSingleHtml@main/yukios.svg","https://quantil.jsdelivr.net/gh/reeyuki/YukiOsSingleHtml@main/yukios.svg","https://cdn.jsdelivr.net/gh/reeyuki/YukiOsSingleHtml@main/yukios.svg","https://cdn.staticdelivr.com/gh/reeyuki/YukiOsSingleHtml/main/yukios.svg","https://gcore.jsdelivr.net/gh/reeyuki/YukiOsSingleHtml@main/yukios.svg"]},{"name":"Nike Hub","links":["http://originfastly.jsdelivr.net/gh/avaisadev/github.com@latest/index.svg","https://gcore.jsdelivr.net/gh/avaisadev/github.com@latest/index.svg","https://quantil.jsdelivr.net/gh/avaisadev/github.com@latest/index.svg","https://testingcf.jsdelivr.net/gh/avaisadev/github@latest/index.svg","https://originfastly.jsdelivr.net/gh/avaisadev/github@latest/index.svg","https://gcore.jsdelivr.net/gh/avaisadev/github@latest/index.svg","https://quantil.jsdelivr.net/gh/avaisadev/github@latest/index.svg","https://testingcf.jsdelivr.net/gh/avaisadev/how-to-use-linux@latest/index.svg","https://fastly.jsdelivr.net/gh/avaisadev/how-to-use-linux@latest/index.svg","https://cdn.jsdelivr.net/gh/avaisadev/github.com/index.svg","https://cdn.jsdelivr.net/gh/avaisadev/how-to-use-linux@main/index.svg","https://originfastly.jsdelivr.net/gh/avaisadev/github.com@latest/index.svg"]},{"name":"Fern","links":["https://s3.amazonaws.com/writevc/index.html","https://s3.amazonaws.com/bullubg/index.html","https://s3.amazonaws.com/deaganfern/index.html","https://s3.amazonaws.com/fsreading/index.html","https://s3.amazonaws.com/ilovemaths/index.html","https://s3.amazonaws.com/bulledu/index.html","https://s3.amazonaws.com/newubgyt/index.html","https://s3.amazonaws.com/fsmath/index.html","https://s3.amazonaws.com/gnsux/index.html","https://s3.amazonaws.com/plssub/index.html","https://s3.amazonaws.com/cherrisux/index.html","https://s3.amazonaws.com/bestgamelol/index.html","https://s3.amazonaws.com/ernew/index.html"]},{"name":"NautilusOS","links":["https://unpkg.com/curvetheback@1.0.19/index.html","https://unpkg.com/curvetheleg@1.0.21/index.html","https://unpkg.com/raim-math-work@1.0.18/index.html","https://unpkg.com/valoq-test@1.0.12/index.html","https://unpkg.com/curvetheshoulder@1.0.17/index.html","https://unpkg.com/curvethehip@1.0.15/index.html","https://unpkg.com/ilikefishthathavebones-jollyraimball@1.0.14/index.html","https://unpkg.com/curvethearm@1.0.2/index.html"]},{"name":"BULL-33","links":["https://s3.amazonaws.com/oiop/index.html#shop","https://s3.amazonaws.com/bulldebut/index.html#shop","https://s3.amazonaws.com/jlkl/index.html","https://s3.amazonaws.com/iuyt/index.html","https://s3.dualstack.us-east-1.amazonaws.com/iuyt/index.html","https://s3.dualstack.us-east-1.amazonaws.com/finallybull/index.html"]},{"name":"Dogeub","links":["https://storage.googleapis.com/dogeub/index.html#/search","https://cdn.jsdelivr.net/gh/dogeub/-/index.svg#/search","https://instructure.storage.googleapis.com/index.html","https://storage.googleapis.com/educationate/index.html","https://s3.amazonaws.com/deltamath-demo/index.html","https://cdn.jsdelivr.net/gh/dogeub/-/index.svg#/docs","https://5www.update.www.9update.105v6nrsclqx.classroom.de5.net/","https://6update.update.update.05v6nrsclqx.classroom.de5.net/","https://7update.update.8update.05v6nrsclqx.classroom.de5.net/","https://7654update.update.98update.05v6nrsclqx.classroom.de5.net/","https://lsrelay-1.s3.amazonaws.com/index.html","https://cdn.jsdelivr.net/gh/dogeub/-/index.svg","https://storage.googleapis.com/dogeub/index.html","https://storage.googleapis.com/canvas-lms/index.html","https://s3.amazonaws.com/oic4/index.html","https://cdn.jsdelivr.net/gh/stockable/dd-static/dist/index.svg"]},{"name":"Otonic","links":["https://gscsoccer.com","https://technology.writing.music.algebra.literature.ingeprop.com.ar/","https://gscsoccer.store"]}]};
const GAME_HUBS_URL='https://raw.githubusercontent.com/Cra-Z-Gaming/VUS/refs/heads/main/apps.json';
const HUB_COLORS={
  white:{bg:'rgba(255,255,255,.14)',fg:'#f8fafc'},green:{bg:'rgba(34,197,94,.16)',fg:'#4ade80'},
  blue:{bg:'rgba(59,130,246,.16)',fg:'#60a5fa'},rose:{bg:'rgba(244,63,94,.16)',fg:'#fb7185'},
  violet:{bg:'rgba(139,92,246,.16)',fg:'#a78bfa'},yellow:{bg:'rgba(234,179,8,.16)',fg:'#fde047'},
  cyan:{bg:'rgba(6,182,212,.16)',fg:'#22d3ee'},lime:{bg:'rgba(132,204,22,.16)',fg:'#a3e635'},
  orange:{bg:'rgba(249,115,22,.16)',fg:'#fb923c'},red:{bg:'rgba(239,68,68,.16)',fg:'#f87171'},
  purple:{bg:'rgba(168,85,247,.16)',fg:'#c084fc'},black:{bg:'rgba(255,255,255,.08)',fg:'#e2e8f0'},
  grey:{bg:'rgba(148,163,184,.16)',fg:'#cbd5e1'},amber:{bg:'rgba(245,158,11,.16)',fg:'#fbbf24'}
};
let _hubData=null,_hubQuery='';
// Curated allowlist — only these hubs (by name) show up, regardless of whatever else
// gets added to the "hubs" array in apps.json down the line.
const HUB_INFO=window.HUB_INFO||{},HUB_INFO_X=window.HUB_INFO_X||{};
const HUB_SECTIONS=[['apps','Apps'],['hubs','Hubs'],['tools','Tools'],['links','Links'],['proxies','Proxies']];
// Custom entries added by hand (shown without needing the external apps.json / HUB_INFO).
const CUSTOM_HUBS=[
  {sec:'apps',name:'MZK',url:'https://raw.githubusercontent.com/Cra-Z-Gaming/VUS/refs/heads/main/MZK',desc:'MZK app.',icon:'MZK',color:'violet'},
  {sec:'apps',name:'The Long Hall [Beta Vers.]',url:'https://raw.githubusercontent.com/AniItsukiCoded/tlh/refs/heads/main/index.html',desc:'MZK app.',icon:'TLH',color:'red'},
  {sec:'apps',name:'VUS Hub Modded',url:'https://raw.githubusercontent.com/AniItsukiCoded/VUS-Hub-Modded/refs/heads/main/VUSHubModded.html',desc:'Modded version of VUS Hub.',icon:'VM',color:'orange'},
  {sec:'apps',name:'VUS Chat Modded',url:'https://raw.githubusercontent.com/jace01b-web/VUS-Modded/refs/heads/main/index.html',desc:'Modded version of VUS Chat, featuring a mod menu and new UI.',icon:'VC',color:'orange'},
  {sec:'apps',name:'PremiumTube',url:'https://raw.githubusercontent.com/AniItsukiCoded/ytfreemium/refs/heads/main/index.html',desc:'Unblocked, adfree, version of Youtube.',icon:'YT',color:'red'},
  {sec:'hubs',name:"Nike Hub",url:"https://originfastly.jsdelivr.net/gh/avaisadev/github.com@latest/index.svg",desc:"Both a web proxy and a games hub. More mirrors are under Proxies.",icon:"NH",color:"orange"},
  {sec:'hubs',name:"Dogeub",url:"https://storage.googleapis.com/dogeub/index.html",desc:"Proxy with a search bar plus games. Same family as Otonic. More mirrors are under Proxies.",icon:"DG",color:"yellow"},
  {sec:'hubs',name:"Otonic",url:"https://gscsoccer.com",desc:"Proxy with a search bar plus games. Same family as Dogeub. More mirrors are under Proxies.",icon:"OT",color:"cyan"},
  {sec:'hubs',name:"Duckmath",url:"https://storage.googleapis.com/mathlessons/duckmath.html",desc:"Duckmath game hub. More mirrors are under Proxies.",icon:"DM",color:"lime"}
];
let _hubSec='hubs',_pxGroup='',_hubDir=0;
const GAME_HUB_ALLOWLIST=new Set(Object.keys(HUB_INFO));
function hubInfoFor(sec,name){
  const k=(name||'').trim().toLowerCase();
  return (sec==='hubs'?HUB_INFO:(HUB_INFO_X[sec]||{}))[k]||null;
}
function isGameHub(h){
  return GAME_HUB_ALLOWLIST.has((h.name||'').trim().toLowerCase());
}
function modalGameHubs(){
  _hubQuery='';_hubSec='hubs';_pxGroup='';
  $('#modalRoot').innerHTML=`<div class="modal-bg" id="ghBg"><div class="modal wide">
    <button class="modal-x gh-gear" id="ghGear" title="Hubs &amp; Tools settings" aria-label="Hubs and Tools settings">⚙</button><button class="modal-x" id="ghX">✕</button>
    <h2 id="ghTitle">🎮 Hubs &amp; Tools</h2>
    <div class="hint">Game sites, movie hubs, proxies, apps, tools and links — pick one to open it (change how in ⚙ settings).</div>
    <div class="gh-views" id="ghViews"><div class="gh-set hidden" id="ghSet">
      <div class="gh-set-row"><div><b>Open links in an iframe</b><small>On (default): links open in a viewer inside this site. Off: they open in a new tab. Saved to your account, so it follows you to every device.</small></div>
      <label class="switch"><input type="checkbox" id="ghIframe"><span class="slider"></span></label></div>
      <div class="gh-set-note">Some sites refuse to load inside an iframe. If one shows blank, use "Open in new tab" in the viewer.</div>
    </div>
    <div id="ghMain"><div class="field" id="ghSearchWrap" style="margin-top:14px"><input id="ghSearch" placeholder="Search everything..." autocomplete="off"></div>
    <div class="gh-body"><nav class="gh-side" id="ghSide" aria-label="Proxy sections"><div class="gh-side-in" id="ghSideIn"></div></nav><div class="hub-list" id="ghList"><div class="empty">Loading...</div></div></div>
    <div class="hub-tabs" id="ghTabs" role="tablist"></div></div></div>
  </div></div>`;
  $('#ghX').onclick=closeGameHubs;
  const ifc=$('#ghIframe');ifc.checked=hubOpenMode()==='iframe';
  ifc.onchange=()=>setHubOpenMode(ifc.checked?'iframe':'tab');
  let busy=false;
  $('#ghGear').onclick=()=>{
    if(busy)return;busy=true;
    const views=$('#ghViews'),setP=$('#ghSet'),main=$('#ghMain'),g=$('#ghGear'),t=$('#ghTitle');
    const toSet=setP.classList.contains('hidden');
    const out=toSet?main:setP,inn=toSet?setP:main;
    const h0=views.offsetHeight;
    views.style.height=h0+'px';views.classList.add('busy');
    g.classList.remove('spin');void g.offsetWidth;g.classList.add('spin');
    t.classList.add('gh-title-out');
    out.classList.add(toSet?'gh-out-l':'gh-out-r');
    setTimeout(()=>{
      out.classList.add('hidden');out.classList.remove('gh-out-l','gh-out-r');
      inn.classList.remove('hidden');
      views.style.height='auto';const h1=views.offsetHeight;      // natural height of the incoming pane
      views.style.height=h0+'px';void views.offsetHeight;
      views.style.transition='height .5s cubic-bezier(.16,1,.3,1)';
      views.style.height=h1+'px';
      inn.classList.add(toSet?'gh-in-r':'gh-in-l');
      t.textContent=toSet?'⚙ Hubs & Tools settings':'🎮 Hubs & Tools';
      t.classList.remove('gh-title-out');t.classList.add('gh-title-in');
      g.textContent=toSet?'←':'⚙';
      if(!toSet)hubPill(true);
      setTimeout(()=>{
        inn.classList.remove('gh-in-r','gh-in-l');t.classList.remove('gh-title-in');
        views.style.transition='';views.style.height='';views.classList.remove('busy');
        busy=false;
      },520);
    },190);
  };
  $('#ghBg').onclick=e=>{if(e.target.id==='ghBg')closeGameHubs()};
  $('#ghSearch').oninput=()=>{_hubQuery=$('#ghSearch').value.trim().toLowerCase();renderHubList()};
  loadHubs();
}
// Plays the same fade/scale-down exit the rest of the modals use (see
// .modal-bg.closing) instead of yanking the panel out instantly.
function closeGameHubs(){
  const bg=$('#ghBg');if(!bg){if($('#modalRoot'))$('#modalRoot').innerHTML='';return}
  bg.classList.add('closing');
  setTimeout(()=>{if($('#modalRoot'))$('#modalRoot').innerHTML=''},200);
}
async function loadHubs(){
  if(_hubData){renderHubList();return}
  try{
    const res=await fetch(GAME_HUBS_URL+'?v='+Date.now(),{cache:'no-store'});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    const out=[];
    HUB_SECTIONS.forEach(([sec])=>{
      (data[sec]||[]).forEach(h=>{
        if(!h||!h.name||!h.name.trim()||!h.url||!h.url.trim())return;
        const i=hubInfoFor(sec,h.name);
        if(!i)return; // curated: only listed items show
        out.push({...h,sec,name:i.n||h.name.trim(),desc:i.d||h.desc||'',icon:i.i||h.icon||'',color:(h.color&&h.color.trim())||i.c||''});
      });
    });
    CUSTOM_HUBS.forEach(h=>out.push({...h}));
    // Proxies: loaded from app.json in the chat hub repo, with a built-in copy as backup.
    let px=PROXY_FALLBACK;
    try{const pr=await fetch(PROXIES_URL+'?v='+Date.now(),{cache:'no-store'});if(pr.ok){const pj=await pr.json();if(pj&&Array.isArray(pj.groups)&&pj.groups.length)px=pj}}catch(_){}
    // Groups that exist in the built-in list but not in the fetched file are added (so a new app.json works
    // even before it is uploaded, and when the page is opened from a local file).
    if(px!==PROXY_FALLBACK){const have=new Set(px.groups.map(g=>(g.name||'').toLowerCase()));px={...px,groups:[...px.groups,...PROXY_FALLBACK.groups.filter(g=>!have.has((g.name||'').toLowerCase()))]}}
    _proxyCredit=px.credits||PROXY_FALLBACK.credits;
    const PXC=['blue','violet','rose','green','orange','cyan','purple','red'];
    px.groups.forEach((g,gi)=>{
      const ls=(g.links||[]).filter(u=>u&&u.trim());
      ls.forEach((u,i)=>out.push({sec:'proxies',group:g.name,name:g.name+(ls.length>1?' '+(i+1):''),url:u.trim(),desc:u.trim().replace(/^https?:\/\//,''),icon:'\ud83c\udf10',color:PXC[gi%PXC.length]}));
    });
    _hubData=out;
    renderHubList();
  }catch(e){
    const box=$('#ghList');if(!box)return;
    box.innerHTML=`<div class="empty">Couldn't load the list.<br><button class="btn sec small" id="ghRetry" style="margin-top:10px">Retry</button></div>`;
    if($('#ghRetry'))$('#ghRetry').onclick=()=>{box.innerHTML='<div class="empty">Loading...</div>';loadHubs()};
  }
}
// Proxies get their own two-pane UI: sections menu on the LEFT, the selected section's proxies on the right.
function updateProxySide(box,items){
  const side=$('#ghSide'),inn=$('#ghSideIn');if(!side||!inn)return;
  const on=_hubSec==='proxies'&&items.length>0;
  side.classList.toggle('open',on);
  if(!on)return;                         // keep old buttons while it slides away
  const groups=[];
  items.forEach(h=>{if(!h.group)return;let g=groups.find(x=>x.name===h.group);if(!g){g={name:h.group,n:0,color:h.color};groups.push(g)}g.n++});
  inn.innerHTML='<div class="gh-side-title">Sections</div>';
  const mk=(key,label,n,dotFg)=>{
    const b=document.createElement('button');b.type='button';b.className='gh-side-btn'+(_pxGroup===key?' on':'');b.dataset.g=key;
    b.innerHTML=`<em style="background:${dotFg}"></em><span>${esc(label)}</span><i>${n}</i>`;
    b.onclick=()=>{if(_pxGroup===key)return;_pxGroup=key;inn.querySelectorAll('.gh-side-btn').forEach(x=>x.classList.toggle('on',x===b));hubTransition(box,0,()=>renderHubList())};
    inn.appendChild(b);
  };
  mk('','All',items.length,'var(--accent)');
  groups.forEach(g=>mk(g.name,g.name,g.n,(HUB_COLORS[(g.color||'').toLowerCase()]||HUB_COLORS.grey).fg));
  box.onscroll=null;
}
// Sliding highlight behind the active bottom tab.
document.addEventListener('transitionend',e=>{if(e.target&&e.target.classList&&e.target.classList.contains('modal')&&e.propertyName==='max-width')hubPill(true)});
function hubPill(instant){
  const tabs=$('#ghTabs');if(!tabs)return;
  const pill=tabs.querySelector('.hub-pill'),on=tabs.querySelector('.hub-tab.on');
  if(!pill||!on||!on.offsetWidth)return;
  if(instant||!pill._placed){pill.style.transition='none'}
  pill.style.width=on.offsetWidth+'px';pill.style.height=on.offsetHeight+'px';
  pill.style.transform='translate('+on.offsetLeft+'px,'+on.offsetTop+'px)';
  if(instant||!pill._placed){void pill.offsetWidth;pill.style.transition='';pill._placed=true}
}
window.addEventListener('resize',()=>hubPill(true));
// Fade the old list out, swap content, then slide the new one in while the panel height glides to its new size
// (so the modal never snaps/teleports when the content length changes).
let _hubTok=0;
function hubTransition(box,dir,fn){
  const tok=++_hubTok;
  const h0=box.offsetHeight;
  const ALL=['swap','swapL','swapR','leaveL','leaveR','leaveD'];
  box.classList.remove(...ALL);
  box.style.transition='none';box.style.overflow='hidden';box.style.height=h0+'px';
  box.classList.add(dir>0?'leaveL':dir<0?'leaveR':'leaveD');
  setTimeout(()=>{
    if(tok!==_hubTok)return;
    box.classList.remove(...ALL);
    box.style.height='auto';box.scrollTop=0;
    fn();
    const h1=box.offsetHeight;
    box.style.height=h0+'px';void box.offsetHeight;
    box.style.transition='height .42s cubic-bezier(.16,1,.3,1)';
    box.style.height=h1+'px';
    box.classList.add(dir>0?'swapR':dir<0?'swapL':'swap');
    setTimeout(()=>{
      if(tok!==_hubTok)return;
      box.style.transition='';box.style.height='';box.style.overflow='';box.classList.remove(...ALL);
    },460);
  },150);
}
function switchHubTab(k){
  if(_hubSec===k)return;
  const box=$('#ghList');if(!box)return;
  const ids=HUB_SECTIONS.map(x=>x[0]);
  const dir=ids.indexOf(k)>ids.indexOf(_hubSec)?1:-1;
  _hubSec=k;
  document.querySelectorAll('#ghTabs .hub-tab').forEach(b=>{const a=b.dataset.k===k;b.classList.toggle('on',a);b.setAttribute('aria-selected',a)});
  hubPill();                                   // pill starts sliding right away
  hubTransition(box,dir,()=>renderHubList());
}
function renderHubList(swap){
  const box=$('#ghList');if(!box||!_hubData)return;
  const q=_hubQuery;
  const match=h=>!q||h.name.toLowerCase().includes(q)||(h.desc||'').toLowerCase().includes(q)||(h.group||'').toLowerCase().includes(q);
  const counts={};
  _hubData.forEach(h=>{if(match(h))counts[h.sec]=(counts[h.sec]||0)+1});
  const tabs=$('#ghTabs');
  if(tabs){
    if(!tabs._built){
      tabs.innerHTML='<span class="hub-pill"></span>';
      HUB_SECTIONS.forEach(([k,label])=>{
        const b=document.createElement('button');
        b.type='button';b.setAttribute('role','tab');b.dataset.k=k;b.className='hub-tab';
        b.innerHTML=`<span>${label}</span><span class="cnt"></span>`;
        b.onclick=()=>switchHubTab(k);
        tabs.appendChild(b);
      });
      tabs._built=true;
      // The modal animates its width (Proxies view is wider), so the tab bar resizes mid-flight:
      // keep the pill glued to the active tab on every size change.
      if(window.ResizeObserver){
        const ro=new ResizeObserver(()=>hubPill(true));
        ro.observe(tabs);tabs.querySelectorAll('.hub-tab').forEach(b=>ro.observe(b));
        tabs._ro=ro;
      }
    }
    tabs.querySelectorAll('.hub-tab').forEach(b=>{
      const k=b.dataset.k,n=counts[k]||0;
      b.setAttribute('aria-selected',_hubSec===k);
      b.classList.toggle('on',_hubSec===k);b.classList.toggle('zero',!n);
      b.querySelector('.cnt').textContent=n;
    });
    hubPill();
  }
  const items=_hubData.filter(h=>h.sec===_hubSec&&match(h));
  const isPx=_hubSec==='proxies';
  if(isPx&&_pxGroup&&!items.some(h=>h.group===_pxGroup))_pxGroup='';
  const shown=(isPx&&_pxGroup)?items.filter(h=>h.group===_pxGroup):items;
  const bd=box.parentNode;if(bd)bd.classList.toggle('px',isPx&&items.length>0);
  const md=box.closest('.modal');if(md)md.classList.toggle('px-mode',isPx);
  box.classList.toggle('px-grid',isPx&&items.length>0);
  updateProxySide(box,items);
  if(swap){box.classList.remove('swap','swapL','swapR');void box.offsetWidth;box.classList.add(_hubDir>0?'swapR':_hubDir<0?'swapL':'swap')}
  if(!items.length){
    const other=Object.values(counts).reduce((a,b)=>a+b,0);
    box.innerHTML='<div class="empty">'+(q&&other?'No matches in this tab, but '+other+' in the other tabs.':'Nothing found.')+'</div>';
    return;
  }
  box.innerHTML='';
  if(isPx){
    const cr=document.createElement('div');cr.className='hub-credit';cr.textContent='\u2764\ufe0f '+_proxyCredit;box.appendChild(cr);
    if(_pxGroup){const hd=document.createElement('div');hd.className='px-head';hd.innerHTML=`<div><b>${esc(_pxGroup)}</b><small>If one link is blocked, try another.</small></div><span>${shown.length} link${shown.length===1?'':'s'}</span>`;box.appendChild(hd)}
  }
  let _lastGrp=null;
  const _one=shown.length===1;
  shown.forEach(h=>{
    if(h.group&&!(isPx&&_pxGroup)&&h.group!==_lastGrp){_lastGrp=h.group;const n=items.filter(x=>x.group===h.group).length;const gh=document.createElement('div');gh.className='hub-grp';gh.dataset.g=h.group;gh.innerHTML=`<span>${esc(h.group)}</span><i>${n}</i>`;box.appendChild(gh)}
    const c=HUB_COLORS[(h.color||'').toLowerCase()]||HUB_COLORS.grey;
    const row=document.createElement('div');
    row.className='list-row hub-row'+(_one?' one':'');
    row.innerHTML=`<div class="hub-ic" style="background:${c.bg};color:${c.fg}">${esc((h.icon||h.name.slice(0,2)).toString().slice(0,4))}</div>
      <div class="nm"><div class="hub-nm">${esc(h.name)}</div>${h.desc?`<div class="hub-desc">${esc(h.desc)}</div>`:''}</div>
      <div class="hub-arrow">↗</div>`;
    row.onclick=()=>{closeGameHubs();launchHub(h)};
    box.appendChild(row);
  });
}
// Launches a hub the same way VUS does: raw.githubusercontent.com links are actual page
// source (served as plain text, not rendered HTML), so they're fetched and written into a
// fresh about:blank tab. Anything else is a normal link and just opens directly.
const HUB_MODE_KEY='ich.hubOpenMode';
// Saved to the account (users/$id/settings/hubOpenMode) so it follows you across devices;
// localStorage is just a cache. Default is the in-site iframe viewer.
function hubOpenMode(){
  try{const v=ME&&ME.settings&&ME.settings.hubOpenMode;if(v==='iframe'||v==='tab')return v}catch(_){}
  try{const v=localStorage.getItem(HUB_MODE_KEY);if(v==='iframe'||v==='tab')return v}catch(_){}
  return 'iframe';
}
function setHubOpenMode(v){
  try{localStorage.setItem(HUB_MODE_KEY,v)}catch(_){}
  try{if(ME&&ME.id!=null)DB.setSettingKey(ME.id,'hubOpenMode',v).catch(()=>{})}catch(_){}
}
let _hubFsHandler=null;
function closeHubFrame(){
  const e=document.getElementById('hubFrameBox');if(!e||e.classList.contains('closing'))return;
  try{if(document.fullscreenElement)document.exitFullscreen()}catch(_){}
  if(_hubFsHandler){document.removeEventListener('fullscreenchange',_hubFsHandler);document.removeEventListener('webkitfullscreenchange',_hubFsHandler);_hubFsHandler=null}
  e.classList.add('closing');
  setTimeout(()=>e.remove(),240);
}
// Small stroke icons for the viewer bar (inherit colour from the button).
const _hfSvg=d=>`<svg class="hf-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const HF_IC={
  close:_hfSvg('<path d="M18 6 6 18M6 6l12 12"/>'),
  full:_hfSvg('<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  exit:_hfSvg('<path d="M3 8h3a2 2 0 0 0 2-2V3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3"/>'),
  tab:_hfSvg('<path d="M15 3h6v6M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>')
};
// In-site viewer: shown when the "open in iframe" setting is on.
function openHubFrame(h,srcdoc){
  const old=document.getElementById('hubFrameBox');if(old)old.remove();
  const box=document.createElement('div');box.id='hubFrameBox';box.className='hub-frame-box';
  box.innerHTML=`<div class="hub-frame-wrap"><div class="hub-frame-bar"><button type="button" class="hf-btn hf-close" id="hfClose">${HF_IC.close}<span>Close</span></button><div class="hf-title"><i class="hf-dot"></i><span class="hf-name">${esc(h.name)}</span></div><div class="hf-actions"><button type="button" class="hf-btn" id="hfFull">${HF_IC.full}<span>Fullscreen</span></button><button type="button" class="hf-btn hf-primary" id="hfTab">${HF_IC.tab}<span>New tab</span></button></div></div></div><div class="hf-prog"><i></i></div><div class="hf-stage"><div class="hf-loading"><div class="hf-spin"></div><b>Loading ${esc(h.name)}…</b><small>Some sites take a few seconds</small></div><iframe id="hfFrame" allow="fullscreen; autoplay; clipboard-write; gamepad; microphone; camera" allowfullscreen referrerpolicy="no-referrer"></iframe></div><button type="button" class="hf-exit" id="hfExit">⤡ Exit fullscreen</button>`;
  document.body.appendChild(box);
  const fr=box.querySelector('#hfFrame'),fb=box.querySelector('#hfFull');
  // reveal the page smoothly once it has loaded (or after a safety timeout)
  let shown=false;
  const reveal=()=>{if(shown)return;shown=true;setTimeout(()=>box.classList.add('loaded'),90)};
  fr.addEventListener('load',reveal);setTimeout(reveal,15000);
  if(srcdoc!=null)fr.srcdoc=srcdoc;else fr.src=h.url;
  // Fullscreen puts the IFRAME itself (just the page, no bar) into fullscreen.
  const canFs=!!(fr.requestFullscreen||fr.webkitRequestFullscreen);
  const isFs=()=>document.fullscreenElement===fr||document.webkitFullscreenElement===fr||box.classList.contains('bare');
  const paint=()=>{const f=isFs();fb.innerHTML=(f?HF_IC.exit:HF_IC.full)+'<span>'+(f?'Exit fullscreen':'Fullscreen')+'</span>';box.classList.toggle('is-fs',f)};
  fb.onclick=()=>{
    if(!canFs){box.classList.toggle('bare');paint();return}   // e.g. iOS: fill the screen and hide the bar
    if(isFs())(document.exitFullscreen||document.webkitExitFullscreen).call(document);
    else{const p=(fr.requestFullscreen||fr.webkitRequestFullscreen).call(fr);if(p&&p.catch)p.catch(()=>{box.classList.add('bare');paint()})}
  };
  box.querySelector('#hfExit').onclick=()=>{box.classList.remove('bare');paint()};
  _hubFsHandler=paint;
  document.addEventListener('fullscreenchange',paint);document.addEventListener('webkitfullscreenchange',paint);
  box.querySelector('#hfClose').onclick=closeHubFrame;
  // "New tab" from the viewer: raw.githubusercontent.com serves source as plain text, so write the
  // already-fetched page (or fetch it) into about:blank, exactly like the non-iframe mode does.
  box.querySelector('#hfTab').onclick=()=>{
    if(!h.url.includes('raw.githubusercontent.com')){window.open(h.url,'_blank','noopener');return}
    if(srcdoc!=null){openHubBlank(h,srcdoc);return}
    toast('Loading '+h.name+'...');
    fetch(h.url+(h.url.includes('?')?'&':'?')+'v='+Date.now(),{cache:'no-store'})
      .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()})
      .then(t=>openHubBlank(h,t))
      .catch(()=>toast('Failed to load '+h.name,'bad'));
  };
}
// Writes fetched page source into a fresh about:blank tab (so it renders instead of showing raw text).
function openHubBlank(h,text){
  const win=window.open('about:blank','_blank');
  if(!win){toast('Popup blocked — allow popups for this site','bad');return}
  win.document.open();win.document.write(text);win.document.close();
}
function launchHub(h){
  if(!h.url)return;
  const asFrame=hubOpenMode()==='iframe';
  if(!h.url.includes('raw.githubusercontent.com')){
    if(asFrame)openHubFrame(h);else window.open(h.url,'_blank','noopener');
    return;
  }
  toast('Loading '+h.name+'...');
  fetch(h.url+(h.url.includes('?')?'&':'?')+'v='+Date.now(),{cache:'no-store'})
    .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()})
    .then(text=>{
      if(asFrame){openHubFrame(h,text);return}
      openHubBlank(h,text);
    })
    .catch(()=>{toast('Failed to load '+h.name,'bad')});
}
