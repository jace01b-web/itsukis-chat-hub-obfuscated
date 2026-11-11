/* ==========================================================================
 * js/discord/server-plus.js  (v54)
 *
 * Three more server systems, each registered as a section through registerServerSection():
 *
 *   SEvents    scheduled events, with RSVPs                 serverEvents/$sid/$eid
 *   SWelcome   the welcome screen and rules screening       servers/$sid/{srules,screenOn,...}
 *              plus the three moderation levels             memberScreen/$sid/$uid
 *   stats      what this server actually looks like         counted from state already in memory
 *
 * ONE HONEST LIMITATION, UP FRONT
 *   Rules screening is a PROMPT, not a wall. Discord enforces its version on its own servers;
 *   here the only thing that could stop an unscreened member posting is the database rule on
 *   messages/$key/$msg, and widening that rule to consult memberScreen would mean rewriting the
 *   single biggest expression in the ruleset - the one every message on the site is already
 *   validated against. The trade was not worth it: a bug there breaks chat for everybody.
 *   So the gate is in the browser, it is clearly a gate, and this file says so rather than
 *   implying the server is holding the line. The things that ARE enforced server-side - bans,
 *   timeouts, permissions - are unchanged.
 * ========================================================================== */
'use strict';

/* ======================================================================
 *  EVENTS
 * ====================================================================== */
const SEvents=(function(){
  const S={byServer:{}};
  const perServer={};
  const subs=new Set();
  function emit(){subs.forEach(f=>{try{f()}catch(e){console.warn('[SEvents] subscriber failed',e)}})}

  function attach(sid){
    if(!sid||sid===DModel.ICH_ID||perServer[sid])return;
    perServer[sid]=onValue(R('serverEvents/'+sid),s=>{
      S.byServer[sid]=s.val()||{};emit();
    },e=>console.warn('[SEvents] denied',sid,e&&e.code));
  }
  function detach(sid){
    const u=perServer[sid];if(!u)return;
    try{u()}catch(_){}
    delete perServer[sid];delete S.byServer[sid];
  }

  function of(sid){
    const raw=S.byServer[sid]||{};
    return Object.keys(raw).map(id=>({id,...raw[id]}))
      .filter(e=>e&&e.name&&Number(e.at)>0)
      .sort((a,b)=>a.at-b.at);
  }
  /* Anything that has not finished yet. An event with an end time runs until then; one without
     is treated as over two hours after it starts, which is long enough that a party does not
     vanish off the list halfway through. */
  function upcoming(sid){
    const now=Date.now();
    return of(sid).filter(e=>(Number(e.ends)||(Number(e.at)+2*3600000))>now);
  }
  function past(sid){
    const now=Date.now();
    return of(sid).filter(e=>(Number(e.ends)||(Number(e.at)+2*3600000))<=now).reverse();
  }
  function rsvpCount(e){return e&&e.rsvp?Object.keys(e.rsvp).filter(k=>e.rsvp[k]===true).length:0}
  function iAmIn(e){return !!(e&&e.rsvp&&ME&&e.rsvp[ME.id]===true)}

  function clean(s,max){
    return String(s||'').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g,'').replace(/\n{3,}/g,'\n\n').trim().slice(0,max);
  }

  async function save(sid,eid,f){
    if(sid===DModel.ICH_ID)throw new Error('Itsukis Chat Hub is the site, not a server — it has no events.');
    if(!DModel.can(sid,'manageEvents',ME.id))throw new Error('You need Manage Events in this server.');
    const name=clean(f.name,80);
    if(name.length<2)throw new Error('Give the event a name.');
    const at=Number(f.at);
    if(!(at>0))throw new Error('Pick a date and time.');
    const rec={name,at,by:Number(ME.id),made:Date.now()+SKEW};
    const desc=clean(f.desc,500);if(desc)rec.desc=desc;
    const where=clean(f.where,80);if(where)rec.where=where;
    if(f.ch){
      const ok=(()=>{try{return DModel.channels(sid).some(c=>c.id===f.ch)}catch(_){return false}})();
      if(ok)rec.ch=String(f.ch).slice(0,64);
    }
    const ends=Number(f.ends);
    if(ends>0){
      if(ends<=at)throw new Error('The end has to be after the start.');
      rec.ends=ends;
    }
    const id=eid||push(R('serverEvents/'+sid)).key;
    if(eid){
      /* An edit must not wipe the RSVPs, and the node is written whole - so they are carried. */
      const old=(S.byServer[sid]||{})[eid];
      if(old&&old.rsvp)rec.rsvp=old.rsvp;
    }
    await set(R('serverEvents/'+sid+'/'+id),rec);
    DAudit.log(sid,eid?'event.update':'event.create',{target:id,name});
    return id;
  }

  async function del(sid,eid){
    if(!DModel.can(sid,'manageEvents',ME.id))throw new Error('You need Manage Events in this server.');
    const rec=(S.byServer[sid]||{})[eid];
    await remove(R('serverEvents/'+sid+'/'+eid));
    DAudit.log(sid,'event.delete',{target:eid,name:rec?rec.name:''});
  }

  /* Interested / not. Its own child in the rules, so an ordinary member can mark themselves
     without being able to touch the event. */
  async function rsvp(sid,eid,on){
    if(!ME)return;
    if(on)await set(R('serverEvents/'+sid+'/'+eid+'/rsvp/'+ME.id),true);
    else await remove(R('serverEvents/'+sid+'/'+eid+'/rsvp/'+ME.id));
  }

  return{attach,detach,of,upcoming,past,save,del,rsvp,rsvpCount,iAmIn,
         onChange:f=>{subs.add(f);return()=>subs.delete(f)}};
})();

