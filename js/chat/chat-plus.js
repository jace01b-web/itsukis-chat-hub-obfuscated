/* ==========================================================================
 * js/chat/chat-plus.js  (v54)
 *
 * The chat-side features v54 added:
 *   DPins      pinned messages                      pins/$key/$msg   (rules already existed)
 *   DSaved     saved messages / bookmarks           saved/$uid/$id
 *   search     find a message, and jump to it
 *   unread     the "new messages" divider
 *   mentions   @role and #channel on top of @user
 *   ignore     collapse somebody you have ignored, rather than blocking them
 *
 * HOW IT ATTACHES
 *   The message row, the hover toolbar and the header are built by js/chat/messages.js and
 *   js/chat/chat-header.js. Both are long, both work, and both are measured by
 *   test/run-visual.js - so neither is edited. msgEl() and renderMessages() are WRAPPED and the
 *   extra pieces are added to what they produce. That also means a failure in here degrades to
 *   "the new buttons are missing" rather than "chat is broken".
 *
 * THE ONE PLACE pins/ WAS ALREADY WAITING
 *   The pins node has been in firebase-rules.json since the Discord rebuild and nothing ever
 *   read or wrote it. Its rule says: readable by anyone signed in, writable by site staff or by
 *   somebody with Manage Messages in the server that owns the channel, value must be a number.
 *   So the timestamp is the value, and no rules change was needed for pinning at all.
 * ========================================================================== */
'use strict';

/* ======================================================================
 *  PINNED MESSAGES
 * ====================================================================== */
const DPins=(function(){
  const S={byKey:{}};
  const watching={};
  const subs=new Set();
  function emit(){subs.forEach(f=>{try{f()}catch(e){console.warn('[DPins] subscriber failed',e)}})}

  /* One channel at a time - the one open. A pin list per channel per session would be a listener
     per channel, which is the sort of thing that quietly multiplies. */
  function watch(key){
    Object.keys(watching).forEach(k=>{if(k!==key)unwatch(k)});
    if(!key||watching[key])return;
    watching[key]=onValue(R('pins/'+key),s=>{
      S.byKey[key]=s.val()||{};emit();
    },e=>console.warn('[DPins] denied',key,e&&e.code));
  }
  function unwatch(key){
    const u=watching[key];if(!u)return;
    try{u()}catch(_){}
    delete watching[key];delete S.byKey[key];
  }

  function idsFor(key){
    const raw=S.byKey[key]||{};
    return Object.keys(raw).filter(id=>Number(raw[id])>0)
      .sort((a,b)=>Number(raw[b])-Number(raw[a]));
  }
  function count(key){return idsFor(key).length}
  function isPinned(key,msg){return Number((S.byKey[key]||{})[msg])>0}

  /* Whether this viewer may pin in this channel.
     The database rule would in fact let a site owner pin in anybody's DM - it gates on the
     message key and site staff pass for every key. That is not something to offer: a DM is two
     people's, and a pinned-messages list nobody in that conversation asked for is a surprise.
     So DMs are refused here, by everyone, and the rest mirrors the rule: site staff anywhere
     else, or Manage Messages in the server that owns the channel. */
  function canPin(key){
    try{
      if(!ME||!key)return false;
      if(String(key).indexOf('dm_')===0)return false;
      if(isStaff(ME.id))return true;
      const ch=DModel.channelByKey(key);
      if(!ch)return false;
      if(DModel.isSystem(ch.sid))return false;    /* ICH's channels are staff-only to pin */
      return DModel.can(ch.sid,'manageMsg',ME.id);
    }catch(_){return false}
  }

  const MAX=50;

  async function pin(key,msg){
    if(!canPin(key))throw new Error('You need Manage Messages in this channel to pin.');
    if(count(key)>=MAX)throw new Error('This channel already has '+MAX+' pinned messages. Unpin one first.');
    await set(R('pins/'+key+'/'+msg),Date.now()+SKEW);
    try{PAch.award('first_pin')}catch(_){}
  }
  async function unpin(key,msg){
    if(!canPin(key))throw new Error('You need Manage Messages in this channel to unpin.');
    await remove(R('pins/'+key+'/'+msg));
  }
  async function toggle(key,msg){
    return isPinned(key,msg)?unpin(key,msg):pin(key,msg);
  }

  return{watch,unwatch,idsFor,count,isPinned,canPin,pin,unpin,toggle,MAX,
         onChange:f=>{subs.add(f);return()=>subs.delete(f)}};
})();

/* ======================================================================
 *  SAVED MESSAGES (bookmarks)
 *  Yours alone, both ways - saved/$uid is readable and writable only by $uid.
 * ====================================================================== */
