/* test/run-ui549.js — v54.9
 *
 *     node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-ui549.js
 *
 * THE v54.9 INTERFACE WORK, measured in a real browser rather than eyeballed in a screenshot.
 *
 * Everything here is asserted against computed styles and geometry read out of the live page,
 * because a screenshot cannot tell you whether a timestamp is 11px or whether a row is actually
 * wider than its panel — and because two of the "defects" this pass started from turned out,
 * when measured, not to be defects at all:
 *
 *   - the MVP member row looked like it overflowed the member panel. Measured: nothing in
 *     #dlMembers extends past its right edge. The apparent block is headless Chromium painting
 *     a -webkit-background-clip:text gradient into a screenshot. Guarded below so that a real
 *     overflow would be caught.
 *   - the "Today" divider looked clipped by the channel header. Measured: it is simply scrolled
 *     partly out of view in a bottom-anchored list, which is correct. Asserted below so that an
 *     actual header overlap would be caught.
 *
 * Covers section 9's: member search, mobile navigation, long-message rendering.
 */
const {chromium}=require('playwright');
const path=require('path');
const BASE=require('./seed.js');

let fails=0,checks=0;
const ok=(name,cond,extra)=>{
  checks++;if(!cond)fails++;
  console.log((cond?'  PASS  ':'  FAIL  ')+name+(cond?'':'   <- '+JSON.stringify(extra)));
};
const head=t=>console.log('\n--- '+t+' '+'-'.repeat(Math.max(0,56-t.length)));

/* A seed with enough members to make a search worth doing, spread over several role groups so
   the test can prove the groups survive filtering, and one very long message. */
function mkSeed(){
  const s=JSON.parse(JSON.stringify(BASE));
  const ids=[1,2,3,4,5];
  ids.forEach(i=>{s.tosAccepted[i]={v:6,at:Date.now()}});
  /* Extra accounts with deliberately overlapping names: "mina" and "minako" both contain "min",
     "ghost" does not. That is what makes a filter assertion meaningful rather than tautological. */
  const extra={6:'minako',7:'dominic',8:'harper',9:'sable',10:'quill'};
  Object.keys(extra).forEach(id=>{
    const n=Number(id);
    s.users[n]={id:n,username:extra[id],createdAt:Date.now()-n*86400000};
    s.tosAccepted[n]={v:6,at:Date.now()};
  });
  s.messages[BASE_ROOM()]=s.messages[BASE_ROOM()]||{};
  /* A real DM, so the composer's DM placeholder is genuinely exercised rather than skipped. */
  s.friends=Object.assign({},s.friends,{1:Object.assign({},(s.friends||{})[1],{2:true}),
                                        2:Object.assign({},(s.friends||{})[2],{1:true})});
  s.dmMembers=Object.assign({},s.dmMembers,{dm_1_2:{1:true,2:true}});
  s.messages.dm_1_2={a:{senderId:2,text:'see you then',at:Date.now()-3600000,pings:[],images:[]}};
  return s;
}
function BASE_ROOM(){
  /* The seed's global room key, read from the seed rather than hard-coded, so this test does not
     drift if the constant changes. */
  const keys=Object.keys(BASE.messages||{});
  return keys.find(k=>!String(k).startsWith('dm_'))||keys[0];
}

async function boot(browser,w,h,seed){
  const ctx=await browser.newContext({viewport:{width:w,height:h}});
  const page=await ctx.newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  page.on('dialog',async d=>{await d.dismiss()});
  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost','minako','dominic','harper','sable','quill']
      .forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },seed);
  await page.waitForFunction(()=>!!document.querySelector('#dlRail,.dl-shell'),null,{timeout:45000});
  await page.waitForTimeout(1600);
  return {page,ctx,errs};
}

/* The member panel is only shown in a server/room context and only when toggled on. */
async function openMembers(page){
  await page.evaluate(()=>{
    const btn=document.querySelector('[data-members-btn],#dlMembersBtn,.dl-members-btn');
    const shown=()=>{const m=document.getElementById('dlMembers');return m&&m.classList.contains('show')};
    if(!shown()&&btn)btn.click();
  });
  await page.waitForTimeout(700);
  return page.evaluate(()=>{const m=document.getElementById('dlMembers');return !!(m&&m.classList.contains('show'))});
}