function fmtEventWhen(at,ends){
  const d=new Date(Number(at));
  const day=d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  const t=d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  let out=day+' · '+t;
  if(Number(ends)>0){
    const e=new Date(Number(ends));
    const sameDay=e.toDateString()===d.toDateString();
    out+=' – '+(sameDay?'':e.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' ')+
      e.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  }
  const ms=Number(at)-Date.now();
  if(ms>0&&ms<7*864e5)out+='  ·  in '+fmtRough(ms);
  else if(ms<=0&&(Number(ends)||Number(at)+2*3600000)>Date.now())out+='  ·  happening now';
  return out;
}
function fmtRough(ms){
  const m=Math.round(ms/60000);
  if(m<60)return m+' min';
  const h=Math.round(m/60);
  if(h<24)return h+' hour'+(h===1?'':'s');
  const d=Math.round(h/24);
  return d+' day'+(d===1?'':'s');
}
/* A <input type="datetime-local"> wants local time with no zone, which is not what toISOString
   gives you - that is UTC, and using it shifts every event by the viewer's offset. */
function toLocalInput(ms){
  const d=new Date(Number(ms)||Date.now());
  const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
}

registerServerSection({
  k:'events',n:'Events',cat:'Server',perm:'',ich:false,
  draw(main,sid,srv,api){
    const canManage=DModel.can(sid,'manageEvents',ME.id);

    function openEditor(ev){
      const chans=(()=>{try{return DModel.channels(sid).filter(c=>c.type==='voice')}catch(_){return []}})();
      const m=dmodal({
        title:ev?'Edit event':'Create an event',
        body:
          '<div class="dfield"><label class="dlabel">Name</label>'+
            '<input class="dinput" id="evName" maxlength="80" value="'+esc(ev?ev.name:'')+'"></div>'+
          '<div class="dfield"><label class="dlabel">Starts</label>'+
            '<input class="dinput" type="datetime-local" id="evAt" value="'+esc(toLocalInput(ev?ev.at:Date.now()+3600000))+'"></div>'+
          '<div class="dfield"><label class="dlabel">Ends (optional)</label>'+
            '<input class="dinput" type="datetime-local" id="evEnds" value="'+esc(ev&&ev.ends?toLocalInput(ev.ends):'')+'"></div>'+
          '<div class="dfield"><label class="dlabel">Where (optional)</label>'+
            '<input class="dinput" id="evWhere" maxlength="80" placeholder="e.g. General Voice, or a link somebody shares" value="'+esc(ev&&ev.where?ev.where:'')+'"></div>'+
          (chans.length?'<div class="dfield"><label class="dlabel">Voice channel (optional)</label>'+
            '<select class="dinput" id="evCh"><option value="">None</option>'+
            chans.map(c=>'<option value="'+esc(c.id)+'"'+(ev&&ev.ch===c.id?' selected':'')+'>'+esc(c.name)+'</option>').join('')+
            '</select></div>':'')+
          '<div class="dfield"><label class="dlabel">Description (optional)</label>'+
            '<textarea class="dinput" id="evDesc" rows="3" maxlength="500">'+esc(ev&&ev.desc?ev.desc:'')+'</textarea></div>'+
          '<div class="derr" id="evErr"></div>',
        footer:'<button type="button" class="dbtn sec" data-x>Cancel</button>'+
               '<button type="button" class="dbtn" data-go>'+(ev?'Save':'Create')+'</button>'
      });
      m.foot.querySelector('[data-x]').onclick=m.close;
      const go=m.foot.querySelector('[data-go]');
      go.onclick=async()=>{
        const err=m.body.querySelector('#evErr');err.textContent='';
        go.disabled=true;
        try{
          const atv=m.body.querySelector('#evAt').value;
          const endsv=m.body.querySelector('#evEnds').value;
          await SEvents.save(sid,ev?ev.id:null,{
            name:m.body.querySelector('#evName').value,
            at:atv?new Date(atv).getTime():0,
            ends:endsv?new Date(endsv).getTime():0,
            where:m.body.querySelector('#evWhere').value,
            ch:(m.body.querySelector('#evCh')||{}).value||'',
            desc:m.body.querySelector('#evDesc').value
          });
          m.close();toast(ev?'Event saved.':'Event created.');paint();
        }catch(e){err.textContent=(e&&e.message)||'Could not save it.';go.disabled=false}
      };
    }

    function card(e,isPast){
      const n=SEvents.rsvpCount(e),mine=SEvents.iAmIn(e);
      const host=DB.getUser(Number(e.by));
      return '<div class="dev-card'+(isPast?' past':'')+'">'+
        '<div class="dev-when">'+esc(fmtEventWhen(e.at,e.ends))+'</div>'+
        '<div class="dev-name">'+esc(e.name)+'</div>'+
        (e.desc?'<div class="dev-desc">'+esc(e.desc)+'</div>':'')+
        '<div class="dev-meta">'+
          (e.where?'<span>\u{1F4CD} '+esc(e.where)+'</span>':'')+
          (e.ch?'<span>\u{1F50A} '+esc((DModel.channel(sid,e.ch)||{name:'voice'}).name)+'</span>':'')+
          '<span>\u{1F465} '+n+' interested</span>'+
          (host?'<span>by '+esc(dispName(host))+'</span>':'')+
        '</div>'+
        '<div class="dev-acts">'+
          (isPast?'':'<button type="button" class="dbtn sm '+(mine?'':'grey')+'" data-evgo="'+esc(e.id)+'">'+(mine?'✓ Interested':'Interested')+'</button>')+
          (canManage?'<button type="button" class="dbtn sm grey" data-evedit="'+esc(e.id)+'">Edit</button>'+
                     '<button type="button" class="dbtn sm danger" data-evdel="'+esc(e.id)+'">Cancel</button>':'')+
        '</div>'+
      '</div>';
    }

    function paint(){
      const up=SEvents.upcoming(sid),old=SEvents.past(sid).slice(0,10);
      main.innerHTML=
        '<div class="dset-h1">Events</div>'+
        (canManage?'<button type="button" class="dbtn" id="evNew">Create an event</button>':'')+
        '<div class="dnote">Nobody is notified automatically — there is no scheduler here. '+
          'An event is a shared plan people can mark themselves interested in, and it shows up '+
          'until it is over.</div>'+
        (up.length?'<div class="dset-sep"></div><div class="dset-h2">Upcoming</div>'+up.map(e=>card(e,false)).join('')
                  :'<div class="dempty">Nothing scheduled.</div>')+
        (old.length?'<div class="dset-sep"></div><div class="dset-h2">Finished</div>'+old.map(e=>card(e,true)).join(''):'');

      const nb=main.querySelector('#evNew');if(nb)nb.onclick=()=>openEditor(null);
      main.querySelectorAll('[data-evgo]').forEach(b=>b.onclick=async()=>{
        const e=SEvents.of(sid).find(x=>x.id===b.dataset.evgo);if(!e)return;
        b.disabled=true;
        try{await SEvents.rsvp(sid,e.id,!SEvents.iAmIn(e));paint()}
        catch(err){toast((err&&err.message)||'Could not save that.','bad');b.disabled=false}
      });
      main.querySelectorAll('[data-evedit]').forEach(b=>b.onclick=()=>{
        const e=SEvents.of(sid).find(x=>x.id===b.dataset.evedit);if(e)openEditor(e);
      });
      main.querySelectorAll('[data-evdel]').forEach(b=>b.onclick=()=>{
        const e=SEvents.of(sid).find(x=>x.id===b.dataset.evdel);if(!e)return;
        dconfirm({title:'Cancel “'+e.name+'”?',sub:'It is removed for everybody, along with who was interested.',
          confirm:'Cancel it',danger:true,
          onConfirm:async()=>{await SEvents.del(sid,e.id);paint()}});
      });
    }
    SEvents.attach(sid);
    paint();
    const off=SEvents.onChange(()=>{if(document.body.contains(main))paint();else off()});
  }
});

