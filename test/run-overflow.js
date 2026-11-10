/* test/run-overflow.js
 * Generic sweep for the bug class behind the overlapping-messages report: an element whose box
 * is SHORTER than the content inside it, with overflow visible, so that content paints on top of
 * whatever comes next.
 *
 * .messages is a flex column, so its children are flex items, and a flex item is shrinkable
 * unless something stops it. Any container in the app built the same way can collapse the same
 * way - this walks the real DOM across every surface and both widths looking for it, rather than
 * trusting that .msg was the only place it could happen.
 *
 *     node test/run-overflow.js
 *
 * Development only - not referenced by the site.
 */
const {chromium}=require('playwright');
const path=require('path');
const SEED=JSON.parse(JSON.stringify(require('./seed.js')));

const NOW=Date.now();
[1,2,3,4,5].forEach(i=>SEED.tosAccepted[i]={v:6,at:NOW});
SEED.rulesAgreed={1:{v:99,at:NOW},2:{v:99,at:NOW},3:{v:99,at:NOW}};

/* Content that stresses layout: a very long unbroken token, a wall of text, a long display name.
   Unbreakable strings are the usual way a "fine on my machine" layout falls apart. */
const LONG='Supercalifragilistic'+'x'.repeat(90);
const WALL=('the quick brown fox jumps over the lazy dog. ').repeat(40);
/* #general is keyed 'global' (CFG.GLOBAL_ROOM); 'general' would be an orphan room nothing renders. */
SEED.messages.global=Object.assign({},SEED.messages.global,{
  z1:{senderId:1,text:LONG,at:NOW-90000,pings:[],images:[]},
  z2:{senderId:2,text:WALL,at:NOW-80000,pings:[],images:[]},
  z3:{senderId:1,text:'https://example.com/'+LONG,at:NOW-70000,pings:[],images:[]},
  z4:{senderId:3,text:'@everyone '+WALL.slice(0,600),at:NOW-60000,pings:[],images:[]}
});

let fails=0;
const ok=(n,v,x)=>{if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v||x===undefined?'':' '+JSON.stringify(x)))};

/* Runs in the page. Reports elements that paint outside their own box. */
const SCAN=()=>{
  const bad=[];
  const label=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+
    (e.className&&e.className.toString?'.'+e.className.toString().trim().split(/\s+/).slice(0,2).join('.'):'');
  document.querySelectorAll('body *').forEach(e=>{
    const cs=getComputedStyle(e);
    if(cs.display==='none'||cs.visibility==='hidden'||!e.getClientRects().length)return;
    const r=e.getBoundingClientRect();
    if(r.width<2||r.height<2)return;
    const parent=e.parentElement;
    if(!parent)return;
    const pcs=getComputedStyle(parent);
    const isFlexItem=pcs.display==='flex'||pcs.display==='inline-flex';
    // A flex item squashed below its own content, with nothing clipping the spill.
    /* 6px, not 0: emoji and tall glyphs routinely paint a couple of pixels past their line box
       (.lch-ic is font-size:30px/line-height:1 and overshoots by 3), which is cosmetic and not
       the failure being hunted. A collapsed flex row overshoots by hundreds - the one that
       started this was 166-325px - so the gap between noise and signal is wide. */
    if(isFlexItem&&cs.overflowY==='visible'&&e.scrollHeight-e.clientHeight>6){
      // ignore things that are deliberately clipped by an ancestor
      bad.push({el:label(e),parent:label(parent),box:Math.round(r.height),
                content:e.scrollHeight,spill:e.scrollHeight-e.clientHeight,kind:'squashed-flex-item'});
    }
  });
  // horizontal page overflow - the other visible symptom of a layout giving way
  const hOver=Math.round(document.documentElement.scrollWidth-window.innerWidth);
  return{bad:bad.slice(0,25),count:bad.length,hOver};
};

const SURFACES=[
  ['chat (general)',      ()=>{}],
  ['user settings',       ()=>__T.openSettings(false)],
  ['games hub',           ()=>__T.modalGameHubs()],
  ['shop',                ()=>__T.openShop()],
  ['server settings',     ()=>__T.openServerSettings('ich')],
  ['add server',          ()=>__T.openAddServer()],
  ['create server',       ()=>__T.openCreateServer()],
  ['join server',         ()=>__T.openJoinServer()],
  ['create channel',      ()=>__T.openCreateChannel('ich','text')],
  ['invite dialog',       ()=>__T.openInvite('ich')],
  ['channel settings',    ()=>__T.openChannelSettings('ich',__T.DModel.channel('ich','general'))],
  ['daily spin',          ()=>__T.openSpin()],
  ['member manager',      ()=>__T.openMemberManager('ich',2)]
];

(async()=>{
  const browser=await chromium.launch();
  for(const [vpName,vp] of [['desktop',{width:1440,height:900}],['phone',{width:390,height:844}]]){
    console.log('\n===== '+vpName+' ('+vp.width+'x'+vp.height+') =====');
    const page=await browser.newPage({viewport:vp});
    const errs=[],cerrs=[];
    page.on('pageerror',e=>errs.push(e.message));
    page.on('console',m=>{if(m.type()==='error')cerrs.push(m.text())});

    await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
    await page.evaluate(s=>{
      window.__FAKE.seed(s);
      ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
      window.__FAKE.signIn('suki@itsuki.local');window.__APP_START();
    },SEED);
    await page.waitForSelector('#chatPage:not(.hidden)',{timeout:20000});
    await page.waitForTimeout(1500);
    await page.evaluate(()=>document.querySelectorAll('.modal-bg,.gc-overlay').forEach(e=>e.remove()));

    for(const [name,fn] of SURFACES){
      const before=errs.length;
      try{
        await page.evaluate(fn);
        await page.waitForTimeout(700);
      }catch(e){
        fails++;console.log('  FAIL  '+name+' threw -> '+e.message.split('\n')[0]);
        continue;
      }
      const r=await page.evaluate(SCAN);
      ok(name+': nothing paints outside its box',r.count===0,r.bad.slice(0,4));
      ok(name+': no sideways page scroll',r.hOver<=0,r.hOver);
      ok(name+': opened without throwing',errs.length===before,errs.slice(before,before+2));
      // close whatever opened
      await page.keyboard.press('Escape');await page.waitForTimeout(250);
      await page.evaluate(()=>{
        const r=document.getElementById('modalRoot');if(r)r.innerHTML='';
        document.querySelectorAll('.dmodal-bg,.dset,.modal-bg,.gc-overlay').forEach(e=>e.remove());
      });
      await page.waitForTimeout(200);
    }

    console.log('  page errors:',errs.length,'| console errors:',cerrs.length);
    [...new Set(errs)].slice(0,5).forEach(e=>console.log('    !! '+e.split('\n')[0]));
    const net=cerrs.filter(e=>/ERR_TUNNEL|ERR_INTERNET|net::|Failed to load resource/.test(e));
    const real=[...new Set(cerrs)].filter(e=>!/ERR_TUNNEL|ERR_INTERNET|net::|Failed to load resource/.test(e));
    console.log('    (of those, '+net.length+' are blocked network fetches - offline sandbox, not a code fault)');
    real.slice(0,6).forEach(e=>console.log('    ?? '+e.slice(0,160)));
    ok('no non-network console errors',real.length===0,real.slice(0,3));
    await page.close();
  }
  await browser.close();
  console.log(fails?'\n'+fails+' OVERFLOW CHECK(S) FAILED':'\nALL OVERFLOW CHECKS PASSED');
  process.exit(fails?1:0);
})();
