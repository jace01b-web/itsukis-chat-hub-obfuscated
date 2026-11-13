/* ==========================================================================
 * js/discord/audit.js  (v54)
 *
 * The server audit log: who changed what, and when.
 *
 * BE STRAIGHT ABOUT WHAT THIS IS
 *   Realtime Database rules cannot observe one write and record another, and there is no server
 *   of ours in the loop. So the entry is written BY THE CLIENT THAT DID THE THING, immediately
 *   after the thing itself succeeded. The rules (see scripts/add_rules_v54.py) make that as
 *   trustworthy as it can be from here:
 *     * `by` is forced to be the signed-in account, so an entry can never be attributed to
 *       somebody else;
 *     * entries are append-only - an existing one cannot be edited, by anybody;
 *     * only the server's owner (or a site owner) can delete, which is what "clear the log" is;
 *     * reading needs the View Audit Log permission.
 *   What it does NOT prove is that the action happened: a member could write an entry about
 *   something they did not do. It is a staff-visible record, not evidence. Said once here and
 *   once in the UI, rather than implied to be more than it is.
 *
 * HOW THE ENTRIES GET WRITTEN
 *   Not by sprinkling calls through model.js. Every mutating DModel function is WRAPPED at the
 *   bottom of this file, so:
 *     * the log can never disagree with what actually succeeded (the wrapper only logs after the
 *       original resolves);
 *     * a failed action logs nothing;
 *     * a logging failure can never break the action (every write is fire-and-forget and caught);
 *     * nothing in model.js had to change, so none of its behaviour could regress.
 * ========================================================================== */
'use strict';