/* ======================================================================
 *  WELCOME SCREEN, RULES SCREENING AND THE MODERATION LEVELS
 * ====================================================================== */
const SWelcome=(function(){
  const screened={};        /* sid -> {uid:at} */
  const perServer={};

  function attach(sid){
    if(!sid||sid===DModel.ICH_ID||perServer[sid])return;
    perServer[sid]=onValue(R('memberScreen/'+sid),s=>{
      screened[sid]=s.val()||{};
      try{check()}catch(_){}
    },e=>console.warn('[SWelcome] denied',sid,e&&e.code));
  }
  function detach(sid){
    const u=perServer[sid];if(!u)return;
    try{u()}catch(_){}
    delete perServer[sid];delete screened[sid];
  }

  function needed(sid){
    try{
      if(!ME||!sid||sid===DModel.ICH_ID)return false;
      const srv=DModel.server(sid);
      if(!srv||srv.screenOn!==true)return false;
      if(!String(srv.srules||'').trim())return false;      /* nothing to agree to */
      if(DModel.isServerOwner(sid,ME.id)||isOwner(ME.id))return false;
      if(!DModel.inServer(sid,ME.id))return false;
      const s=screened[sid];
      if(s===undefined)return false;                       /* not read yet - do not flash a gate */
      return !s[ME.id];
    }catch(_){return false}
  }

  async function accept(sid){
    if(!ME)return;
    await set(R('memberScreen/'+sid+'/'+ME.id),Date.now()+SKEW);
  }

  /* The gate. An overlay inside the chat area, not a modal, so the channel list and the rail
     stay usable - you can leave the server, or go somewhere else, without agreeing. */
  function check(){
    const host=document.querySelector('.main');
    if(!host)return;
    let el=document.getElementById('swGate');
    let sid=null;try{sid=view.sid}catch(_){}
    const want=(()=>{try{return view.page==='chatPage'&&view.mode!=='dms'&&needed(sid)}catch(_){return false}})();
    if(!want){if(el)el.remove();return}
    const srv=DModel.server(sid)||{};
    if(!el){
      el=document.createElement('div');
      el.id='swGate';el.className='sw-gate';
      host.appendChild(el);
    }
    if(el.dataset.sid===sid&&el.dataset.rev===String((srv.srules||'').length))return;
    el.dataset.sid=sid;el.dataset.rev=String((srv.srules||'').length);
    let rulesHtml;
    try{rulesHtml=mdRender(String(srv.srules||''))}catch(_){rulesHtml=esc(String(srv.srules||''))}
    el.innerHTML=
      '<div class="sw-card">'+
        '<div class="sw-h">'+esc(String(srv.wtitle||('Welcome to '+(srv.name||'this server'))))+'</div>'+
        (srv.wdesc?'<div class="sw-sub">'+esc(String(srv.wdesc))+'</div>':'')+
        '<div class="sw-rules">'+rulesHtml+'</div>'+
        '<label class="sw-chk"><input type="checkbox" id="swOk"> I have read and agree to these rules</label>'+
        '<button type="button" class="dbtn" id="swGo" disabled>Continue</button>'+
        '<div class="sw-note">You can read the channels either way — this is the server asking '+
          'you to agree before you take part.</div>'+
      '</div>';
    const chk=el.querySelector('#swOk'),go=el.querySelector('#swGo');
    chk.onchange=()=>{go.disabled=!chk.checked};
    go.onclick=async()=>{
      go.disabled=true;go.textContent='Saving…';
      try{await accept(sid);el.remove();toast('Thanks — you’re all set.')}
      catch(e){
        go.disabled=false;go.textContent='Continue';
        toast('That could not be saved ('+((e&&e.code)||'failed')+').','bad');
      }
    };
  }

  function acceptedCount(sid){const s=screened[sid]||{};return Object.keys(s).length}
  function hasAccepted(sid,uid){const s=screened[sid]||{};return !!s[Number(uid)]}

  return{attach,detach,needed,accept,check,acceptedCount,hasAccepted};
})();

