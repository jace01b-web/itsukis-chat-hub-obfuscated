/* v54.10: a channel's Send Messages override must lock the composer. Development only. */
const {chromium}=require('playwright');const path=require('path');
const SEED=JSON.parse(JSON.stringify(require('./seed.js')));
let fails=0;const ok=(n,v,x)=>{if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v?'':'  '+JSON.stringify(x)))};
(async()=>{
  const now=Date.now();
  Object.keys(SEED.tosAccepted).forEach(k=>SEED.tosAccepted[k]={v:6,at:now});
  SEED.servers={srvJ:{ownerId:3,name:'Jace Land',createdAt:now}};
  SEED.serverMembers={srvJ:{2:{at:now},3:{at:now}}};
  SEED.userServers={2:{srvJ:{at:now}},3:{srvJ:{at:now}}};
  SEED.serverChannels={srvJ:{c1:{name:'talk',key:'srvJ_c1',cat:'text',type:'text',pos:1},c2:{name:'quiet',key:'srvJ_c2',cat:'text',type:'text',pos:2,ov:{everyone:{deny:{send:true}}}}}};
  SEED.channelServer={srvJ_c1:'srvJ',srvJ_c2:'srvJ'};
  const b=await chromium.launch();const p=await b.newPage({viewport:{width:1400,height:900}});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await p.evaluate(s=>{window.__FAKE.seed(s);['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));window.__FAKE.signIn('vlad@itsuki.local');window.__APP_START()},SEED);
  await p.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});await p.waitForTimeout(1200);
  const st=async key=>p.evaluate(async k=>{__T.DModel; const c=__T.DModel.channelByKey(k);
    document.querySelector('#chatPage').dispatchEvent(new Event('x'));
    window.selectRoom&&0; return c?{sid:c.sid,id:c.id}:null},key);
  const open=async(cid)=>p.evaluate(async cid=>{const D=__T.DModel;const c=D.channel('srvJ',cid);
    const its=[...document.querySelectorAll('#sidebar *')].filter(x=>x.children.length===0&&x.textContent.trim()===c.name);const it=its[0];if(!it)return document.querySelector('#sidebar').innerText.slice(0,200);it.click();return true},cid);
  await p.click('[data-rail="srv:srvJ"]');await p.waitForTimeout(900);
  ok('open #quiet',await open('c2'));await p.waitForTimeout(500);
  let s=await p.evaluate(()=>({dis:document.querySelector('#msgIn').disabled,ph:document.querySelector('#msgIn').placeholder}));
  ok('composer is locked where @everyone is denied Send Messages',s.dis===true,s);
  ok('placeholder explains why',/permission/i.test(s.ph),s);
  ok('open #talk',await open('c1'));await p.waitForTimeout(500);
  s=await p.evaluate(()=>({dis:document.querySelector('#msgIn').disabled}));
  ok('composer is open where nothing is denied',s.dis===false,s);
  // rail icon image must not be draggable
  ok('no page errors',errs.length===0,errs);
  await b.close();console.log(fails?'FAILED '+fails:'ALL PASSED');process.exit(fails?1:0);
})();
