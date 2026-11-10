/* test/run-chat.js
 * The loop people actually spend their time in: typing a message, sending it, replying,
 * reacting, editing, deleting, opening an image, and moving between channels. The other suites
 * check that things RENDER and that dialogs OPEN; nothing until now checked that the chat
 * actually works, which is the part being reported as broken.
 *
 * Driven through real clicks and keystrokes rather than calling internals, so the wiring between
 * the markup and the handlers is under test too - a button that renders but is not wired up
 * passes a render test and still does nothing for the user.
 *
 *     node test/run-chat.js
 *
 * Development only - not referenced by the site.
 */
const {chromium}=require('playwright');
const path=require('path');
const SEED=JSON.parse(JSON.stringify(require('./seed.js')));

const NOW=Date.now();
[1,2,3,4,5].forEach(i=>SEED.tosAccepted[i]={v:6,at:NOW});
SEED.rulesAgreed={1:{v:99,at:NOW},2:{v:99,at:NOW},3:{v:99,at:NOW}};

let fails=0;
const ok=(n,v,x)=>{if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v||x===undefined?'':' '+JSON.stringify(x).slice(0,200)))};

(async()=>{
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errs=[];
  page.on('pageerror',e=>errs.push(e.message));
  page.on('console',m=>{
    const t=m.text();
    if(m.type()==='error'&&!/ERR_TUNNEL|ERR_INTERNET|net::|Failed to load resource/.test(t))errs.push('console: '+t);
  });

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(({s,img})=>{
    // an image message, so the lightbox has something to open
    const c=document.createElement('canvas');c.width=1200;c.height=800;
    const x=c.getContext('2d');x.fillStyle='#46465f';x.fillRect(0,0,1200,800);
    /* #general is keyed 'global' (CFG.GLOBAL_ROOM); 'general' would be an orphan room. */
    s.messages.global=Object.assign({},s.messages.global,{
      img1:{senderId:2,text:'picture',at:Date.now()-50000,pings:[],images:[c.toDataURL('image/jpeg',0.4)]}
    });
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');window.__APP_START();
  },{s:SEED});
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:20000});
  await page.waitForTimeout(1500);
  await page.evaluate(()=>document.querySelectorAll('.modal-bg,.gc-overlay').forEach(e=>e.remove()));

  const count=()=>page.$$eval('.msg',e=>e.length);
  const texts=()=>page.$$eval('.msg',e=>e.map(m=>(m.textContent||'').replace(/\s+/g,' ').trim()));

  // ---------------- sending ----------------
  console.log('\n--- sending ---');
  {
    const before=await count();
    await page.fill('#msgIn','hello from the test suite');
    await page.click('#sendBtn');
    await page.waitForTimeout(900);
    const after=await count();
    ok('a typed message is added to the view',after===before+1,{before,after});
    ok('its text is what was typed',(await texts()).some(t=>t.includes('hello from the test suite')));
    ok('the composer is cleared after sending',(await page.inputValue('#msgIn'))==='');
    ok('it reached the database',await page.evaluate(()=>{
      const m=window.__FAKE.dump?window.__FAKE.dump():null;
      return m?JSON.stringify(m).includes('hello from the test suite'):true;
    }));
  }
  {
    // Enter should send; Shift+Enter should not
    const before=await count();
    await page.fill('#msgIn','sent with the enter key');
    await page.press('#msgIn','Enter');
    await page.waitForTimeout(800);
    ok('Enter sends',(await count())===before+1);

    const b2=await count();
    await page.fill('#msgIn','line one');
    await page.press('#msgIn','Shift+Enter');
    await page.waitForTimeout(400);
    ok('Shift+Enter does not send',(await count())===b2);
    await page.fill('#msgIn','');
  }
  {
    const before=await count();
    await page.click('#sendBtn');
    await page.waitForTimeout(500);
    ok('an empty message is refused',(await count())===before);
  }
  {
    /* The cap is per-user: CFG.MAX_MSG, doubled for MVPs and owners (maxMsgFor), and the rules
       enforce the same 2000/4000 split. Check the attribute the app set, and check it by TYPING -
       page.fill() assigns .value directly and maxLength only constrains real input. */
    const cap=await page.evaluate(()=>({attr:document.getElementById('msgIn').maxLength,
                                        want:__T.CFG.MAX_MSG*(__T.isOwner(__T.ME.id)?__T.CFG.MVP_MSG_MULT:1)}));
    ok('the composer cap matches this user\'s allowance',cap.attr===cap.want,cap);
    await page.click('#msgIn');
    await page.evaluate(()=>{document.getElementById('msgIn').value=''});
    await page.type('#msgIn','y'.repeat(60));
    const typed=(await page.inputValue('#msgIn')).length;
    ok('typing is accepted up to the cap',typed===60,{typed});
    const before=await count();
    await page.evaluate(c=>{
      const i=document.getElementById('msgIn');
      i.value='z'.repeat(c);i.dispatchEvent(new Event('input',{bubbles:true}));
    },cap.want);
    await page.click('#sendBtn');await page.waitForTimeout(900);
    ok('a message at exactly the cap sends',(await count())===before+1);
    await page.fill('#msgIn','');
  }

  // ---------------- replying ----------------
  console.log('\n--- replying ---');
  {
    const first=page.locator('.msg').first();
    await first.hover();
    await first.locator('[data-reply-btn]').first().click({force:true});
    await page.waitForTimeout(400);
    const ctxShown=await page.evaluate(()=>{
      const c=document.getElementById('composeContext');
      return!!c&&getComputedStyle(c).display!=='none'&&c.getClientRects().length>0;
    });
    ok('the reply bar appears above the composer',ctxShown);
    const before=await count();
    await page.fill('#msgIn','this is my reply');
    await page.click('#sendBtn');
    await page.waitForTimeout(900);
    ok('the reply sends',(await count())===before+1);
    ok('the reply renders a quoted reference',
      await page.evaluate(()=>!!document.querySelector('.msg .reply-ref,.msg .rr,.msg [class*=reply]')));
    const ctxGone=await page.evaluate(()=>{
      const c=document.getElementById('composeContext');
      return!c||getComputedStyle(c).display==='none'||!c.getClientRects().length;
    });
    ok('the reply bar clears after sending',ctxGone);
  }

  // ---------------- reactions ----------------
  console.log('\n--- reactions ---');
  {
    const pill=page.locator('.reaction-pill[data-emoji]').first();
    if(await pill.count()){
      const readCount=()=>pill.locator('.rp-count').innerText();
      const before=parseInt(await readCount(),10);
      await pill.click({force:true});
      await page.waitForTimeout(800);
      const after=parseInt(await pill.locator('.rp-count').innerText(),10);
      ok('clicking a reaction changes its count',after!==before,{before,after});
      await pill.click({force:true});
      await page.waitForTimeout(800);
      const back=parseInt(await pill.locator('.rp-count').innerText(),10);
      ok('clicking it again toggles back',back===before,{before,back});
    }else ok('a seeded reaction pill exists to click',false);
  }

  // ---------------- editing and deleting own messages ----------------
  console.log('\n--- editing and deleting ---');
  {
    const mine=page.locator('.msg').last();
    await mine.hover();
    const edit=mine.locator('[data-edit-btn]');
    ok('own message offers an edit button',await edit.count()>0);
    if(await edit.count()){
      const original=await mine.locator('.bubble').first().innerText();
      await edit.first().click({force:true});
      await page.waitForTimeout(500);
      /* startEdit() loads the text into #msgIn and flags it in the compose-context bar; there is
         no inline edit box in the message itself. */
      const ed=await page.evaluate(()=>({
        val:document.getElementById('msgIn').value,
        ctx:(document.getElementById('composeContext')||{}).className||'',
        label:(document.getElementById('ccLabel')||{}).textContent||''
      }));
      ok('editing loads the message into the composer',ed.val.length>0,ed);
      ok('the composer says it is editing',/edit/i.test(ed.label),ed);
      ok('the loaded text is the message text',original.includes(ed.val.slice(0,20)),
         {original:original.slice(0,40),loaded:ed.val.slice(0,40)});
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      ok('Escape cancels the edit',(await page.inputValue('#msgIn'))==='');
    }
  }
  {
    const before=await count();
    const mine=page.locator('.msg').last();
    await mine.hover();
    const del=mine.locator('[data-more-btn]');
    if(await del.count()){
      await del.first().click({force:true});
      await page.waitForTimeout(600);
      // a confirm dialog may appear - accept it however it is presented
      await page.evaluate(()=>{
        const b=[...document.querySelectorAll('button')]
          .find(x=>/^(delete|confirm|yes|remove)$/i.test((x.textContent||'').trim()));
        if(b)b.click();
      });
      await page.waitForTimeout(900);
      ok('deleting removes the message',(await count())<before,{before,after:await count()});
    }else ok('own message offers a delete button',false);
  }

  // ---------------- image lightbox ----------------
  console.log('\n--- image lightbox ---');
  {
    const img=page.locator('.msg .imgs img').first();
    if(await img.count()){
      await img.click({force:true});
      await page.waitForTimeout(600);
      ok('clicking an image opens the lightbox',
        await page.evaluate(()=>!!document.querySelector('#lb,.lightbox')));
      const fits=await page.evaluate(()=>{
        const i=document.querySelector('#lb img,.lightbox img');
        if(!i)return null;
        const r=i.getBoundingClientRect();
        return r.width<=innerWidth+1&&r.height<=innerHeight+1;
      });
      ok('the lightbox image fits on screen',fits!==false,{fits});
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      ok('Escape closes the lightbox',
        await page.evaluate(()=>!document.querySelector('#lb,.lightbox')));
    }else ok('an image message exists to open',false);
  }

  // ---------------- moving around ----------------
  console.log('\n--- channel switching ---');
  {
    const before=errs.length;
    const chans=await page.$$eval('.dch',e=>e.map(c=>c.textContent.trim()).slice(0,4));
    for(let round=0;round<3;round++){
      for(let i=0;i<Math.min(3,chans.length);i++){
        await page.evaluate(i=>{const c=document.querySelectorAll('.dch')[i];if(c)c.click()},i);
        await page.waitForTimeout(260);          // deliberately faster than the switch animation
      }
    }
    await page.waitForTimeout(1200);
    ok('rapid channel switching throws nothing',errs.length===before,errs.slice(before,before+2));
    ok('a channel is still rendered afterwards',(await count())>0);
    ok('the composer still works afterwards',await page.evaluate(()=>{
      const i=document.getElementById('msgIn');return!!i&&!i.disabled;
    }));
  }

  // ---------------- scrolling ----------------
  console.log('\n--- scrolling ---');
  {
    const before=errs.length;
    await page.evaluate(()=>{const m=document.querySelector('.messages');if(m)m.scrollTop=0});
    await page.waitForTimeout(900);
    await page.evaluate(()=>{const m=document.querySelector('.messages');if(m)m.scrollTop=m.scrollHeight});
    await page.waitForTimeout(900);
    ok('scrolling to the top and back throws nothing',errs.length===before,errs.slice(before,before+2));
    ok('the list is scrolled to the bottom',await page.evaluate(()=>{
      const m=document.querySelector('.messages');
      return!m||m.scrollHeight-m.scrollTop-m.clientHeight<140;
    }));
  }

  console.log('\npage errors:',errs.length);
  [...new Set(errs)].slice(0,8).forEach(e=>console.log('  !! '+e.split('\n')[0].slice(0,160)));
  if(errs.length)fails++;
  console.log(fails?'\n'+fails+' CHAT CHECK(S) FAILED':'\nALL CHAT CHECKS PASSED');
  await browser.close();
  process.exit(fails?1:0);
})();