/* Checked after every chat render, which is the one place that runs on every change of channel,
   server and sign-in. renderMain is a function declaration, so it can be wrapped. */
const _renderMain_v53=renderMain;
renderMain=function(){
  const out=_renderMain_v53.apply(null,arguments);
  try{SWelcome.check()}catch(e){console.warn('[SWelcome] check failed',e)}
  return out;
};

registerServerSection({
  k:'welcome',n:'Welcome Screen',cat:'Server',perm:'manageSrv',ich:false,
  draw(main,sid,srv,api){
    function paint(){
      const s=DModel.server(sid)||{};
      main.innerHTML=
        '<div class="dset-h1">Welcome Screen</div>'+
        '<div class="dfield"><label class="dlabel">Heading</label>'+
          '<input class="dinput" id="swTitle" maxlength="100" placeholder="Welcome to '+esc(s.name||'')+'" value="'+esc(s.wtitle||'')+'"></div>'+
        '<div class="dfield"><label class="dlabel">Short blurb</label>'+
          '<textarea class="dinput" id="swDesc" rows="2" maxlength="300" placeholder="What this place is for.">'+esc(s.wdesc||'')+'</textarea></div>'+
        '<div class="dset-sep"></div>'+
        '<div class="dset-h2">Rules</div>'+
        '<div class="dfield"><textarea class="dinput" id="swRules" rows="9" maxlength="2000" placeholder="1. Be decent to each other&#10;2. ...">'+esc(s.srules||'')+'</textarea></div>'+
        '<div class="dnote">The same formatting messages use — <b>**bold**</b>, lists, links.</div>'+
        '<div class="drow"><div class="drow-txt"><div class="drow-nm">Ask new members to agree before taking part</div>'+
          '<div class="drow-d">Shows the rules over the chat until they agree. <b>This is a prompt, not a lock:</b> '+
          'it is enforced by the browser, so treat it as setting expectations rather than as security. '+
          'Bans, timeouts and permissions are the things enforced by the server.</div></div>'+
          dtoggleHTML(s.screenOn===true,'id="swScreen"')+'</div>'+
        '<div class="dset-sep"></div>'+
        '<div class="dset-h2">Moderation level</div>'+
        '<div class="dfield"><label class="dlabel">Verification</label><select class="dinput" id="swVerify">'+
          [['none','None — anybody with an invite'],
           ['low','Low — must have set a display name'],
           ['med','Medium — account older than a day'],
           ['high','High — account older than a week']]
          .map(([v,l])=>'<option value="'+v+'"'+((s.verify||'none')===v?' selected':'')+'>'+esc(l)+'</option>').join('')+
          '</select></div>'+
        '<div class="dfield"><label class="dlabel">Explicit image filter</label><select class="dinput" id="swFilter">'+
          [['off','Off'],['members','Scan members without a role'],['all','Scan everybody']]
          .map(([v,l])=>'<option value="'+v+'"'+((s.efilter||'members')===v?' selected':'')+'>'+esc(l)+'</option>').join('')+
          '</select></div>'+
        '<div class="dfield"><label class="dlabel">Default notifications for new members</label><select class="dinput" id="swNotif">'+
          [['all','All messages'],['mentions','Only @mentions']]
          .map(([v,l])=>'<option value="'+v+'"'+((s.defNotif||'all')===v?' selected':'')+'>'+esc(l)+'</option>').join('')+
          '</select></div>'+
        '<div class="dnote">Verification is checked when somebody joins with an invite. The image '+
          'filter uses the same check the public channels already use, and only runs when the site’s '+
          'own filter is switched on.</div>'+
        '<div class="derr" id="swErr"></div>'+
        '<div class="dset-sep"></div>'+
        '<button type="button" class="dbtn" id="swSave">Save</button>'+
        '<div class="dnote">'+SWelcome.acceptedCount(sid)+' member'+(SWelcome.acceptedCount(sid)===1?' has':'s have')+' agreed so far.</div>';

      main.querySelector('#swSave').onclick=async()=>{
        const b=main.querySelector('#swSave'),err=main.querySelector('#swErr');
        err.textContent='';b.disabled=true;b.textContent='Saving…';
        try{
          await DModel.updateServer(sid,{
            wtitle:main.querySelector('#swTitle').value,
            wdesc:main.querySelector('#swDesc').value,
            srules:main.querySelector('#swRules').value,
            screenOn:main.querySelector('#swScreen').checked,
            verify:main.querySelector('#swVerify').value,
            efilter:main.querySelector('#swFilter').value,
            defNotif:main.querySelector('#swNotif').value
          });
          DAudit.log(sid,'welcome.update',{});
          toast('Saved.');paint();
        }catch(e){
          err.textContent=/permission|denied/i.test(String((e&&(e.code||e.message))||''))
            ?'Saving was refused — the published database rules are older than this build. Republish firebase-rules.json.'
            :((e&&e.message)||'Could not save.');
          b.disabled=false;b.textContent='Save';
        }
      };
    }
    SWelcome.attach(sid);
    paint();
  }
});

