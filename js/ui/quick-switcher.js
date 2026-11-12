/* ==========================================================================
 * js/ui/quick-switcher.js  (v54)
 *
 * Ctrl+K / Cmd+K: one box that gets you anywhere. Discord's quick switcher, plus the things
 * only this site has (the Daily Spin, the game hubs, the shop, Trick-or-Treat) so there is one
 * place to reach everything rather than a tour of three menus.
 *
 * WHAT IT SEARCHES
 *   channels in every server you are in, servers themselves, your friends (as DMs), the site
 *   rows ICH carries, every settings pane by name, and a handful of actions.
 *
 * WHY THE MATCHING IS WHAT IT IS
 *   Prefix match scores highest, then word-start, then "contains", then a loose
 *   letters-in-order match so "gnrl" finds #general. Recency breaks ties, because the thing you
 *   just left is usually the thing you want next - which is the whole point of a switcher and
 *   the one thing an alphabetical list gets wrong.
 * ========================================================================== */
'use strict';

const QuickSwitch=(function(){

  let el=null,items=[],sel=0,q='';

  /* ---- recency: the last dozen places you opened, newest first ---- */
  const RK='ich.recent';
  function recent(){
    try{return JSON.parse(localStorage.getItem(RK)||'[]').filter(x=>typeof x==='string')}
    catch(_){return []}
  }
  function remember(id){
    try{
      const list=[id,...recent().filter(x=>x!==id)].slice(0,12);
      localStorage.setItem(RK,JSON.stringify(list));
    }catch(_){}
  }
  function recentRank(id){
    const i=recent().indexOf(id);
    return i<0?0:(12-i);
  }

  /* ---- scoring ---- */
  function score(text,query){
    if(!query)return 1;
    const t=String(text||'').toLowerCase(),s=query;
    if(t===s)return 1000;
    if(t.indexOf(s)===0)return 500;
    const words=t.split(/[\s\-_#/]+/);
    if(words.some(w=>w.indexOf(s)===0))return 300;
    const at=t.indexOf(s);
    if(at>0)return 150-Math.min(100,at);
    /* loose: every letter of the query appears in order */
    let i=0;
    for(const ch of t){if(ch===s[i])i++;if(i===s.length)break}
    return i===s.length?40:0;
  }

  /* ---- what there is to go to ---- */
  function build(){
    const out=[];
    const push=o=>{if(o&&o.label)out.push(o)};

    /* channels, grouped by server */
    try{
      DModel.myServers().forEach(srv=>{
        const chans=DModel.visibleChannels(srv.id,ME.id);
        chans.forEach(c=>push({
          id:'ch:'+c.id,
          kind:c.type==='voice'?'voice':'channel',
          label:(c.type==='voice'?'\u{1F50A} ':'# ')+c.name,
          sub:srv.name,
          search:c.name+' '+srv.name,
          go(){
            remember('ch:'+c.id);
            if(c.type==='voice'){
              if(!DiscordShell.openServer(srv.id))return;
              setTimeout(()=>{
                const row=document.querySelector('.dch[data-ch="'+c.id+'"]');
                if(row)row.click();
              },260);
              return;
            }
            if(srv.id!==view.sid)DiscordShell.openServer(srv.id);
            selectRoom(c.key);
          }
        }));
      });
    }catch(e){console.warn('[switcher] channels',e)}

    /* servers */
    try{
      DModel.myServers().forEach(srv=>push({
        id:'srv:'+srv.id,kind:'server',
        label:srv.name,sub:'Server',search:srv.name,
        go(){remember('srv:'+srv.id);DiscordShell.openServer(srv.id)}
      }));
    }catch(_){}

    /* direct messages - everyone I have a conversation with, not only friends, so a DM that
       began as an accepted message request can be jumped to like any other */
    try{
      (DB.dmPartners(ME.id)||[]).forEach(fid=>{
        const u=DB.getUser(fid);if(!u)return;
        const n=dispName(u,'User '+fid);
        push({
          id:'dm:'+fid,kind:'dm',
          label:'@'+n,sub:'Direct message',search:n+' '+u.username,
          go(){remember('dm:'+fid);view.dmView='chat';selectRoom(DB.dmKey(ME.id,fid));openChat('dms')}
        });
      });
    }catch(_){}

    /* the site rows and actions */
    const acts=[
      ['Friends','People',()=>{view.dmView='friends';openChat('dms')}],
      ['Saved Messages','Yours only',()=>openSavedPanel()],
      ['Search this channel','Messages',()=>openSearchPanel()],
      ['Pinned Messages','This channel',()=>openPinsPanel()],
      ['Games & Hubs','Site',()=>modalGameHubs()],
      ['Shop','Site',()=>openShop()],
      ['Discover Servers','Site',()=>openDiscover()],
      ['Add a Server','Site',()=>openAddServer()],
      ['Daily Spin','Site',()=>{if(typeof openSpin==='function')openSpin()}],
      ['Your Profile','You',()=>openUserProfile(ME.id,{full:true})],
      ['Server Settings','This server',()=>{
        try{
          if(!view.sid||DModel.isSystem(view.sid))return toast('Open a server you can manage first.');
          openServerSettings(view.sid,'overview');
        }catch(_){}
      }]
    ];
    acts.forEach(([label,sub,go])=>push({id:'act:'+label,kind:'action',label,sub,search:label+' '+sub,
      go(){remember('act:'+label);go()}}));

    /* every settings pane, by the name it is listed under */
    try{
      const nav=SET_NAV(DB.currentUser()||ME);
      const re=/data-t="([a-z0-9]+)"[^>]*>.*?<\/i>([^<]*)</g;
      let m;
      while((m=re.exec(nav))){
        const t=m[1],label=String(m[2]||'').replace(/&amp;/g,'&').trim();
        if(!label)continue;
        push({id:'set:'+t,kind:'setting',label:label,sub:'Settings',search:label+' settings',
          go(){remember('set:'+t);openSettings(false,t)}});
      }
    }catch(e){console.warn('[switcher] settings panes',e)}

    return out;
  }

  /* ---- the list, filtered and ranked ---- */
  function ranked(){
    const s=q.trim().toLowerCase();
    const scored=items.map(it=>({it,n:score(it.search||it.label,s)})).filter(x=>x.n>0);
    scored.sort((a,b)=>(b.n+recentRank(b.it.id)*3)-(a.n+recentRank(a.it.id)*3)
      ||String(a.it.label).localeCompare(String(b.it.label)));
    /* With an empty box, show where you have been rather than an alphabetical wall. */
    if(!s){
      const r=recent();
      const known=id=>items.find(i=>i.id===id);
      const head=r.map(known).filter(Boolean);
      const rest=scored.map(x=>x.it).filter(it=>r.indexOf(it.id)<0);
      return[...head,...rest].slice(0,40);
    }
    return scored.map(x=>x.it).slice(0,40);
  }

  const ICONS={channel:'#',voice:'\u{1F50A}',server:'\u{1F3F0}',dm:'@',action:'⚡',setting:'⚙'};

  function paint(){
    if(!el)return;
    const list=ranked();
    if(sel>=list.length)sel=Math.max(0,list.length-1);
    const body=el.querySelector('.qs-body');
    if(!list.length){
      body.innerHTML='<div class="qs-empty">Nothing matches “'+esc(q)+'”.</div>';
      return;
    }
    body.innerHTML=list.map((it,i)=>
      '<div class="qs-row'+(i===sel?' sel':'')+'" data-i="'+i+'">'+
        '<span class="qs-ic">'+esc(ICONS[it.kind]||'•')+'</span>'+
        '<span class="qs-l">'+esc(it.label)+'</span>'+
        (it.sub?'<span class="qs-s">'+esc(it.sub)+'</span>':'')+
      '</div>').join('');
    body.querySelectorAll('.qs-row').forEach(r=>{
      r.onmouseenter=()=>{sel=Number(r.dataset.i);paint()};
      r.onclick=()=>choose(Number(r.dataset.i));
    });
    const cur=body.querySelector('.qs-row.sel');
    if(cur&&cur.scrollIntoView)cur.scrollIntoView({block:'nearest'});
  }

  function choose(i){
    const list=ranked();
    const it=list[i==null?sel:i];
    close();
    if(!it)return;
    try{it.go()}catch(e){console.warn('[switcher] go failed',e);toast('That did not open.','bad')}
  }

  function open(){
    if(el)return;
    if(!ME)return;
    items=build();q='';sel=0;
    el=document.createElement('div');
    el.className='qs-bg';
    el.innerHTML='<div class="qs" role="dialog" aria-label="Quick switcher">'+
      '<input class="qs-in" id="qsIn" type="text" placeholder="Where would you like to go?" autocomplete="off" spellcheck="false" aria-label="Search">'+
      '<div class="qs-body"></div>'+
      '<div class="qs-foot"><span><b>↑↓</b> to move</span><span><b>Enter</b> to go</span><span><b>Esc</b> to close</span></div>'+
    '</div>';
    document.body.appendChild(el);
    const inp=el.querySelector('#qsIn');
    inp.addEventListener('input',()=>{q=inp.value;sel=0;paint()});
    /* Keys are taken in the capture phase: the composer and the shortcut handler both listen on
       document, and this must win while the switcher is open. */
    inp.addEventListener('keydown',e=>{
      e.stopPropagation();
      const list=ranked();
      if(e.key==='ArrowDown'){e.preventDefault();sel=Math.min(list.length-1,sel+1);paint()}
      else if(e.key==='ArrowUp'){e.preventDefault();sel=Math.max(0,sel-1);paint()}
      else if(e.key==='Enter'){e.preventDefault();choose()}
      else if(e.key==='Escape'){e.preventDefault();close()}
      else if(e.key==='Tab'){e.preventDefault();sel=(sel+(e.shiftKey?-1:1)+list.length)%list.length;paint()}
    });
    el.addEventListener('mousedown',e=>{if(e.target===el)close()});
    paint();
    setTimeout(()=>{try{inp.focus()}catch(_){}},20);
  }

  function close(){
    if(!el)return;
    el.remove();el=null;items=[];
  }
  function isOpen(){return !!el}

  return{open,close,isOpen,remember,recent};
})();

/* The binding. Capture phase, and it deliberately works while the composer has focus - which is
   where you are when you want it. Ctrl+K is the browser's "focus the address bar" on some
   builds, so preventDefault is not optional. */
document.addEventListener('keydown',e=>{
  if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
  const k=String(e.key||'').toLowerCase();
  if(k!=='k')return;
  if(typeof ME==='undefined'||!ME)return;
  e.preventDefault();e.stopPropagation();
  if(QuickSwitch.isOpen())QuickSwitch.close();else QuickSwitch.open();
},true);

/* Remember where you have been, so an empty switcher is useful on the first keystroke. Hooked
   onto selectRoom, which every channel and DM switch goes through. */
(function rememberVisits(){
  const orig=selectRoom;
  selectRoom=function(k){
    const out=orig.apply(null,arguments);
    try{
      if(!k)return out;
      if(String(k).indexOf('dm_')===0){
        const [,a,b]=String(k).split('_').map(Number);
        QuickSwitch.remember('dm:'+(a===ME.id?b:a));
      }else{
        let ch=null;try{ch=DModel.channelByKey(k)}catch(_){}
        if(ch)QuickSwitch.remember('ch:'+ch.id);
      }
    }catch(_){}
    return out;
  };
})();