const DAudit=(function(){

  /* act -> how it reads, and which icon. Kept in one table so the log and any future filter
     agree on the vocabulary. */
  const ACTS={
    'srv.create'   :{n:'Server created',        ic:'\u{2728}'},
    'srv.update'   :{n:'Server updated',        ic:'⚙'},
    'srv.public'   :{n:'Discovery changed',     ic:'\u{1F9ED}'},
    /* srv.delete is in this table so the label exists, but NOTHING EVER WRITES IT and nothing
       can: deleting a server deletes auditLog/$sid along with it, so an entry recording the
       deletion would be destroyed by the very action it describes. Recording it would need a
       site-wide log node, which does not exist and would need its own rules and retention
       story. Said plainly here rather than left as a mystery for whoever greps for it. */
    'srv.delete'   :{n:'Server deleted',        ic:'\u{1F5D1}'},
    'ch.create'    :{n:'Channel created',       ic:'➕'},
    'ch.update'    :{n:'Channel updated',       ic:'✎'},
    'ch.delete'    :{n:'Channel deleted',       ic:'\u{1F5D1}'},
    'ch.perms'     :{n:'Channel permissions',   ic:'\u{1F512}'},
    'cat.create'   :{n:'Category created',      ic:'➕'},
    'cat.update'   :{n:'Category updated',      ic:'✎'},
    'cat.delete'   :{n:'Category deleted',      ic:'\u{1F5D1}'},
    'role.create'  :{n:'Role created',          ic:'\u{1F3F7}'},
    'role.update'  :{n:'Role updated',          ic:'✎'},
    'role.delete'  :{n:'Role deleted',          ic:'\u{1F5D1}'},
    'role.order'   :{n:'Roles reordered',       ic:'↕'},
    'role.give'    :{n:'Role given',            ic:'➕'},
    'role.take'    :{n:'Role removed',          ic:'➖'},
    'mem.nick'     :{n:'Nickname changed',      ic:'✎'},
    'mem.kick'     :{n:'Member kicked',         ic:'\u{1F462}'},
    'mem.join'     :{n:'Member joined',         ic:'\u{1F44B}'},
    'mem.leave'    :{n:'Member left',           ic:'\u{1F6AA}'},
    'mem.ban'      :{n:'Member banned',         ic:'\u{1F528}'},
    'mem.unban'    :{n:'Member unbanned',       ic:'\u{1F54A}'},
    'mem.timeout'  :{n:'Member timed out',      ic:'\u{1F507}'},
    'mem.untimeout':{n:'Timeout lifted',        ic:'\u{1F50A}'},
    'ip.ban'       :{n:'Network blocked',       ic:'\u{1F6AB}'},
    'ip.unban'     :{n:'Network unblocked',     ic:'✓'},
    'inv.create'   :{n:'Invite created',        ic:'\u{1F517}'},
    'inv.revoke'   :{n:'Invite revoked',        ic:'✕'},
    'emoji.create' :{n:'Emoji added',           ic:'\u{1F604}'},
    'emoji.delete' :{n:'Emoji removed',         ic:'\u{1F5D1}'},
    'event.create' :{n:'Event created',         ic:'\u{1F4C5}'},
    'event.update' :{n:'Event updated',         ic:'✎'},
    'event.delete' :{n:'Event cancelled',       ic:'✕'},
    'welcome.update':{n:'Welcome screen',       ic:'\u{1F4DC}'},
    'log.clear'    :{n:'Audit log cleared',     ic:'\u{1F9F9}'}
  };

  function label(act){return(ACTS[act]&&ACTS[act].n)||String(act)}
  function icon(act){return(ACTS[act]&&ACTS[act].ic)||'•'}

  /* ------------------------------------------------------------------
   *  WRITING
   * ------------------------------------------------------------------ */

  /* Fire-and-forget on purpose. An audit entry is a record of something that already happened;
     if writing it fails, the thing still happened and the person must not be told their action
     failed. Failures are logged to the console so they are findable, and nowhere else. */
  function log(sid,act,fields){
    try{
      if(!sid||sid===DModel.ICH_ID)return;      /* ICH is not a stored server - it has no log */
      if(!ME||!ACTS[act])return;
      const rec={by:Number(ME.id),at:Date.now()+SKEW,act:String(act).slice(0,32)};
      if(fields){
        if(fields.target!=null)rec.target=String(fields.target).slice(0,64);
        if(fields.name)rec.name=String(fields.name).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80);
        if(fields.reason)rec.reason=String(fields.reason).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200);
        if(fields.extra)rec.extra=String(fields.extra).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200);
      }
      const key=push(R('auditLog/'+sid)).key;
      set(R('auditLog/'+sid+'/'+key),rec).catch(e=>{
        /* A refusal here is nearly always the published rules being older than this build. */
        console.warn('[audit] entry refused',act,e&&e.code);
      });
    }catch(e){console.warn('[audit] log failed',act,e)}
  }

  /* ------------------------------------------------------------------
   *  READING
   * ------------------------------------------------------------------ */

  /* One-shot read, newest first, capped. There is deliberately no listener: an audit log is
     something you open and read, and a permanent subscription to it on every client would be a
     standing cost for a page almost nobody has open. */
  async function read(sid,limit){
    const s=await get(query(R('auditLog/'+sid),orderByChild('at'),limitToLast(Number(limit)||200)));
    const v=s.val()||{};
    return Object.keys(v).map(k=>({id:k,...v[k]}))
      .filter(e=>e&&e.act&&Number(e.at)>0)
      .sort((a,b)=>b.at-a.at);
  }

  async function clear(sid){
    if(!DModel.isServerOwner(sid,ME.id)&&!isOwner(ME.id))
      throw new Error('Only the server owner can clear the audit log.');
    await remove(R('auditLog/'+sid));
    /* The clearing itself is logged, so an empty log is never ambiguous about why. */
    log(sid,'log.clear',{});
  }

  return{log,read,clear,label,icon,ACTS};
})();

/* ======================================================================
 *  THE AUDIT LOG SECTION
 * ====================================================================== */