/* ======================================================================
 *  THE EXTRA SERVER FIELDS
 *  DModel.updateServer only knows the fields v53 gave it. Rather than edit model.js, it is
 *  wrapped: the v54 fields are validated and written here, and anything it already understood is
 *  handed straight through untouched.
 * ====================================================================== */
(function extendUpdateServer(){
  const orig=DModel.updateServer;
  if(typeof orig!=='function'){console.warn('[server-plus] updateServer missing');return}

  const STR=(v,max)=>String(v==null?'':v).replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g,'')
    .replace(/\n{3,}/g,'\n\n').trim().slice(0,max);
  const ENUM=(v,allowed,def)=>allowed.indexOf(String(v))>=0?String(v):def;

  const MINE={
    srules:  v=>STR(v,2000),
    wtitle:  v=>STR(v,100),
    wdesc:   v=>STR(v,300),
    screenOn:v=>v===true,
    verify:  v=>ENUM(v,['none','low','med','high'],'none'),
    efilter: v=>ENUM(v,['off','members','all'],'members'),
    defNotif:v=>ENUM(v,['all','mentions'],'all')
  };

  DModel.updateServer=async function(sid,fields){
    fields=fields||{};
    const mine={},theirs={};
    Object.keys(fields).forEach(k=>{
      if(fields[k]===undefined)return;
      if(MINE[k])mine[k]=MINE[k](fields[k]);
      else theirs[k]=fields[k];
    });
    /* Theirs first: it carries the permission check and the boost gate on the banner, so if it
       refuses, nothing of ours is written either. */
    if(Object.keys(theirs).length)await orig.call(DModel,sid,theirs);
    if(Object.keys(mine).length){
      if(sid===DModel.ICH_ID)throw new Error('Itsukis Chat Hub is defined in code and cannot be edited here.');
      if(!DModel.can(sid,'manageSrv',ME.id))throw new Error('You need Manage Server for that.');
      const patch={};
      Object.keys(mine).forEach(k=>{patch[k]=(mine[k]===''||mine[k]===false)?null:mine[k]});
      await update(R('servers/'+sid),patch);
    }
    return true;
  };
})();

