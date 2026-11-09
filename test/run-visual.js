/* test/run-visual.js
 * Screenshots every layout the site has to look right in, with the TOS gate already accepted so
 * the actual UI is visible. Also measures the metrics that have to match Discord.
 *
 *     node test/build-harness.js && node test/run-visual.js
 *
 * Development only - not referenced by the site.
 */
const {chromium}=require('playwright');
const path=require('path'),fs=require('fs');
const OUT=process.env.OUT_DIR||path.join(__dirname,'shots-visual');
const SEED=JSON.parse(JSON.stringify(require('./seed.js')));

// the gate is version-gated; accept the current version so the app is reachable
Object.keys(SEED.tosAccepted||{}).forEach(k=>{SEED.tosAccepted[k]={v:99,at:Date.now()}});

const VIEWS=[
  {n:'desktop-1440',    w:1440,h:900},
  {n:'desktop-1920',    w:1920,h:1080},
  {n:'laptop-1280',     w:1280,h:800},
  {n:'tablet-900',      w:900, h:1200},
  {n:'tablet-820',      w:820, h:1180},
  {n:'phone-430',       w:430, h:932},
  {n:'phone-390',       w:390, h:844},
  {n:'phone-360',       w:360, h:740},
  {n:'phone-320',       w:320, h:568},
  {n:'phone-landscape', w:844, h:390},
  {n:'phone-landscape-sm',w:740,h:360}
];

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const browser=await chromium.launch();
  const pageErrors=[],consoleErrors=[];
  const url='file://'+path.join(__dirname,'harness.html')+'?manual';
  const problems=[];

  for(const v of VIEWS){
    const ctx=await browser.newContext({viewport:{width:v.w,height:v.h},deviceScaleFactor:2,
      hasTouch:v.w<=820,isMobile:v.w<=820});
    const page=await ctx.newPage();
    page.on('pageerror',e=>pageErrors.push(v.n+': '+e.message));
    page.on('console',m=>{if(m.type()==='error'&&!/ERR_TUNNEL|Failed to load resource/.test(m.text()))consoleErrors.push(v.n+': '+m.text())});
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.evaluate(seed=>{
      window.__FAKE.seed(seed);
      ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
      window.__FAKE.signIn('suki@itsuki.local');
      window.__APP_START();
    },SEED);
    try{await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000})}catch(e){}
    await page.waitForTimeout(1400);
    // any leftover modal would hide the app
    await page.evaluate(()=>{const m=document.getElementById('modalRoot');if(m)m.innerHTML=''});
    await page.waitForTimeout(250);

    await page.screenshot({path:path.join(OUT,v.n+'.png')});

    const m=await page.evaluate(()=>{
      const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();
        return{w:Math.round(b.width),h:Math.round(b.height),x:Math.round(b.left),y:Math.round(b.top),
               vis:getComputedStyle(e).display!=='none'&&b.width>0}};
      const cs=(s,p)=>{const e=document.querySelector(s);return e?getComputedStyle(e)[p]:null};
      return{
        docW:document.documentElement.scrollWidth,win:window.innerWidth,
        overflow:document.documentElement.scrollWidth>window.innerWidth+1,
        rail:r('#dlRail'),side:r('#sidebar'),main:r('#chatPage .main'),
        members:r('#dlMembers'),topbar:r('#chatPage .topbar'),
        chRow:r('.dch'),chFont:cs('.dch','fontSize'),
        memRow:r('.dl-mem'),
        userbar:r('#dlUser'),
        composer:r('#chatPage .composer .row'),
        msgFont:cs('.messages .bubble','fontSize'),
        avatar:r('.messages .msg .avatar'),
        catFont:cs('.dcat','fontSize'),
        // nothing may be cut off the bottom
        composerBottom:(()=>{const e=document.querySelector('#chatPage .composer');
          return e?Math.round(e.getBoundingClientRect().bottom):null})()
      };
    });
    const p=[];
    if(m.overflow)p.push('HORIZONTAL OVERFLOW ('+m.docW+' > '+m.win+')');
    if(m.composerBottom&&m.composerBottom>v.h+2)p.push('composer is off the bottom ('+m.composerBottom+' > '+v.h+')');
    if(v.w>=1025){
      if(m.rail&&m.rail.w!==72)p.push('rail is '+m.rail.w+'px, Discord is 72');
      if(m.side&&Math.abs(m.side.w-240)>2)p.push('sidebar is '+m.side.w+'px, Discord is 240');
      if(m.members&&m.members.vis&&Math.abs(m.members.w-240)>2)p.push('member list is '+m.members.w+'px, Discord is 240');
      if(m.chRow&&m.chRow.h!==32)p.push('channel row is '+m.chRow.h+'px, Discord is 32');
      if(m.memRow&&m.memRow.h!==42)p.push('member row is '+m.memRow.h+'px, Discord is 42');
      if(m.topbar&&m.topbar.h!==48)p.push('header is '+m.topbar.h+'px, Discord is 48');
      if(m.userbar&&m.userbar.h!==52)p.push('user panel is '+m.userbar.h+'px, Discord is 52');
      if(m.chFont&&m.chFont!=='16px')p.push('channel font is '+m.chFont+', Discord is 16px');
      if(m.msgFont&&m.msgFont!=='16px')p.push('message font is '+m.msgFont+', Discord is 16px');
      if(m.avatar&&m.avatar.w!==40)p.push('message avatar is '+m.avatar.w+'px, Discord is 40');
    }
    if(v.w<=820){
      if(m.chRow&&m.chRow.h<40)p.push('channel row is only '+m.chRow.h+'px on a phone (needs >=40 for touch)');
    }
    problems.push([v.n,p,m]);
    await ctx.close();
  }

  console.log('\n=== LAYOUT ===');
  let bad=0;
  problems.forEach(([n,p,m])=>{
    if(p.length){bad++;console.log('  '+n+':');p.forEach(x=>console.log('      - '+x))}
    else console.log('  OK   '+n+'   rail '+(m.rail&&m.rail.vis?m.rail.w:'-')+
      ' side '+(m.side?m.side.w:'-')+' ch '+(m.chRow?m.chRow.h:'-')+
      ' mem '+(m.members&&m.members.vis?m.members.w:'drawer'));
  });
  console.log('\npage errors: '+pageErrors.length);pageErrors.slice(0,10).forEach(e=>console.log('  '+e));
  console.log('console errors: '+consoleErrors.length);consoleErrors.slice(0,10).forEach(e=>console.log('  '+e));
  console.log('\nscreenshots in '+OUT);
  await browser.close();
  process.exit(bad||pageErrors.length?1:0);
})();