registerServerSection({
  k:'audit',n:'Audit Log',cat:'Moderation',perm:'viewAudit',ich:false,
  draw(main,sid,srv,api){
    let q='',filter='',rows=null,err='';

    const nameOf=uid=>{const u=DB.getUser(Number(uid));return u?dispName(u,'User '+uid):'User '+uid};

    function describe(e){
      let t='';
      if(e.name)t=e.name;
      else if(e.target&&/^\d+$/.test(String(e.target)))t=nameOf(e.target);
      else if(e.target)t=String(e.target);
      return t;
    }

    function paint(){
      const known=[...new Set((rows||[]).map(r=>r.act))].sort();
      main.innerHTML=
        '<div class="dset-h1">Audit Log</div>'+
        '<div class="dnote">A record of what this server’s staff have changed. '+
          '<b>It is written by the browser that made the change</b>, so an entry can never be put '+
          'in somebody else’s name and never edited afterwards — but it is a record, not proof.'+
        '</div>'+
        '<div class="dal-tools">'+
          '<input class="dinput" id="alq" placeholder="Search by person, name or reason" value="'+esc(q)+'">'+
          '<select class="dinput" id="alf"><option value="">All actions</option>'+
            known.map(a=>'<option value="'+esc(a)+'"'+(filter===a?' selected':'')+'>'+esc(DAudit.label(a))+'</option>').join('')+
          '</select>'+
        '</div>'+
        '<div id="alBody"></div>'+
        ((DModel.isServerOwner(sid,ME.id)||isOwner(ME.id))
          ?'<div class="dset-sep"></div><button type="button" class="dbtn danger" id="alClear">Clear the audit log</button>'+
           '<div class="dnote">Permanent. The clearing is itself logged, so the log is never silently empty.</div>'
          :'');
      paintBody();
      const qi=main.querySelector('#alq');
      qi.oninput=()=>{q=qi.value;paintBody()};
      main.querySelector('#alf').onchange=e=>{filter=e.target.value;paintBody()};
      const cl=main.querySelector('#alClear');
      if(cl)cl.onclick=()=>dconfirm({
        title:'Clear the audit log?',sub:'Every entry is deleted and cannot be recovered.',
        confirm:'Clear it',danger:true,
        onConfirm:async()=>{await DAudit.clear(sid);rows=[];paintBody();toast('Audit log cleared.')}
      });
    }

    function paintBody(){
      const host=main.querySelector('#alBody');if(!host)return;
      if(err){host.innerHTML='<div class="dempty">'+err+'</div>';wireErr(host);return}
      if(rows===null){host.innerHTML='<div class="dempty">Reading the log…</div>';return}
      const t=q.trim().toLowerCase();
      const list=rows.filter(e=>{
        if(filter&&e.act!==filter)return false;
        if(!t)return true;
        return(nameOf(e.by)+' '+describe(e)+' '+(e.reason||'')+' '+DAudit.label(e.act)).toLowerCase().includes(t);
      }).slice(0,300);
      if(!list.length){host.innerHTML='<div class="dempty">'+(rows.length?'Nothing matches.':'Nothing has been logged yet.')+'</div>';return}
      host.innerHTML=list.map(e=>{
        const who=DB.getUser(Number(e.by));
        const what=describe(e);
        return '<div class="dal-row">'+
          '<span class="dal-ic">'+esc(DAudit.icon(e.act))+'</span>'+
          '<span class="dal-b">'+
            '<span class="dal-l"><b data-open-profile="'+Number(e.by)+'">'+esc(nameOf(e.by))+'</b> '+
              esc(DAudit.label(e.act).toLowerCase())+(what?' — <i>'+esc(what)+'</i>':'')+'</span>'+
            (e.reason?'<span class="dal-r">Reason: '+esc(e.reason)+'</span>':'')+
            (e.extra?'<span class="dal-r">'+esc(e.extra)+'</span>':'')+
            '<span class="dal-t">'+esc(new Date(Number(e.at)).toLocaleString())+'</span>'+
          '</span>'+
        '</div>';
      }).join('');
      host.querySelectorAll('[data-open-profile]').forEach(b=>b.onclick=()=>openUserProfile(Number(b.dataset.openProfile)));
    }

    /* A denied read is the one failure worth explaining, because there are exactly two causes
       and one of them the viewer can fix themselves. */
    function wireErr(host){
      const b=host.querySelector('#alResync');
      if(b)b.onclick=async()=>{
        b.disabled=true;b.textContent='Refreshing…';
        try{
          await DModel.syncPerms(sid,DModel.memberIds(sid));
          toast('Permissions refreshed. Reopening the log…');
          err='';rows=null;load();
        }catch(e){toast((e&&e.message)||'Could not refresh permissions.','bad');b.disabled=false;b.textContent='Refresh permissions'}
      };
    }

    async function load(){
      try{
        rows=await DAudit.read(sid,300);
        err='';
      }catch(e){
        rows=[];
        const denied=/permission|denied/i.test(String((e&&(e.code||e.message))||''));
        if(!denied)err='The log could not be read ('+esc(String((e&&(e.code||e.message))||'failed'))+').';
        else if(DModel.can(sid,'manageRoles',ME.id))
          err='Reading the log was refused. Either the published database rules are older than '+
              'this build, or this server’s stored permission cache predates the View Audit Log '+
              'permission. The second one you can fix right now:<div style="margin-top:10px">'+
              '<button type="button" class="dbtn" id="alResync">Refresh permissions</button></div>';
        else err='Reading the log was refused — you need the View Audit Log permission, and '+
                 'the server’s permissions may need refreshing by somebody who can manage roles.';
      }
      paint();
    }

    paint();load();
  }
});