/* Verification level, checked where it can be: at the moment somebody joins with an invite.
   Wrapped round joinByInvite rather than built into it, same pattern as everything else here. */
(function gateJoins(){
  const orig=DModel.joinByInvite;
  if(typeof orig!=='function')return;

  function verifyFail(srv){
    const lvl=String((srv&&srv.verify)||'none');
    if(lvl==='none')return '';
    const me=DB.getUser(ME.id)||{};
    if(lvl==='low'&&!hasDispName(me))
      return 'This server asks new members to set a display name first — Settings → My Account.';
    /* An account with no createdAt at all is an OLD one - the field was added later - so a
       missing value is treated as "old enough" rather than as brand new. Punishing a long-
       standing account for a field that did not exist when it was made would be the wrong way
       round, and the dialog says the check is on account age so there is nothing hidden here. */
    if(!Number(me.createdAt))return '';
    const age=Date.now()-Number(me.createdAt);
    if(lvl==='med'&&age<864e5)
      return 'This server only takes accounts older than a day. Yours is newer than that.';
    if(lvl==='high'&&age<7*864e5)
      return 'This server only takes accounts older than a week. Yours is newer than that.';
    return '';
  }

  DModel.joinByInvite=async function(code){
    /* The server has to be resolved before joining to read its level, and the only way to do
       that is the code lookup the original does anyway. Resolve it here first, cheaply. */
    try{
      const c=String(code||'').trim().toUpperCase();
      const snap=await get(R('inviteCodes/'+c));
      const sid=snap.val();
      if(sid){
        const srv=(await get(R('servers/'+sid))).val();
        const why=verifyFail(srv);
        if(why)throw new Error(why);
      }
    }catch(e){
      /* Only OUR refusal should stop the join. A failed lookup is the original's problem to
         report, with its own better message. */
      if(e&&e.message&&/display name|older than/.test(e.message))throw e;
    }
    return orig.call(DModel,code);
  };
})();