const DSaved=(function(){
  const S={items:{}};
  let myId=null,unsub=null;
  const subs=new Set();
  function emit(){subs.forEach(f=>{try{f()}catch(_){}})}

  function start(id){
    stop();
    myId=Number(id);
    if(!Number.isFinite(myId))return;
    unsub=onValue(R('saved/'+myId),s=>{S.items=s.val()||{};emit()},
      e=>console.warn('[DSaved] denied',e&&e.code));
  }
  function stop(){
    if(unsub){try{unsub()}catch(_){}unsub=null}
    S.items={};myId=null;
  }
  function ensureStarted(id){if(Number(id)!==myId)start(id)}

  /* The id is derived from the channel and the message, so saving twice is idempotent and
     "is this saved" is answerable without scanning. */
  function idFor(key,msg){
    return String(key+'__'+msg).replace(/[.#$/\[\]]/g,'_').slice(0,120);
  }
  function has(key,msg){return !!S.items[idFor(key,msg)]}
  function list(){
    return Object.keys(S.items).map(id=>({id,...S.items[id]}))
      .filter(x=>x&&x.key&&x.msg&&Number(x.at)>0)
      .sort((a,b)=>b.at-a.at);
  }
  function count(){return list().length}

  const MAX=200;

  async function save(key,msg){
    if(myId==null)return;
    const id=idFor(key,msg);
    if(S.items[id])return unsave(key,msg);
    if(count()>=MAX)throw new Error('You have '+MAX+' saved messages, which is the limit. Remove one first.');
    const m=(DB.messages(key)||[]).find(x=>x.id===msg);
    const rec={key:String(key).slice(0,64),msg:String(msg).slice(0,64),at:Date.now()+SKEW};
    if(m){
      rec.by=Number(m.senderId)||0;
      /* A short copy of the text, so the list is readable without loading every channel the
         saved messages came from. mdPlain strips the markup and hides spoilers. */
      let t='';
      try{t=(typeof mdPlain==='function')?mdPlain(String(m.text||'')):String(m.text||'')}
      catch(_){t=String(m.text||'')}
      if(!t&&((m.images&&m.images.length)||(m.files&&m.files.length)))t='(attachment)';
      if(t)rec.text=t.slice(0,300);
    }
    await set(R('saved/'+myId+'/'+id),rec);
  }
  async function unsave(key,msg){
    if(myId==null)return;
    await remove(R('saved/'+myId+'/'+idFor(key,msg)));
  }
  async function removeById(id){
    if(myId==null)return;
    await remove(R('saved/'+myId+'/'+id));
  }

  return{start,stop,ensureStarted,has,list,count,save,unsave,removeById,MAX,
         onChange:f=>{subs.add(f);return()=>subs.delete(f)}};
})();

/* ======================================================================
 *  IGNORED USERS
 *  A lighter alternative to blocking: their messages collapse to one line you can expand.
 *  Nothing is sent to them and they are not told, which is the point. Kept on this device
 *  (js/settings/settings-plus.js owns the list and the storage).
 * ====================================================================== */
function ignoredRowHTML(m,name){
  return '<div class="ig-row" data-ig-show="'+esc(String(m.id))+'">'+
    '<span class="ig-ic">\u{1F6AB}</span>'+
    '<span>Message from <b>'+esc(name)+'</b>, who you’re ignoring. '+
    '<button type="button" class="ig-btn">Show it</button></span></div>';
}

/* ======================================================================
 *  THE MESSAGE ROW - extra hover buttons, pin marker, ignore collapse
 * ====================================================================== */
const _msgEl_v53=msgEl;
msgEl=function(m){
  const el=_msgEl_v53(m);
  try{decorateMsg(el,m)}catch(e){console.warn('[chat-plus] row decoration failed',e)}
  return el;
};

/* Messages the reader has chosen to reveal despite ignoring their author. Without this,
   re-decorating a row (which happens on every repaint, and immediately after the reveal itself)
   collapses it straight back - so "Show it" appeared to do nothing. Cleared when the channel
   changes, because it is a per-reading decision, not a setting. */
const _igShown=new Set();

function decorateMsg(el,m){
  if(!m||m.sys||!ME)return;
  const key=view.roomKey;

  /* ---- ignored: replace the whole row with a one-line stub ---- */
  if(m.senderId!==ME.id&&!_igShown.has(m.id)&&typeof Ignored!=='undefined'&&Ignored.has(m.senderId)){
    const u=DB.getUser(m.senderId);
    const name=u?dispName(u,'User '+m.senderId):('User '+m.senderId);
    el.classList.add('ig-collapsed');
    el.dataset.igName=name;
    const keep=el.innerHTML;
    el.innerHTML=ignoredRowHTML(m,name);
    const b=el.querySelector('.ig-btn');
    if(b)b.onclick=ev=>{
      ev.stopPropagation();
      _igShown.add(m.id);
      el.classList.remove('ig-collapsed');
      el.innerHTML=keep;
      try{wireReactions(el,m)}catch(_){}
      try{decorateMsg(el,m)}catch(_){}
      el.querySelectorAll('[data-open-profile]').forEach(p=>p.onclick=()=>openUserProfile(Number(p.dataset.openProfile)));
    };
    return;
  }

  /* ---- pinned marker ---- */
  if(key&&DPins.isPinned(key,m.id)){
    el.classList.add('is-pinned');
    const meta=el.querySelector('.meta');
    if(meta&&!meta.querySelector('.pin-mark')){
      const s=document.createElement('span');
      s.className='pin-mark';s.title='Pinned';s.setAttribute('aria-label','Pinned');
      s.textContent='\u{1F4CC}';
      meta.appendChild(s);
    }
  }

  /* ---- extra hover-bar buttons, in Discord's order: pin, save ---- */
  const bar=el.querySelector('.msg-hover-bar');
  if(!bar)return;
  const _fi=d=>'<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="'+d+'"/></svg>';
  const PIN_IC=_fi('M16 3v2l-1 1v5l3 3v2h-5v5l-1 1-1-1v-5H6v-2l3-3V6L8 5V3h8z');
  const SAVE_IC=_fi('M6 2h12a1 1 0 0 1 1 1v18l-7-4-7 4V3a1 1 0 0 1 1-1z');

  if(key&&DPins.canPin(key)){
    const pinned=DPins.isPinned(key,m.id);
    const b=document.createElement('button');
    b.type='button';
    b.title=pinned?'Unpin message':'Pin message';
    b.setAttribute('aria-label',b.title);
    b.innerHTML=PIN_IC;
    if(pinned)b.classList.add('hb-on');
    b.onclick=async ev=>{
      ev.stopPropagation();
      b.disabled=true;
      try{await DPins.toggle(key,m.id);toast(pinned?'Unpinned.':'Pinned.')}
      catch(e){toast((e&&e.message)||'Could not pin that.','bad')}
      b.disabled=false;
    };
    bar.insertBefore(b,bar.firstChild);
  }

  if(key){
    const saved=DSaved.has(key,m.id);
    const b=document.createElement('button');
    b.type='button';
    b.title=saved?'Remove from saved':'Save message';
    b.setAttribute('aria-label',b.title);
    b.innerHTML=SAVE_IC;
    if(saved)b.classList.add('hb-on');
    b.onclick=async ev=>{
      ev.stopPropagation();
      b.disabled=true;
      try{await DSaved.save(key,m.id);toast(saved?'Removed from saved.':'Saved.')}
      catch(e){toast((e&&e.message)||'Could not save that.','bad')}
      b.disabled=false;
    };
    bar.insertBefore(b,bar.firstChild);
  }
}

/* ======================================================================
 *  THE UNREAD DIVIDER
 *
 *  Where it goes is worked out from DB.unreadIn(key) captured at the MOMENT THE CHANNEL IS
 *  OPENED - which is the only moment it is still true. renderMain() marks the channel read
 *  before it paints, so by render time the count is always zero; reading it there is the trap
 *  this avoids. selectRoom() is the one function every channel switch goes through.
 * ====================================================================== */
const _unreadAt={};
const _selectRoom_v53=selectRoom;
selectRoom=function(k){
  try{
    if(k&&k!==view.roomKey){
      let n=0;try{n=Number(DB.unreadIn(k))||0}catch(_){}
      if(n>0)_unreadAt[k]=n;else delete _unreadAt[k];
      _igShown.clear();
    }
    DPins.watch(k);
  }catch(e){console.warn('[chat-plus] selectRoom hook failed',e)}
  return _selectRoom_v53.apply(null,arguments);
};

const _renderMessages_v53=renderMessages;
renderMessages=function(key){
  const out=_renderMessages_v53.apply(null,arguments);
  try{placeUnreadDivider(key)}catch(e){console.warn('[chat-plus] divider failed',e)}
  try{refreshPinBar()}catch(e){console.warn('[chat-plus] pin bar failed',e)}
  return out;
};

function placeUnreadDivider(key){
  const box=$('#messages');if(!box)return;
  clearDividerIfCaughtUp(key);
  const old=box.querySelector('.unread-div');if(old)old.remove();
  const n=_unreadAt[key];
  if(!n||n<1)return;
  const rows=[...box.querySelectorAll('.msg')];
  if(!rows.length||n>=rows.length+1){delete _unreadAt[key];return}
  const target=rows[rows.length-n];
  if(!target){delete _unreadAt[key];return}
  const d=document.createElement('div');
  d.className='unread-div';
  d.innerHTML='<span class="unread-l"></span><span class="unread-t">New</span>';
  target.parentNode.insertBefore(d,target);
}

/* Sending something means you have caught up, so the divider must go - otherwise it sits above
   your own message, which reads as nonsense. Detected from the list itself rather than from a
   new event the composer would have to remember to fire. */
function clearDividerIfCaughtUp(key){
  try{
    const list=DB.messages(key)||[];
    if(list.length&&list[list.length-1].senderId===ME.id)delete _unreadAt[key];
  }catch(_){}
}

/* ======================================================================
 *  THE HEADER BUTTONS AND THE PANELS
 * ====================================================================== */
function ensureHeaderButtons(){
  const host=document.querySelector('.topbar .tb-right');
  if(!host||document.getElementById('cpPinBtn'))return;
  const mk=(id,title,svg)=>{
    const b=document.createElement('button');
    b.type='button';b.id=id;b.className='btn sec small cp-hb';
    b.title=title;b.setAttribute('aria-label',title);
    b.innerHTML=svg;
    return b;
  };
  const pin=mk('cpPinBtn','Pinned messages',
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M16 3v2l-1 1v5l3 3v2h-5v5l-1 1-1-1v-5H6v-2l3-3V6L8 5V3h8z"/></svg><span class="cp-n" id="cpPinN"></span>');
  const search=mk('cpSearchBtn','Search messages',
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>');
  const saved=mk('cpSavedBtn','Saved messages',
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M6 2h12a1 1 0 0 1 1 1v18l-7-4-7 4V3a1 1 0 0 1 1-1z"/></svg>');
  const first=host.firstChild;
  host.insertBefore(saved,first);
  host.insertBefore(search,saved);
  host.insertBefore(pin,search);
  pin.onclick=()=>openPinsPanel();
  search.onclick=()=>openSearchPanel();
  saved.onclick=()=>openSavedPanel();
}

function refreshPinBar(){
  ensureHeaderButtons();
  const btn=document.getElementById('cpPinBtn');
  if(!btn)return;
  const key=view.roomKey;
  const isDm=!!(key&&String(key).indexOf('dm_')===0);
  /* Pins are a channel thing; a DM has no Manage Messages and no staff, so the button would do
     nothing there. Hidden rather than shown-and-broken. */
  btn.classList.toggle('hidden',!key||isDm);
  const n=key?DPins.count(key):0;
  const nEl=document.getElementById('cpPinN');
  if(nEl){nEl.textContent=n?String(n):'';nEl.classList.toggle('on',n>0)}
  const sb=document.getElementById('cpSearchBtn');
  if(sb)sb.classList.toggle('hidden',!key);
  const svb=document.getElementById('cpSavedBtn');
  if(svb)svb.classList.toggle('hidden',!ME);
}

/* A side panel, used by all three lists. Lives inside .main so it sits beside the messages the
   way Discord's does, rather than over them as a modal. */
function cpPanel(title,sub){
  const host=document.querySelector('.main')||document.body;
  const old=document.getElementById('cpPanel');if(old)old.remove();
  const el=document.createElement('div');
  el.id='cpPanel';el.className='cp-panel';
  el.innerHTML=
    '<div class="cp-head"><span class="cp-title">'+esc(title)+'</span>'+
      '<button type="button" class="cp-x" aria-label="Close" title="Close">✕</button></div>'+
    (sub?'<div class="cp-sub">'+sub+'</div>':'')+
    '<div class="cp-body"></div>';
  host.appendChild(el);
  const close=()=>{el.remove();document.removeEventListener('keydown',onKey,true)};
  function onKey(e){if(e.key==='Escape'){e.stopPropagation();close()}}
  document.addEventListener('keydown',onKey,true);
  el.querySelector('.cp-x').onclick=close;
  return{root:el,body:el.querySelector('.cp-body'),close};
}

/* One row shape for pins, search hits and saved messages, so all three read the same. */
function cpMsgRow(m,opts){
  opts=opts||{};
  const u=m.senderId!=null?DB.getUser(Number(m.senderId)):null;
  const name=u?dispName(u,'User '+m.senderId):(opts.fallbackName||'Unknown');
  const when=Number(m.at)>0?new Date(Number(m.at)).toLocaleString():'';
  let body='';
  try{body=(typeof mdPlain==='function')?mdPlain(String(m.text||'')):String(m.text||'')}
  catch(_){body=String(m.text||'')}
  if(!body)body=((m.images&&m.images.length)||(m.files&&m.files.length))?'(attachment)':'(no text)';
  return '<div class="cp-row" data-cp-jump="'+esc(String(m.id||''))+'"'+
      (opts.key?' data-cp-key="'+esc(opts.key)+'"':'')+
      (opts.rid?' data-cp-rid="'+esc(opts.rid)+'"':'')+'>'+
    '<span class="cp-av">'+(u?avatarHtml(u,name,'width:30px;height:30px;font-size:12px'):'')+'</span>'+
    '<span class="cp-b">'+
      '<span class="cp-top"><b>'+esc(name)+'</b><i>'+esc(when)+'</i></span>'+
      '<span class="cp-tx">'+esc(body.slice(0,300))+'</span>'+
      (opts.where?'<span class="cp-where">'+esc(opts.where)+'</span>':'')+
    '</span>'+
    (opts.action?'<button type="button" class="cp-act" data-cp-act="'+esc(String(m.id||opts.rid||''))+'">'+esc(opts.action)+'</button>':'')+
  '</div>';
}

function cpWireRows(p){
  p.body.querySelectorAll('[data-cp-jump]').forEach(row=>{
    row.onclick=ev=>{
      if(ev.target.closest('[data-cp-act]'))return;
      const k=row.dataset.cpKey;
      const id=row.dataset.cpJump;
      if(k&&k!==view.roomKey){
        /* A saved message from another channel: go there first, then jump once it has painted. */
        selectRoom(k);
        setTimeout(()=>jumpToMessage(id),500);
      }else jumpToMessage(id);
    };
  });
}

function openPinsPanel(){
  const key=view.roomKey;if(!key)return;
  const p=cpPanel('Pinned Messages',
    DPins.canPin(key)?'':'Only people who can manage messages here may pin or unpin.');
  const paint=()=>{
    const ids=DPins.idsFor(key);
    const all=DB.messages(key)||[];
    const rows=ids.map(id=>({id,m:all.find(x=>x.id===id)}));
    const found=rows.filter(r=>r.m);
    const missing=rows.length-found.length;
    p.body.innerHTML=
      (found.length?found.map(r=>cpMsgRow(r.m,{action:DPins.canPin(key)?'Unpin':''})).join(''):'')+
      (!rows.length?'<div class="cp-empty">Nothing pinned in this channel yet.<br><small>Hover a message and use the pin button.</small></div>':'')+
      (missing?'<div class="cp-note">'+missing+' pinned message'+(missing===1?' is':'s are')+
        ' older than what is loaded here. Scroll up to load more history and they will appear.</div>':'');
    cpWireRows(p);
    p.body.querySelectorAll('[data-cp-act]').forEach(b=>b.onclick=async ev=>{
      ev.stopPropagation();
      b.disabled=true;
      try{await DPins.unpin(key,b.dataset.cpAct);paint()}
      catch(e){toast((e&&e.message)||'Could not unpin.','bad');b.disabled=false}
    });
  };
  paint();
  const off=DPins.onChange(()=>{if(document.body.contains(p.root))paint();else off()});
}

function openSavedPanel(){
  const p=cpPanel('Saved Messages','Only you can see these. '+DSaved.count()+' of '+DSaved.MAX+'.');
  const paint=()=>{
    const list=DSaved.list();
    if(!list.length){
      p.body.innerHTML='<div class="cp-empty">Nothing saved yet.<br><small>Hover any message and use the bookmark button.</small></div>';
      return;
    }
    p.body.innerHTML=list.map(it=>{
      const live=(DB.messages(it.key)||[]).find(x=>x.id===it.msg);
      const m=live||{id:it.msg,senderId:it.by,at:it.at,text:it.text||'',images:[],files:[]};
      return cpMsgRow(m,{key:it.key,rid:it.id,action:'Remove',where:chanLabel(it.key)});
    }).join('');
    cpWireRows(p);
    p.body.querySelectorAll('[data-cp-act]').forEach(b=>b.onclick=async ev=>{
      ev.stopPropagation();
      const row=b.closest('[data-cp-rid]');
      b.disabled=true;
      try{await DSaved.removeById(row.dataset.cpRid);paint()}
      catch(e){toast('Could not remove that.','bad');b.disabled=false}
    });
  };
  paint();
  const off=DSaved.onChange(()=>{if(document.body.contains(p.root))paint();else off()});
}

/* A readable name for a message key, for the saved list - "#general", "DM with suki". */
function chanLabel(key){
  key=String(key||'');
  try{
    if(key.indexOf('dm_')===0){
      const [,a,b]=key.split('_').map(Number);
      const other=a===ME.id?b:a;
      const u=DB.getUser(other);
      return 'DM with '+(u?dispName(u,'User '+other):('User '+other));
    }
    const ch=DModel.channelByKey(key);
    if(ch){
      const srv=DModel.server(ch.sid);
      return '#'+ch.name+(srv&&srv.id!==DModel.ICH_ID?(' · '+srv.name):'');
    }
  }catch(_){}
  return key;
}

function openSearchPanel(){
  const key=view.roomKey;if(!key)return;
  const p=cpPanel('Search',
    'Searches the messages loaded in this channel. Scroll up first to search further back.');
  p.body.innerHTML=
    '<div class="cp-sfield"><input id="cpQ" type="text" placeholder="Search this channel" autocomplete="off" spellcheck="false"></div>'+
    '<div class="cp-sopts">'+
      '<label><input type="checkbox" id="cpMine"> Only mine</label>'+
      '<label><input type="checkbox" id="cpHasFile"> Has an attachment</label>'+
      '<label><input type="checkbox" id="cpAll"> Every loaded channel</label>'+
    '</div>'+
    '<div id="cpResults"></div>';
  const qi=p.body.querySelector('#cpQ');
  const run=()=>{
    const host=p.body.querySelector('#cpResults');
    const t=qi.value.trim().toLowerCase();
    const mine=p.body.querySelector('#cpMine').checked;
    const hasFile=p.body.querySelector('#cpHasFile').checked;
    const everywhere=p.body.querySelector('#cpAll').checked;
    if(!t&&!mine&&!hasFile){host.innerHTML='<div class="cp-empty">Type something to search.</div>';return}

    const keys=everywhere?loadedKeys():[key];
    const hits=[];
    keys.forEach(k=>{
      (DB.messages(k)||[]).forEach(m=>{
        if(mine&&m.senderId!==ME.id)return;
        if(hasFile&&!((m.images&&m.images.length)||(m.files&&m.files.length)))return;
        if(t){
          const u=DB.getUser(m.senderId);
          const hay=(String(m.text||'')+' '+(u?dispName(u,''):'')+' '+(u?u.username:'')).toLowerCase();
          if(!hay.includes(t))return;
        }
        hits.push({k,m});
      });
    });
    hits.sort((a,b)=>b.m.at-a.m.at);
    const shown=hits.slice(0,200);
    if(!shown.length){host.innerHTML='<div class="cp-empty">No matches in what is loaded.</div>';return}
    host.innerHTML='<div class="cp-note">'+hits.length+' match'+(hits.length===1?'':'es')+
      (hits.length>200?' — showing the newest 200':'')+'</div>'+
      shown.map(h=>cpMsgRow(h.m,{key:h.k,where:everywhere?chanLabel(h.k):''})).join('');
    cpWireRows(p);
  };
  let t=0;
  qi.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(run,160)});
  qi.addEventListener('keydown',e=>e.stopPropagation());
  p.body.querySelectorAll('.cp-sopts input').forEach(c=>c.onchange=run);
  run();
  setTimeout(()=>{try{qi.focus()}catch(_){}},40);
}

/* Which message keys this session has actually loaded - the only ones searchable without going
   back to the server for every channel on the site. */
function loadedKeys(){
  const out=new Set();
  try{
    [CFG.GLOBAL_ROOM,CFG.ANNOUNCEMENTS_ROOM,CFG.SHITPOST_ROOM,CFG.VIP_ROOM,CFG.MVP_ROOM].forEach(k=>{
      if((DB.messages(k)||[]).length)out.add(k);
    });
    DModel.myServers().forEach(s=>{
      DModel.channels(s.id).forEach(c=>{if((DB.messages(c.id)||[]).length)out.add(c.id)});
    });
    /* Every DM, not only the ones with friends - an accepted message request is a
       conversation like any other and searching "everywhere" has to mean everywhere. */
    (DB.dmPartners(ME.id)||[]).forEach(f=>{
      const k=DB.dmKey(ME.id,f);
      if((DB.messages(k)||[]).length)out.add(k);
    });
  }catch(_){}
  if(view.roomKey)out.add(view.roomKey);
  return[...out];
}

/* ======================================================================
 *  MENTIONS: @role and #channel, on top of @user
 *
 *  updateMentionPop is replaced rather than wrapped, because the pop's contents are rebuilt
 *  wholesale on every keystroke - appending to them would be undone by the next one. The emoji
 *  half still goes through the original updateEmojiPop, so there is one emoji autocomplete.
 * ====================================================================== */
function mentionRoles(){
  try{
    const sid=view.sid;
    if(!sid||DModel.isSystem(sid)||view.mode==='dms')return [];
    const canAll=DModel.can(sid,'mentionAll',ME.id)||isOwner(ME.id);
    return DModel.roles(sid)
      .filter(r=>!r.everyone&&!r.virtual&&(r.mentionable||canAll))
      .slice(0,40);
  }catch(_){return []}
}
function mentionChannels(){
  try{
    const sid=view.sid;
    if(!sid||view.mode==='dms')return [];
    /* visibleChannels(sid,uid) - the uid is not optional; without it a private channel would
       be offered to somebody who cannot see it. */
    return DModel.visibleChannels(sid,ME.id).filter(c=>c.type!=='voice').slice(0,60);
  }catch(_){return []}
}

updateMentionPop=function(){
  const pop=$('#mentionPop');if(!pop)return;
  const pos=msgIn.selectionStart;
  const before=msgIn.value.slice(0,pos);

  /* Emoji first, exactly as before - including the instant ":name:" swap. */
  try{if(Prefs.get('emojiSuggest')!==false&&updateEmojiPop(pop,pos,before))return}
  catch(e){console.warn('[mentions] emoji pass failed',e)}

  const insert=(start,text)=>{
    msgIn.value=msgIn.value.slice(0,start)+text+' '+msgIn.value.slice(pos);
    msgIn.focus();pop.classList.add('hidden');
    const np=start+text.length+1;msgIn.setSelectionRange(np,np);
    const cc=$('#cc');if(cc)cc.textContent=msgIn.value.length;
  };

  const show=opts=>{
    if(!opts.length){pop.classList.add('hidden');return}
    view.mentionSel=0;pop.innerHTML='';
    opts.slice(0,8).forEach((o,i)=>{
      const d=document.createElement('div');
      d.className=i===0?'sel':'';
      d.innerHTML=o.html;
      d.onclick=o.pick;
      pop.appendChild(d);
    });
    pop.classList.remove('hidden');
  };

  /* ---- #channel ---- */
  const cm=before.match(/(?:^|\s)#([a-zA-Z0-9_\-]*)$/);
  if(cm){
    const q=cm[1].toLowerCase();
    const list=mentionChannels().filter(c=>String(c.name).toLowerCase().indexOf(q)>=0);
    show(list.map(c=>({
      html:'<span class="mp-ic">#</span>'+esc(c.name),
      pick:()=>insert(pos-cm[1].length-1,'#'+c.name)
    })));
    if(list.length)return;
  }

  /* ---- @user and @role ---- */
  const m=before.match(/@([0-9a-zA-Z._\- ]*)$/);
  if(!m){pop.classList.add('hidden');return}
  const q=m[1].toLowerCase();
  /* A role name can contain spaces, a username cannot. Allowing spaces in the capture is what
     makes "@Server Mod" reachable; it is trimmed before matching so "@ " does not match all. */
  const qTrim=q.trim();
  const opts=[];

  if(view.roomKey!==null&&!String(view.roomKey).startsWith('dm_')&&'everyone'.startsWith(qTrim)){
    opts.push({html:'<span class="mp-ic">\u{1F4E3}</span>everyone',pick:()=>insert(pos-m[0].length,'@everyone')});
  }
  mentionRoles().filter(r=>String(r.name).toLowerCase().indexOf(qTrim)>=0&&qTrim!=='')
    .forEach(r=>opts.push({
      html:'<span class="mp-dot" style="background:'+esc(r.color||'#99aab5')+'"></span>'+esc(r.name)+
           '<span class="mp-tag">role</span>',
      pick:()=>insert(pos-m[0].length,'@'+r.name)
    }));
  try{
    mentionCandidates()
      .filter(u=>u&&u.username&&String(u.username).toLowerCase().startsWith(qTrim))
      .slice(0,6)
      .forEach(u=>opts.push({
        html:'<span class="mp-ic">\u{1F464}</span>'+esc(dispName(u))+
             (hasDispName(u)?'<span class="mp-tag">@'+esc(u.username)+'</span>':''),
        pick:()=>insert(pos-m[0].length,'@'+u.username)
      }));
  }catch(e){console.warn('[mentions] user pass failed',e)}

  show(opts);
};

/* extractPings has to understand a role name now, or "@Moderators" would ping nobody and look
   broken. Wrapped: the original still does usernames and @everyone, and the roles are added. */
const _extractPings_v53=extractPings;
extractPings=function(text){
  const base=_extractPings_v53.apply(null,arguments)||[];
  const out=new Set(base);
  try{
    const roles=mentionRoles();
    if(roles.length&&view.sid&&!DModel.isSystem(view.sid)){
      const t=String(text||'');
      roles.forEach(r=>{
        /* Longest-first is not needed here because the whole name must appear; a role called
           "Mod" inside "Moderators" would match both, which is the same thing Discord does when
           two roles share a prefix and the shorter one is written out in full. */
        const re=new RegExp('@'+String(r.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
        if(!re.test(t))return;
        DModel.memberIds(view.sid).forEach(uid=>{
          if(DModel.rolesOf(view.sid,uid).some(x=>x.id===r.id))out.add(Number(uid));
        });
      });
    }
  }catch(e){console.warn('[mentions] role pings failed',e)}
  out.delete(ME&&ME.id);          /* never ping yourself with a role you also hold */
  return[...out].slice(0,99);
};

/* ======================================================================
 *  #channel and @role CHIPS in a rendered message
 *  Text nodes only, same approach as the custom emoji - see js/discord/emoji.js.
 * ====================================================================== */
function chipifyHTML(html){
  const s=String(html==null?'':html);
  if(!/[#@]/.test(s))return s;
  let chans=[],roles=[];
  try{
    const sid=view.sid;
    if(sid&&view.mode!=='dms'){
      chans=DModel.channels(sid).filter(c=>c.type!=='voice');
      roles=DModel.isSystem(sid)?[]:DModel.roles(sid).filter(r=>!r.everyone&&!r.virtual);
    }
  }catch(_){}
  if(!chans.length&&!roles.length)return s;
  try{
    const t=document.createElement('template');
    t.innerHTML=s;
    const walker=document.createTreeWalker(t.content,NodeFilter.SHOW_TEXT,{
      acceptNode(n){
        let p=n.parentNode;
        while(p&&p!==t.content){
          const nn=p.nodeName;
          if(nn==='CODE'||nn==='PRE'||nn==='A')return NodeFilter.FILTER_REJECT;
          p=p.parentNode;
        }
        return /[#@]/.test(n.nodeValue||'')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
      }
    });
    const hits=[];let n;
    while((n=walker.nextNode()))hits.push(n);
    hits.forEach(node=>{
      const text=node.nodeValue;
      const frag=document.createDocumentFragment();
      let i=0,changed=false;
      while(i<text.length){
        const ch=text[i];
        let matched=null;
        if(ch==='#'){
          /* longest name first, so "#general-chat" is not matched as "#general" */
          const cands=chans.slice().sort((a,b)=>String(b.name).length-String(a.name).length);
          for(const c of cands){
            if(text.substr(i+1,String(c.name).length).toLowerCase()===String(c.name).toLowerCase()){
              matched={kind:'ch',rec:c,len:1+String(c.name).length};break;
            }
          }
        }else if(ch==='@'){
          const cands=roles.slice().sort((a,b)=>String(b.name).length-String(a.name).length);
          for(const r of cands){
            if(text.substr(i+1,String(r.name).length).toLowerCase()===String(r.name).toLowerCase()){
              matched={kind:'role',rec:r,len:1+String(r.name).length};break;
            }
          }
        }
        if(matched){
          changed=true;
          if(matched.kind==='ch'){
            const a=document.createElement('span');
            a.className='mchip mchip-ch';
            a.dataset.goCh=matched.rec.key;
            a.textContent='#'+matched.rec.name;
            frag.appendChild(a);
          }else{
            const a=document.createElement('span');
            a.className='mchip mchip-role';
            a.style.setProperty('--rc',matched.rec.color||'#99aab5');
            a.textContent='@'+matched.rec.name;
            frag.appendChild(a);
          }
          i+=matched.len;
        }else{
          /* Accumulate plain text in one node rather than one per character. */
          let j=i+1;
          while(j<text.length&&text[j]!=='#'&&text[j]!=='@')j++;
          frag.appendChild(document.createTextNode(text.slice(i,j)));
          i=j;
        }
      }
      if(changed)node.parentNode.replaceChild(frag,node);
    });
    return t.innerHTML;
  }catch(e){console.warn('[mentions] chips failed',e);return s}
}

const _mdRender_v54a=mdRender;
mdRender=function(text){
  let html;
  try{html=_mdRender_v54a(text)}
  catch(e){console.error('[markdown] failed',e);return esc(String(text==null?'':text))}
  try{return chipifyHTML(html)}catch(_){return html}
};

/* A channel chip is clickable. Delegated, so it works for every message without wiring each. */
document.addEventListener('click',e=>{
  const chip=e.target.closest&&e.target.closest('.mchip-ch');
  if(!chip||!ME)return;
  const key=chip.dataset.goCh;
  if(!key)return;
  e.preventDefault();
  try{selectRoom(key)}catch(err){console.warn('[mentions] chip jump failed',err)}
});

/* ======================================================================
 *  A PIN, A SAVE AND AN IGNORE FROM THE RIGHT-CLICK MENU TOO
 *  Discord puts all three on the message context menu as well as the hover bar.
 * ====================================================================== */
document.addEventListener('contextmenu',e=>{
  if(!ME)return;
  const row=e.target.closest&&e.target.closest('#messages .msg');
  if(!row||!row.dataset.msgId)return;
  /* Leave the existing menus alone: if something else has already opened one, stand down. The
     same rule js/ui/context-menu.js uses, and for the same reason. */
  if(document.querySelector('.dctx'))return;
  const key=view.roomKey;if(!key)return;
  const id=row.dataset.msgId;
  const m=(DB.messages(key)||[]).find(x=>x.id===id);
  if(!m)return;
  e.preventDefault();
  const items=[];
  if(DPins.canPin(key))
    items.push({label:DPins.isPinned(key,id)?'Unpin Message':'Pin Message',onClick:()=>{
      DPins.toggle(key,id).catch(err=>toast((err&&err.message)||'Could not pin.','bad'));
    }});
  items.push({label:DSaved.has(key,id)?'Remove from Saved':'Save Message',onClick:()=>{
    DSaved.save(key,id).catch(err=>toast((err&&err.message)||'Could not save.','bad'));
  }});
  if(m.text)items.push({label:'Copy Text',onClick:()=>copyText(String(m.text)).then(ok=>toast(ok?'Copied':'Could not copy',ok?'':'bad'))});
  items.push({label:'Reply',onClick:()=>startReply(m)});
  if(m.senderId!==ME.id){
    items.push({sep:true});
    items.push({label:'Profile',onClick:()=>openUserProfile(Number(m.senderId))});
    items.push({label:Ignored.has(m.senderId)?'Stop Ignoring':'Ignore This Person',onClick:()=>{
      Ignored.toggle(m.senderId);
      toast(Ignored.has(m.senderId)?'Ignored. Their messages will collapse.':'No longer ignoring them.');
    }});
  }
  if(Prefs.get('devMode')){
    items.push({sep:true});
    items.push({label:'Copy Message ID',onClick:()=>copyText(String(id)).then(ok=>toast(ok?'ID copied':'Could not copy',ok?'':'bad'))});
  }
  openCtx(e,items);
},true);

/* Also add Ignore to the profile overflow menu, where somebody would look for it. */
(function addIgnoreToProfileMenu(){
  /* PCard.openMore is internal, so the entry is added by listening for the menu being built is
     not possible - instead the menu item is appended to the live .dctx when one opens from a
     profile card. Simple, and it cannot break the menu if the markup changes. */
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('.pf2-ib[data-pf="more"]');
    if(!b||!ME)return;
    setTimeout(()=>{
      const menu=document.querySelector('.dctx');
      if(!menu||menu.querySelector('[data-cp-ign]'))return;
      const id=PCard.openedId();
      if(id==null||id===ME.id)return;
      const item=document.createElement('div');
      item.className=menu.firstElementChild?menu.firstElementChild.className:'dctx-item';
      item.dataset.cpIgn='1';
      item.textContent=Ignored.has(id)?'Stop Ignoring':'Ignore';
      item.onclick=()=>{
        Ignored.toggle(id);
        toast(Ignored.has(id)?'Ignored.':'No longer ignoring them.');
        closeCtx();
      };
      menu.appendChild(item);
    },30);
  },true);
})();

/* Repaint the message list when a pin lands or a save changes, so the marker and the hover
   button state are never stale. Coalesced on a frame, like every other subscriber. */
(function wirePinRepaint(){
  let pend=false;
  const bump=()=>{
    if(pend||!ME)return;
    pend=true;
    requestAnimationFrame(()=>{
      pend=false;
      if(!ME||view.page!=='chatPage')return;
      try{refreshPinBar()}catch(_){}
      try{renderedKey=null;renderChat()}catch(_){}
    });
  };
  try{DPins.onChange(bump)}catch(_){}
  try{DSaved.onChange(()=>{try{refreshPinBar()}catch(_){}})}catch(_){}
})();