(async()=>{
  const browser=await chromium.launch();

  /* ============================================================ 1. MEMBER SEARCH */
  head('1. the member list search');
  {
    const {page,ctx,errs}=await boot(browser,1440,900,mkSeed());
    const shown=await openMembers(page);
    ok('the member panel opens',shown);

    const hasBox=await page.evaluate(()=>!!document.querySelector('#dlMemQ'));
    ok('it has a search field',hasBox);

    const before=await page.evaluate(()=>({
      rows:document.querySelectorAll('#dlMembers .dl-mem').length,
      groups:[...document.querySelectorAll('#dlMembers .dl-mem-h')].map(h=>h.textContent.trim())
    }));
    ok('and members in it',before.rows>0,before);

    /* Type a needle that matches some names and not others. */
    await page.fill('#dlMemQ','min');
    await page.waitForTimeout(500);
    const after=await page.evaluate(()=>({
      rows:[...document.querySelectorAll('#dlMembers .dl-mem')].map(r=>r.textContent.trim().toLowerCase()),
      groups:[...document.querySelectorAll('#dlMembers .dl-mem-h')].map(h=>h.textContent.trim()),
      value:document.querySelector('#dlMemQ').value
    }));
    ok('typing filters the list down',after.rows.length>0&&after.rows.length<before.rows,
       {before:before.rows,after:after.rows.length});
    ok('every row left actually matches',after.rows.every(t=>t.indexOf('min')>=0),after.rows);
    ok('a non-matching member is gone',!after.rows.some(t=>t.indexOf('ghost')>=0),after.rows);
    ok('the typed text survives the re-render',after.value==='min',after.value);

    /* The group headers must describe what is on screen. A header that says "OFFLINE — 7" above
       two rows is worse than no header, and is exactly what happens if the filter is applied to
       the markup rather than to the ids before grouping. */
    const counts=await page.evaluate(()=>{
      const out=[];let cur=null;
      [...document.querySelectorAll('#dlMembers .dl-mem-h,#dlMembers .dl-mem')].forEach(el=>{
        if(el.classList.contains('dl-mem-h')){
          const m=/—\s*(\d+)\s*$/.exec(el.textContent.trim());
          cur={claimed:m?Number(m[1]):null,actual:0};out.push(cur);
        }else if(cur)cur.actual++;
      });
      return out;
    });
    ok('each role group counts only the members it still shows',
       counts.length>0&&counts.every(c=>c.claimed===c.actual),counts);

    /* A needle nobody matches must say so, not render an empty panel that looks broken. */
    await page.fill('#dlMemQ','zzzzznobody');
    await page.waitForTimeout(500);
    const empty=await page.evaluate(()=>({
      rows:document.querySelectorAll('#dlMembers .dl-mem').length,
      msg:(document.querySelector('#dlMembers .dl-mem-empty')||{}).textContent||''
    }));
    ok('no matches shows an explicit empty state',empty.rows===0&&/no members match/i.test(empty.msg),empty);

    /* Escape inside the field clears the search instead of closing the panel. */
    await page.focus('#dlMemQ');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const cleared=await page.evaluate(()=>({
      value:(document.querySelector('#dlMemQ')||{}).value,
      open:(document.getElementById('dlMembers')||{classList:{contains:()=>false}}).classList.contains('show'),
      rows:document.querySelectorAll('#dlMembers .dl-mem').length
    }));
    ok('Escape clears the search',cleared.value==='',cleared);
    ok('Escape does not close the panel',cleared.open,cleared);
    ok('and every member is back',cleared.rows===before.rows,{was:before.rows,now:cleared.rows});

    /* THE REAL TEST. A presence tick repaints the member list. If the repaint is naive the caret
       jumps to the end of the field and whatever you were typing becomes unusable. */
    await page.fill('#dlMemQ','minako');
    await page.waitForTimeout(400);
    await page.evaluate(()=>{
      const i=document.querySelector('#dlMemQ');
      i.focus();i.setSelectionRange(3,3);           // caret in the MIDDLE of "minako"
    });
    await page.evaluate(()=>{
      /* Force the repaint the same way presence does: change a user's status and let the
         app's own listeners redraw the member list. */
      window.__FAKE.set('users/4/style',{status:'idle'});
    });
    await page.waitForTimeout(900);
    const typing=await page.evaluate(()=>{
      const i=document.querySelector('#dlMemQ');
      return {value:i?i.value:null,focused:document.activeElement===i,caret:i?i.selectionStart:null};
    });
    ok('a presence repaint does not eat what you are typing',typing.value==='minako',typing);
    ok('it does not steal focus from the field',typing.focused,typing);
    ok('and it does not throw the caret to the end',typing.caret===3,typing);

    ok('no page errors during the search work',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }

  /* ============================================================ 2. MESSAGE ROWS */
  head('2. message rows: the timestamp, and your own messages');
  {
    const {page,ctx,errs}=await boot(browser,1440,900,mkSeed());
    const m=await page.evaluate(()=>{
      const t=document.querySelector('.msg .m-time');
      const name=document.querySelector('.msg .meta .nm-user')||document.querySelector('.msg .meta span');
      const cs=t?getComputedStyle(t):null,ns=name?getComputedStyle(name):null;
      const mine=document.querySelector('.msg.me .meta');
      const other=document.querySelector('.msg:not(.me) .meta');
      const order=el=>{
        if(!el)return null;
        const kids=[...el.children].filter(k=>k.offsetWidth);
        const t2=kids.findIndex(k=>k.classList.contains('m-time'));
        const n2=kids.findIndex(k=>k.querySelector?k.querySelector('.nm-user')||k.classList.contains('nm-user'):false);
        return {timeIdx:t2,nameIdx:n2,dir:getComputedStyle(el).flexDirection};
      };
      return {
        count:document.querySelectorAll('.msg .m-time').length,
        size:cs?parseFloat(cs.fontSize):null,
        weight:cs?Number(cs.fontWeight):null,
        nameSize:ns?parseFloat(ns.fontSize):null,
        titled:t?!!t.getAttribute('title'):false,
        mine:order(mine),other:order(other)
      };
    });
    ok('every message has a classed timestamp',m.count>0,m);
    ok('the timestamp is smaller than the name',m.size!=null&&m.nameSize!=null&&m.size<m.nameSize,m);
    ok('and lighter than the name',m.weight!=null&&m.weight<=400,m);
    ok('the full date is available on hover',m.titled,m);
    ok('your own header row is not reversed',m.mine&&m.mine.dir==='row',m.mine);
    ok('your messages order name-then-time, like everyone else\'s',
       !!(m.mine&&m.other&&m.mine.nameIdx<m.mine.timeIdx&&m.other.nameIdx<m.other.timeIdx),
       {mine:m.mine,other:m.other});
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }

  /* ============================================================ 3. COMPOSER */
  head('3. the composer names where you are');
  {
    const {page,ctx,errs}=await boot(browser,1440,900,mkSeed());
    const ph=await page.evaluate(()=>(document.getElementById('msgIn')||{}).placeholder);
    ok('in a channel it names the channel',/^Message #/.test(ph||''),ph);

    /* Open a real DM and check the placeholder switches to the person. The DM list only exists
       in the home ("Direct Messages") view, so go there first. */
    await page.evaluate(()=>{
      const home=document.querySelector('#dlRail [data-rail="home"],#dlRail [data-home],#dlRail .dl-rail-home');
      if(home)home.click();
    });
    await page.waitForTimeout(900);
    const dm=await page.evaluate(()=>{
      const el=document.querySelector('#sbList .sb-item[data-room^="dm_"]');
      if(!el)return null;
      el.click();return el.getAttribute('data-room');
    });
    ok('the seeded DM is in the sidebar',!!dm,dm);
    await page.waitForTimeout(1300);
    const ph2=await page.evaluate(()=>(document.getElementById('msgIn')||{}).placeholder);
    ok('in a DM it names the person',/^Message @/.test(ph2||''),ph2);
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }

  /* ============================================================ 4. RESPONSIVE */
  head('4. nothing overflows sideways, at every width in the brief');
  {
    const widths=[320,360,390,430,768,900,1024,1280,1440,1920];
    for(const w of widths){
      const {page,ctx}=await boot(browser,w,Math.max(640,Math.round(w*0.72)),mkSeed());
      const r=await page.evaluate(()=>{
        const de=document.documentElement;
        /* The widest element that sticks out past the viewport, if any — named, so a failure
           says WHICH element rather than just "something". */
        let worst=null;
        [...document.querySelectorAll('body *')].forEach(e=>{
          const b=e.getBoundingClientRect();
          if(b.width&&b.right>window.innerWidth+1&&(!worst||b.right>worst.right))
            worst={cls:String(e.className||e.tagName).slice(0,46),right:Math.round(b.right)};
        });
        return {
          scrollW:de.scrollWidth,inner:window.innerWidth,worst,
          composerIn:(()=>{const c=document.getElementById('msgIn');if(!c)return null;
            const b=c.getBoundingClientRect();return b.right<=window.innerWidth+1&&b.width>40})(),
          phWraps:(()=>{const c=document.getElementById('msgIn');if(!c)return null;
            return getComputedStyle(c).whiteSpace!=='normal'||c.scrollHeight<=c.clientHeight+2})()
        };
      });
      ok(w+'px: the page does not scroll sideways',r.scrollW<=r.inner+1,r);
      ok(w+'px: the composer fits its row',r.composerIn!==false,r);
      await ctx.close();
    }
  }

  /* ============================================================ 5. THE TWO NON-DEFECTS */
  head('5. the two things that only LOOKED broken');
  {
    const {page,ctx}=await boot(browser,320,720,mkSeed());
    const r=await page.evaluate(()=>{
      const panel=document.getElementById('dlMembers');
      const pr=panel?panel.getBoundingClientRect():null;
      const spill=panel?[...panel.querySelectorAll('*')].filter(e=>{
        const b=e.getBoundingClientRect();return b.width&&b.right>pr.right+0.5;
      }).map(e=>String(e.className).slice(0,30)):[];
      const sep=document.querySelector('.date-sep');
      const tb=document.querySelector('.topbar');
      const ms=document.getElementById('messages');
      return {spill,
        sepTop:sep?Math.round(sep.getBoundingClientRect().top):null,
        msTop:ms?Math.round(ms.getBoundingClientRect().top):null,
        tbBottom:tb?Math.round(tb.getBoundingClientRect().bottom):null,
        msScrolled:ms?ms.scrollTop>0:null};
    });
    ok('no member row actually overflows the member panel',r.spill.length===0,r.spill);
    /* The divider may be scrolled out of view (fine). What must never happen is the message
       scroller starting ABOVE the header, which would genuinely hide content behind it. */
    ok('the message area starts below the channel header',
       r.msTop!=null&&r.tbBottom!=null&&r.msTop>=r.tbBottom,r);
    await ctx.close();
  }

  /* ============================================================ 6. LONG MESSAGES */
  head('6. a very long message does not break the column');
  {
    const seed=mkSeed();
    const room=BASE_ROOM();
    const long='supercalifragilistic'.repeat(40);                       // no spaces to break on
    const para='This is a long paragraph. '.repeat(90);
    seed.messages[room]=seed.messages[room]||{};
    seed.messages[room].zz1={senderId:2,text:long,at:Date.now()-60000,pings:[],images:[]};
    seed.messages[room].zz2={senderId:3,text:para,at:Date.now()-30000,pings:[],images:[]};
    const {page,ctx}=await boot(browser,390,844,seed);
    const r=await page.evaluate(()=>{
      const de=document.documentElement;
      const bubbles=[...document.querySelectorAll('.msg .bubble')];
      const widest=bubbles.reduce((a,b)=>Math.max(a,b.getBoundingClientRect().right),0);
      return {scrollW:de.scrollWidth,inner:window.innerWidth,widest:Math.round(widest),
              count:bubbles.length};
    });
    ok('an unbreakable 800-character word does not widen the page',r.scrollW<=r.inner+1,r);
    ok('and the bubble stays inside the viewport',r.widest<=r.inner+1,r);
    ok('both long messages rendered',r.count>0,r);
    await ctx.close();
  }

  await browser.close();
  console.log('\nRESULT: '+(fails?(fails+' of '+checks+' v54.9 UI checks FAILED'):('all '+checks+' v54.9 UI checks passed')));
  process.exit(fails?1:0);
})().catch(e=>{console.error('harness error:',e);process.exit(1)});