/* ======================================================================
 *  STATS
 * ====================================================================== */
registerServerSection({
  k:'stats',n:'Stats',cat:'Server',perm:'manageSrv',ich:true,
  draw(main,sid,srv,api){
    const sys=DModel.isSystem(sid);
    const tile=(k,v,sub)=>'<div class="pf-stat"><span class="pf-stat-k">'+esc(k)+'</span>'+
      '<span class="pf-stat-v">'+esc(String(v))+'</span>'+(sub?'<span class="dst-sub">'+esc(sub)+'</span>':'')+'</div>';

    let members=0,online=0;
    try{
      if(sys){members=DB.allUsers().filter(u=>!u.deleted).length;online=DB.onlineCount()}
      else{
        const ids=DModel.memberIds(sid);
        members=ids.length;
        const on=new Set(DB.onlineIds());
        online=ids.filter(i=>on.has(i)).length;
      }
    }catch(_){}

    let text=0,voice=0,cats=0,roles=0,hoisted=0;
    try{
      const ch=DModel.channels(sid);
      text=ch.filter(c=>c.type!=='voice').length;
      voice=ch.filter(c=>c.type==='voice').length;
      cats=(DModel.cats(sid)||[]).length;
      const rs=DModel.roles(sid);
      roles=rs.length;hoisted=rs.filter(r=>r.hoist).length;
    }catch(_){}

    let boosts=0,level=0;
    try{boosts=DBoost.countFor(sid);level=DBoost.levelFor(sid)}catch(_){}
    let emoji=0;try{emoji=SEmoji.count(sid)}catch(_){}
    let events=0;try{events=SEvents.upcoming(sid).length}catch(_){}
    let invites=0;try{invites=0}catch(_){}
    let bans=0;try{bans=(DModel.serverBanList(sid)||[]).length}catch(_){}

    /* Messages are counted from what this client has actually loaded, so the number is labelled
       as that rather than passed off as a total. Counting every message in every channel would
       mean reading the whole message tree, which is exactly the sort of thing that makes a
       Firebase bill. */
    let loadedMsgs=0,activeChans=0;
    try{
      DModel.channels(sid).filter(c=>c.type!=='voice').forEach(c=>{
        const n=(DB.messages(c.id)||[]).length;
        if(n){loadedMsgs+=n;activeChans++}
      });
    }catch(_){}

    const created=(()=>{
      if(sys)return 'the beginning';
      const t=Number(srv&&srv.createdAt);
      return t>0?new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'unknown';
    })();

    /* Role distribution: who is actually using the roles this server defines. */
    let dist='';
    try{
      if(!sys){
        const rs=DModel.roles(sid).filter(r=>!r.everyone&&!r.virtual);
        const ids=DModel.memberIds(sid);
        const counted=rs.map(r=>({r,n:ids.filter(u=>DModel.rolesOf(sid,u).some(x=>x.id===r.id)).length}))
          .sort((a,b)=>b.n-a.n);
        const noRole=ids.filter(u=>!DModel.rolesOf(sid,u).some(x=>!x.everyone&&!x.virtual)).length;
        if(counted.length||noRole){
          const max=Math.max(1,noRole,...counted.map(c=>c.n));
          dist='<div class="dset-sep"></div><div class="dset-h2">Roles in use</div><div class="dst-bars">'+
            counted.map(c=>'<div class="dst-bar"><span class="dst-l">'+
              '<i style="background:'+esc(c.r.color||'#99aab5')+'"></i>'+esc(c.r.name)+'</span>'+
              '<span class="dst-track"><b style="width:'+Math.round(100*c.n/max)+'%;background:'+esc(c.r.color||'#5865f2')+'"></b></span>'+
              '<span class="dst-n">'+c.n+'</span></div>').join('')+
            '<div class="dst-bar"><span class="dst-l"><i style="background:#4e5058"></i>No role</span>'+
              '<span class="dst-track"><b style="width:'+Math.round(100*noRole/max)+'%;background:#4e5058"></b></span>'+
              '<span class="dst-n">'+noRole+'</span></div>'+
          '</div>';
        }
      }
    }catch(_){}

    main.innerHTML=
      '<div class="dset-h1">Stats</div>'+
      '<div class="dnote">Counted from what this client can see right now — nothing is '+
        'tallied or stored server-side, so these are live rather than historical.</div>'+
      '<div class="pf-stats">'+
        tile('Members',members,sys?'everyone with an account':'')+
        tile('Online now',online)+
        tile('Text channels',text)+
        tile('Voice channels',voice)+
        tile('Categories',cats)+
        tile('Roles',roles,hoisted?(hoisted+' shown separately'):'')+
        (sys?'':tile('Boosts',boosts,level?('Level '+level):'not boosted'))+
        (sys?'':tile('Custom emoji',emoji))+
        (sys?'':tile('Upcoming events',events))+
        (sys?'':tile('Banned',bans))+
        tile('Created',created)+
        tile('Messages loaded',loadedMsgs,activeChans+' channel'+(activeChans===1?'':'s')+' open this session')+
      '</div>'+dist;
  }
});