/* ======================================================================
 *  THE HOOKS
 *
 *  Every mutating DModel function is wrapped so it logs AFTER it succeeds. DModel is a plain
 *  object, so its properties are writable - which is what makes this possible without touching
 *  model.js at all.
 *
 *  `before` runs with the original arguments while the old state is still readable, so an entry
 *  can name a channel or a role that the action is about to delete. `after` gets whatever the
 *  original returned.
 * ====================================================================== */
(function hookAudit(){
  if(typeof DModel==='undefined'){console.warn('[audit] DModel missing; hooks not installed');return}

  function wrap(name,act,build){
    const orig=DModel[name];
    if(typeof orig!=='function'){console.warn('[audit] cannot hook',name);return}
    DModel[name]=async function(){
      const args=[...arguments];
      let pre=null;
      try{pre=build.before?build.before(args):null}catch(e){console.warn('[audit] before',name,e)}
      const out=await orig.apply(DModel,args);
      try{
        const sid=build.sid?build.sid(args,out):args[0];
        const f=build.fields?build.fields(args,out,pre):{};
        if(f!==false)DAudit.log(sid,typeof act==='function'?act(args,out,pre):act,f||{});
      }catch(e){console.warn('[audit] after',name,e)}
      return out;
    };
  }

  const chName=(sid,cid)=>{try{const c=DModel.channel(sid,cid);return c?c.name:String(cid)}catch(_){return String(cid)}};
  const roleName=(sid,rid)=>{try{const r=DModel.role(sid,rid);return r?r.name:String(rid)}catch(_){return String(rid)}};
  const catName=(sid,cid)=>{try{const c=(DModel.cats(sid)||[]).find(x=>x.id===cid);return c?c.name:String(cid)}catch(_){return String(cid)}};

  /* ---- the server itself ---- */
  /* v54.7: a new server's log began empty, so there was no record of when it came into being
     or who made it - the one entry every other action is implicitly dated against. It is also
     the only act whose sid comes from the RESULT rather than the arguments, since the server
     does not exist until the call resolves. */
  wrap('createServer','srv.create',{sid:(a,out)=>out,fields:(a)=>({name:String(a[0]||'')})});
  wrap('updateServer','srv.update',{fields:(a)=>{
    const f=a[1]||{};
    const changed=Object.keys(f).filter(k=>f[k]!==undefined);
    return{extra:changed.length?('changed: '+changed.join(', ')):''};
  }});
  wrap('setPublic','srv.public',{fields:(a)=>({extra:a[1]?'listed on Discover':'removed from Discover'})});

  /* ---- channels and categories ---- */
  /* createChannel(sid,{name,type,cat,topic}) - the second argument is an options object, not a
     name. Getting that wrong logs "[object Object]", which is how you find out. */
  wrap('createChannel','ch.create',{fields:(a,out)=>({target:out,name:String((a[1]&&a[1].name)||''),
    extra:((a[1]&&a[1].type)||'text')+' channel'})});
  wrap('updateChannel','ch.update',{
    before:a=>chName(a[0],a[1]),
    fields:(a,out,pre)=>({target:a[1],name:pre,
      extra:Object.keys(a[2]||{}).filter(k=>(a[2]||{})[k]!==undefined).join(', ')})});
  wrap('deleteChannel','ch.delete',{before:a=>chName(a[0],a[1]),fields:(a,o,pre)=>({target:a[1],name:pre})});
  wrap('setChannelOverride','ch.perms',{
    before:a=>chName(a[0],a[1]),
    fields:(a,o,pre)=>({target:a[1],name:pre,extra:'for '+roleName(a[0],a[2])})});
  wrap('createCategory','cat.create',{fields:(a,out)=>({target:out,name:String(a[1]||'')})});
  wrap('updateCategory','cat.update',{before:a=>catName(a[0],a[1]),fields:(a,o,pre)=>({target:a[1],name:pre})});
  wrap('deleteCategory','cat.delete',{before:a=>catName(a[0],a[1]),fields:(a,o,pre)=>({target:a[1],name:pre})});

  /* ---- roles ---- */
  wrap('createRole','role.create',{fields:(a,out)=>({target:out,name:String(a[1]||'new role')})});
  wrap('updateRole','role.update',{
    before:a=>roleName(a[0],a[1]),
    fields:(a,o,pre)=>({target:a[1],name:pre,
      extra:Object.keys(a[2]||{}).filter(k=>(a[2]||{})[k]!==undefined).join(', ')})});
  wrap('deleteRole','role.delete',{before:a=>roleName(a[0],a[1]),fields:(a,o,pre)=>({target:a[1],name:pre})});
  wrap('reorderRoles','role.order',{fields:()=>({})});
  wrap('setMemberRole',(a)=>a[3]?'role.give':'role.take',{
    fields:a=>({target:a[1],name:roleName(a[0],a[2]),
      extra:(DB.getUser(Number(a[1]))?dispName(DB.getUser(Number(a[1]))):('User '+a[1]))})});

  /* ---- members ---- */
  wrap('setNick','mem.nick',{fields:a=>({target:a[1],name:String(a[2]||'(cleared)')})});
  wrap('kickMember','mem.kick',{fields:a=>({target:a[1],
    name:(DB.getUser(Number(a[1]))?dispName(DB.getUser(Number(a[1]))):('User '+a[1]))})});
  wrap('leaveServer','mem.leave',{fields:()=>({})});
  wrap('joinByInvite','mem.join',{sid:(a,out)=>out,fields:()=>({extra:'joined with an invite'})});
  wrap('joinPublic','mem.join',{fields:()=>({extra:'joined from Discover'})});

  /* ---- moderation ---- */
  /* banMember(sid,uid,reason) - reason is a plain string. */
  wrap('banMember','mem.ban',{fields:a=>({target:a[1],
    name:(DB.getUser(Number(a[1]))?dispName(DB.getUser(Number(a[1]))):('User '+a[1])),
    reason:String(a[2]||'')})});
  wrap('unbanMember','mem.unban',{fields:a=>({target:a[1],
    name:(DB.getUser(Number(a[1]))?dispName(DB.getUser(Number(a[1]))):('User '+a[1]))})});
  /* timeoutMember(sid,uid,minutes) - MINUTES, not milliseconds. */
  wrap('timeoutMember',(a)=>Number(a[2])>0?'mem.timeout':'mem.untimeout',{
    fields:a=>({target:a[1],
      name:(DB.getUser(Number(a[1]))?dispName(DB.getUser(Number(a[1]))):('User '+a[1])),
      extra:Number(a[2])>0?('for '+Number(a[2])+' min'):''})});
  wrap('ipBanHash','ip.ban',{fields:a=>({target:String(a[1]||'').slice(0,16)})});
  wrap('ipUnbanHash','ip.unban',{fields:a=>({target:String(a[1]||'').slice(0,16)})});

  /* ---- invites ---- */
  /* createInvite(sid,opts) where opts = {expiresMs, maxUses}. */
  wrap('createInvite','inv.create',{fields:(a,out)=>{
    const o=a[1]||{};
    return{target:out,extra:[
      o.expiresMs?('expires in '+Math.round(Number(o.expiresMs)/3600000)+'h'):'never expires',
      o.maxUses?(Number(o.maxUses)+' use'+(Number(o.maxUses)===1?'':'s')):'unlimited uses'
    ].join(', ')};
  }});
  /* revokeInvite(code,sid) - the SERVER IS THE SECOND ARGUMENT here, unlike every other call on
     DModel. Without this override the entry would be filed against a server id of "ABCD1234". */
  wrap('revokeInvite','inv.revoke',{sid:a=>a[1],fields:a=>({target:String(a[0]||'')})});
})();
