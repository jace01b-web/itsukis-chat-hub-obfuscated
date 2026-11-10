/* test/run-layout.js
 * Message layout: nothing a message contains may paint outside that message's own row.
 *
 * Guards the overlapping-messages bug: .messages is a flex COLUMN, so every .msg is a flex
 * item. A flex item is shrinkable by default and is only saved from being squashed below its
 * own content by min-height's `auto` value. 27-discord-exact.css gives .dl-cont an explicit
 * min-height, which replaces that protection - so once the channel was long enough to overflow,
 * continuation rows collapsed while the image inside kept full height, and the picture painted
 * straight over the messages below it. .msg therefore carries flex:0 0 auto.
 *
 *     node test/run-layout.js
 *
 * Development only - not referenced by the site.
 */
const {chromium}=require('playwright');
const path=require('path'),fs=require('fs');
const SEED=JSON.parse(JSON.stringify(require('./seed.js')));

let fails=0;
const ok=(n,v,x)=>{if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v||x===undefined?'':' ['+JSON.stringify(x)+']'))};

/* Real JPEGs - safeImg() in text-and-media.js only accepts data:image/jpeg, so a placeholder
   string would be dropped and the test would pass against nothing. They are drawn in the page
   itself with canvas.toDataURL, which keeps this test free of any image library. */
const SIZES={WIDE:[1600,900],TALL:[900,1600],HUGE:[2600,1800]};
const makeImages=sizes=>{
  const out={};
  Object.keys(sizes).forEach(k=>{
    const [w,h]=sizes[k];
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const x=c.getContext('2d');
    x.fillStyle='#46465f';x.fillRect(0,0,w,h);
    x.strokeStyle='#ff78b4';x.lineWidth=12;x.strokeRect(6,6,w-12,h-12);
    out[k]=c.toDataURL('image/jpeg',0.4);
  });
  return out;
};

const NOW=Date.now();
[1,2,3,4,5].forEach(i=>SEED.tosAccepted[i]={v:6,at:NOW});
SEED.rulesAgreed={1:{v:99,at:NOW},2:{v:99,at:NOW},3:{v:99,at:NOW}};
/* The shape that broke: a sender posts several times in a row (so the later ones are
   continuation rows) and some of those carry images. IM.* is filled in inside the page. */
const announcements=(IM,NOW)=>({
  a1:{senderId:1,text:'@everyone dont forget to join! Invite code: QAH94ARD',at:NOW-600000,pings:[],images:[]},
  a2:{senderId:1,text:'',at:NOW-599000,pings:[],images:[IM.WIDE]},        // continuation + image
  a3:{senderId:1,text:'another continuation',at:NOW-598000,pings:[],images:[IM.TALL]},
  a4:{senderId:2,text:'different sender',at:NOW-500000,pings:[],images:[]},
  a5:{senderId:1,text:'Fixing upd pls wait',at:NOW-400000,pings:[],images:[IM.HUGE]},
  a6:{senderId:1,text:'might not be able to fix today',at:NOW-399000,pings:[],images:[]},
  a7:{senderId:3,text:'Why ru images so big',at:NOW-300000,pings:[],images:[IM.TALL,IM.WIDE]},
  a8:{senderId:1,text:'last one',at:NOW-200000,pings:[],images:[]}
});

const VIEWPORTS=[
  ['desktop',{width:1400,height:900}],
  ['laptop', {width:1100,height:700}],
  ['tablet', {width:820,height:1100}],
  ['phone',  {width:412,height:915}],
  ['narrow', {width:360,height:740}]
];

(async()=>{
  const browser=await chromium.launch();
  const OUT=path.join(__dirname,'shots');fs.mkdirSync(OUT,{recursive:true});

  for(const [label,vp] of VIEWPORTS){
    console.log('\n--- '+label+' ('+vp.width+'x'+vp.height+') ---');
    const page=await browser.newPage({viewport:vp});
    const errs=[];page.on('pageerror',e=>errs.push(e.message));

    await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
    await page.evaluate(({s,sizes,now,mkSrc,annSrc})=>{
      const IM=new Function('sizes','return ('+mkSrc+')(sizes)')(sizes);
      s.messages.announcements=new Function('IM','NOW','return ('+annSrc+')(IM,NOW)')(IM,now);
      window.__FAKE.seed(s);
      ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
      window.__FAKE.signIn('suki@itsuki.local');window.__APP_START();
    },{s:SEED,sizes:SIZES,now:NOW,mkSrc:makeImages.toString(),annSrc:announcements.toString()});
    await page.waitForSelector('#chatPage:not(.hidden)',{timeout:20000});
    await page.waitForTimeout(1200);
    await page.evaluate(()=>{
      const c=[...document.querySelectorAll('.dch')].find(e=>/announce/i.test(e.textContent));
      if(c)c.click();
    });
    await page.waitForTimeout(2500);
    await page.evaluate(()=>document.querySelectorAll('.modal-bg,.gc-overlay').forEach(e=>e.remove()));
    await page.waitForTimeout(300);

    const r=await page.evaluate(()=>{
      const rows=[...document.querySelectorAll('.msg')];
      let spill=0,worstSpill=0,overlap=0,worstOverlap=0,shrunk=0,imgs=0,widest=0;
      const box=document.querySelector('.messages').getBoundingClientRect();
      rows.forEach((m,i)=>{
        const mb=m.getBoundingClientRect();
        // 1. a row must be at least as tall as the content inside it
        const inner=m.firstElementChild&&m.firstElementChild.getBoundingClientRect();
        if(inner&&inner.height-mb.height>2){shrunk++;}
        // 2. no image may paint past the bottom of its own row
        m.querySelectorAll('img').forEach(im=>{
          const ib=im.getBoundingClientRect();
          if(!ib.height)return;
          imgs++;
          widest=Math.max(widest,Math.round(ib.width));
          const over=ib.bottom-mb.bottom;
          if(over>2){spill++;worstSpill=Math.max(worstSpill,Math.round(over))}
        });
        // 3. consecutive rows must not overlap
        const next=rows[i+1];
        if(next){
          const nb=next.getBoundingClientRect();
          const ov=mb.bottom-nb.top;
          if(ov>2){overlap++;worstOverlap=Math.max(worstOverlap,Math.round(ov))}
        }
      });
      return{spill,worstSpill,overlap,worstOverlap,shrunk,imgs,widest,
             listW:Math.round(box.width),
             docOverflow:Math.round(document.documentElement.scrollWidth-window.innerWidth)};
    });

    ok('images actually rendered ('+r.imgs+')',r.imgs>0,r);
    ok('no image paints outside its message row',r.spill===0,{spilling:r.spill,worst:r.worstSpill+'px'});
    ok('no message row overlaps the next',r.overlap===0,{overlapping:r.overlap,worst:r.worstOverlap+'px'});
    ok('no row is squashed below its content',r.shrunk===0,{squashed:r.shrunk});
    ok('no image is wider than the message list',r.widest<=r.listW,{widest:r.widest,list:r.listW});
    ok('the page does not scroll sideways',r.docOverflow<=0,r.docOverflow);
    ok('no page errors',errs.length===0,errs.slice(0,3));

    await page.screenshot({path:path.join(OUT,'layout-'+label+'.png')});
    await page.close();
  }

  await browser.close();
  console.log(fails?'\n'+fails+' LAYOUT CHECK(S) FAILED':'\nALL LAYOUT CHECKS PASSED');
  process.exit(fails?1:0);
})();
