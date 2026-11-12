/* ==========================================================================
 * js/chat/polls.js  (v54)
 *
 * Polls, attached to a message.
 *
 * SHAPE
 *   polls/$key/$msg/q       {text, opts:{0..9}, multi, ends, at}   the question
 *   polls/$key/$msg/v/$uid  "0"  or  "0,2"                         a vote
 *
 *   Two children rather than one node, because they have different writers and the database
 *   rules say so: `q` is writable only by the author of the message it hangs off (read straight
 *   off messages/$key/$msg/senderId, so a poll can never be attached to somebody else's post),
 *   and `v/$uid` only by the voter. One combined node could not express that.
 *
 * WHY THE QUESTION IS ALSO THE MESSAGE TEXT
 *   The poll is an attachment to an ordinary message. A client that knows nothing about polls -
 *   an older build, the single-file launcher copy somebody has cached - still shows the question
 *   and the options as text instead of showing an empty message. Same approach the v53 system
 *   messages took with their plain-words fallback.
 *
 * WHERE IT LIVES IN THE UI
 *   Behind Settings -> Advanced -> Experimental features, because it is new. The + menu grows a
 *   "Create a poll" entry when that is on. Rendering is NOT gated: once a poll exists, everyone
 *   sees and can vote on it, whether or not they have the flag on. A feature that renders for
 *   some readers and not others would make a channel look broken.
 * ========================================================================== */
'use strict';

const DPolls=(function(){
  const S={byKey:{}};
  const watching={};
  const subs=new Set();
  function emit(){subs.forEach(f=>{try{f()}catch(_){}})}

  function watch(key){
    Object.keys(watching).forEach(k=>{if(k!==key)unwatch(k)});
    if(!key||watching[key])return;
    watching[key]=onValue(R('polls/'+key),s=>{S.byKey[key]=s.val()||{};emit()},
      e=>console.warn('[DPolls] denied',key,e&&e.code));
  }
  function unwatch(key){
    const u=watching[key];if(!u)return;
    try{u()}catch(_){}
    delete watching[key];delete S.byKey[key];
  }

  /* A poll, normalised. Anything malformed comes back as null rather than half-drawn. */
  function of(key,msg){
    const raw=(S.byKey[key]||{})[msg];
    const q=raw&&raw.q;
    if(!q||typeof q.text!=='string'||!q.opts)return null;
    const opts=[];
    for(let i=0;i<10;i++){
      const v=q.opts[i]!==undefined?q.opts[i]:q.opts[String(i)];
      if(typeof v==='string'&&v.length)opts.push(v);
    }
    if(opts.length<2)return null;
    const votes=(raw&&raw.v)||{};
    return{
      text:String(q.text).slice(0,200),
      opts,
      multi:q.multi===true,
      ends:Number(q.ends)||0,
      at:Number(q.at)||0,
      votes
    };
  }

  function closed(p){return !!(p&&p.ends>0&&p.ends<=Date.now())}

  /* Tallies, ignoring any vote that points at an option that no longer exists. */
  function tally(p){
    const counts=p.opts.map(()=>0);
    const voters=new Set();
    Object.keys(p.votes||{}).forEach(uid=>{
      const raw=String(p.votes[uid]||'');
      if(!/^[0-9](,[0-9])*$/.test(raw))return;
      const picks=[...new Set(raw.split(',').map(Number))].filter(i=>i<p.opts.length);
      if(!picks.length)return;
      voters.add(Number(uid));
      if(!p.multi)counts[picks[0]]++;
      else picks.forEach(i=>counts[i]++);
    });
    return{counts,total:voters.size,voters:[...voters]};
  }

  function myVote(p){
    if(!ME||!p)return [];
    const raw=String((p.votes||{})[ME.id]||'');
    if(!/^[0-9](,[0-9])*$/.test(raw))return [];
    return [...new Set(raw.split(',').map(Number))].filter(i=>i<p.opts.length);
  }

  function clean(s,max){
    return String(s||'').replace(/[\u0000-\u001f\u007f<>]/g,'').replace(/\s+/g,' ').trim().slice(0,max);
  }

  /* Creates the message and then the poll, in that order and not atomically, because the rules
     for `q` read the message's senderId - which does not exist until the message does. The same
     staged-writes rule the server model lives by; see section 4 of the design notes at the top of js/discord/model.js. */
  async function create(key,{question,options,multi,hours}){
    if(!ME)throw new Error('Not signed in.');
    /* Options are checked FIRST: "a poll needs two options" is the more useful complaint when
       both are wrong, and it is the one people actually hit. */
    const opts=(options||[]).map(o=>clean(o,80)).filter(Boolean).slice(0,10);
    if(opts.length<2)throw new Error('A poll needs at least two options.');
    if(new Set(opts.map(o=>o.toLowerCase())).size!==opts.length)throw new Error('Two options are the same.');
    const text=clean(question,200);
    if(text.length<2)throw new Error('Ask something.');
    const ends=Number(hours)>0?Date.now()+SKEW+Number(hours)*3600000:0;

    /* The plain-text fallback, which is what the message itself says. */
    const body='\u{1F4CA} **'+text+'**\n'+opts.map((o,i)=>(i+1)+'. '+o).join('\n');
    const msgId=await DB.sendMessage(key,{senderId:ME.id,text:body,images:[],files:[],pings:[]});
    if(!msgId)throw new Error('The message went out but its id came back empty, so the poll could not be attached.');

    const q={text,multi:!!multi,at:Date.now()+SKEW,opts:{}};
    opts.forEach((o,i)=>{q.opts[i]=o});
    if(ends)q.ends=ends;
    try{
      await set(R('polls/'+key+'/'+msgId+'/q'),q);
    }catch(e){
      /* The message is already out. Say exactly that rather than pretending nothing happened. */
      console.warn('[DPolls] q write refused',e&&e.code);
      throw new Error('The question was posted, but the votable poll could not be saved'+
        (/permission|denied/i.test(String((e&&(e.code||e.message))||''))
          ?' — the published database rules are older than this build.':' ('+((e&&e.code)||'failed')+').'));
    }
    return msgId;
  }

  async function vote(key,msg,picks){
    if(!ME)return;
    const p=of(key,msg);
    if(!p)throw new Error('That poll is gone.');
    if(closed(p))throw new Error('That poll has closed.');
    let list=[...new Set((picks||[]).map(Number))].filter(i=>i>=0&&i<p.opts.length).sort();
    if(!p.multi)list=list.slice(0,1);
    if(!list.length){await remove(R('polls/'+key+'/'+msg+'/v/'+ME.id));return}
    await set(R('polls/'+key+'/'+msg+'/v/'+ME.id),list.join(','));
  }

  async function close(key,msg){
    const m=(DB.messages(key)||[]).find(x=>x.id===msg);
    if(!m||m.senderId!==ME.id)throw new Error('Only whoever started the poll can close it.');
    await set(R('polls/'+key+'/'+msg+'/q/ends'),Date.now()+SKEW-1000);
  }

  return{watch,unwatch,of,closed,tally,myVote,create,vote,close,
         onChange:f=>{subs.add(f);return()=>subs.delete(f)}};
})();

/* ======================================================================
 *  RENDERING
 *  Appended under the bubble by decorating the row, rather than built into msgEl - so a poll
 *  that fails to draw costs a poll, not the message.
 * ====================================================================== */
function pollCardHTML(key,m,p){
  const t=DPolls.tally(p);
  const mine=DPolls.myVote(p);
  const over=DPolls.closed(p);
  const voted=mine.length>0;
  /* Discord hides the numbers until you have voted, so the first few votes do not steer the
     rest. Once you vote - or once it closes - everything is shown. */
  const reveal=voted||over;
  const mineIs=i=>mine.indexOf(i)>=0;

  const rows=p.opts.map((o,i)=>{
    const n=t.counts[i];
    const pct=t.total?Math.round(100*n/t.total):0;
    return '<button type="button" class="pl-opt'+(mineIs(i)?' on':'')+(over?' over':'')+'" '+
      'data-pl-opt="'+i+'"'+(over?' disabled':'')+' aria-pressed="'+(mineIs(i)?'true':'false')+'">'+
      '<span class="pl-box">'+(mineIs(i)?'✓':'')+'</span>'+
      '<span class="pl-txt">'+esc(o)+'</span>'+
      (reveal?'<span class="pl-pct">'+pct+'%</span>':'')+
      (reveal?'<span class="pl-fill" style="width:'+pct+'%"></span>':'')+
    '</button>';
  }).join('');

  const when=over?'Final results'
    :(p.ends>0?('Closes '+new Date(p.ends).toLocaleString()):'No closing time');
  const canClose=!over&&m.senderId===ME.id;

  return '<div class="pl-card'+(over?' closed':'')+'" data-pl-msg="'+esc(String(m.id))+'">'+
    '<div class="pl-q">'+esc(p.text)+'</div>'+
    '<div class="pl-sub">'+(p.multi?'Pick as many as you like':'Pick one')+
      ' · '+t.total+' vote'+(t.total===1?'':'s')+' · '+esc(when)+'</div>'+
    '<div class="pl-opts">'+rows+'</div>'+
    (!reveal?'<div class="pl-hint">Results show once you have voted.</div>':'')+
    (voted&&!over?'<button type="button" class="pl-clear" data-pl-clear>Remove my vote</button>':'')+
    (canClose?'<button type="button" class="pl-close" data-pl-close>Close the poll now</button>':'')+
  '</div>';
}

function attachPoll(el,m){
  const key=view.roomKey;if(!key||!m||m.sys)return;
  const p=DPolls.of(key,m.id);
  const old=el.querySelector('.pl-card');
  if(!p){if(old)old.remove();return}
  const bubble=el.querySelector('.bubble');
  if(!bubble)return;
  /* The message text is the fallback copy of the question - with the real poll drawn, repeating
     it above would show everything twice. */
  el.classList.add('has-poll');
  const host=document.createElement('div');
  host.innerHTML=pollCardHTML(key,m,p);
  const card=host.firstElementChild;
  if(old)old.replaceWith(card);else bubble.appendChild(card);

  card.querySelectorAll('[data-pl-opt]').forEach(b=>b.onclick=async ev=>{
    ev.stopPropagation();
    const i=Number(b.dataset.plOpt);
    const cur=DPolls.myVote(p);
    let next;
    if(p.multi)next=cur.indexOf(i)>=0?cur.filter(x=>x!==i):[...cur,i];
    else next=cur.length===1&&cur[0]===i?[]:[i];
    card.querySelectorAll('[data-pl-opt]').forEach(x=>x.disabled=true);
    try{await DPolls.vote(key,m.id,next)}
    catch(e){
      toast((e&&e.message)||'Could not vote.','bad');
      card.querySelectorAll('[data-pl-opt]').forEach(x=>x.disabled=false);
    }
  });
  const cl=card.querySelector('[data-pl-clear]');
  if(cl)cl.onclick=async ev=>{
    ev.stopPropagation();cl.disabled=true;
    try{await DPolls.vote(key,m.id,[])}catch(e){toast((e&&e.message)||'Could not remove it.','bad');cl.disabled=false}
  };
  const cls=card.querySelector('[data-pl-close]');
  if(cls)cls.onclick=ev=>{
    ev.stopPropagation();
    dconfirm({title:'Close this poll?',sub:'Nobody can vote after that, and the results become final.',
      confirm:'Close it',
      onConfirm:async()=>{await DPolls.close(key,m.id)}});
  };
}

/* Hooked into the row decoration chain alongside pins and the ignore collapse. */
const _msgEl_v54poll=msgEl;
msgEl=function(m){
  const el=_msgEl_v54poll(m);
  try{attachPoll(el,m)}catch(e){console.warn('[DPolls] attach failed',e)}
  return el;
};

/* Watch the open channel's polls, and repaint when a vote lands. */
const _selectRoom_v54poll=selectRoom;
selectRoom=function(k){
  try{DPolls.watch(k)}catch(_){}
  return _selectRoom_v54poll.apply(null,arguments);
};
(function wirePollRepaint(){
  let pend=false;
  DPolls.onChange(()=>{
    if(pend||!ME)return;
    pend=true;
    requestAnimationFrame(()=>{
      pend=false;
      if(!ME||view.page!=='chatPage')return;
      /* Only the poll cards need redrawing, not the whole list - a vote arriving should not make
         the conversation flash. */
      try{
        const box=$('#messages');if(!box)return;
        const list=DB.messages(view.roomKey)||[];
        box.querySelectorAll('.msg[data-msg-id]').forEach(el=>{
          const m=list.find(x=>x.id===el.dataset.msgId);
          if(m)attachPoll(el,m);
        });
      }catch(e){console.warn('[DPolls] repaint failed',e)}
    });
  });
})();

/* ======================================================================
 *  CREATING ONE
 * ====================================================================== */
function openPollComposer(){
  const key=view.roomKey;
  if(!key){toast('Open a channel first.');return}
  const row=(i,val)=>'<div class="pl-newrow"><span>'+(i+1)+'</span>'+
    '<input class="dinput" data-pl-in="'+i+'" maxlength="80" placeholder="Option '+(i+1)+'" value="'+esc(val||'')+'">'+
    (i>1?'<button type="button" class="pl-del" data-pl-del="'+i+'" aria-label="Remove option">✕</button>':'')+
  '</div>';

  const m=dmodal({
    title:'Create a poll',
    body:
      '<div class="dfield"><label class="dlabel">Question</label>'+
        '<input class="dinput" id="plQ" maxlength="200" placeholder="What are we doing?"></div>'+
      '<div class="dfield"><label class="dlabel">Options</label><div id="plOpts">'+row(0)+row(1)+'</div>'+
        '<button type="button" class="dbtn sm grey" id="plAdd" style="margin-top:6px">+ Add an option</button></div>'+
      '<div class="drow"><div class="drow-txt"><div class="drow-nm">Allow more than one answer</div></div>'+
        dtoggleHTML(false,'id="plMulti"')+'</div>'+
      '<div class="dfield"><label class="dlabel">Close after</label>'+
        '<select class="dinput" id="plHours">'+
          '<option value="0">Never</option><option value="1">1 hour</option>'+
          '<option value="8">8 hours</option><option value="24" selected>1 day</option>'+
          '<option value="72">3 days</option><option value="168">1 week</option>'+
        '</select></div>'+
      '<div class="dnote">The question and the options are posted as an ordinary message too, so '+
        'anybody on an older build still sees what was asked.</div>'+
      '<div class="derr" id="plErr"></div>',
    footer:'<button type="button" class="dbtn sec" data-x>Cancel</button>'+
           '<button type="button" class="dbtn" data-go>Post the poll</button>'
  });
  m.foot.querySelector('[data-x]').onclick=m.close;

  const host=m.body.querySelector('#plOpts');
  const wireDel=()=>{
    host.querySelectorAll('[data-pl-del]').forEach(b=>b.onclick=()=>{
      b.closest('.pl-newrow').remove();renumber();
    });
  };
  const renumber=()=>{
    [...host.querySelectorAll('.pl-newrow')].forEach((r,i)=>{
      r.querySelector('span').textContent=String(i+1);
      const inp=r.querySelector('input');
      inp.dataset.plIn=String(i);
      inp.placeholder='Option '+(i+1);
      const d=r.querySelector('[data-pl-del]');
      if(d)d.dataset.plDel=String(i);
    });
    const add=m.body.querySelector('#plAdd');
    if(add)add.disabled=host.querySelectorAll('.pl-newrow').length>=10;
  };
  wireDel();renumber();
  m.body.querySelector('#plAdd').onclick=()=>{
    const n=host.querySelectorAll('.pl-newrow').length;
    if(n>=10)return;
    const t=document.createElement('template');
    t.innerHTML=row(n);
    host.appendChild(t.content.firstElementChild);
    wireDel();renumber();
    const last=host.querySelector('.pl-newrow:last-child input');
    if(last)last.focus();
  };

  const go=m.foot.querySelector('[data-go]');
  go.onclick=async()=>{
    const err=m.body.querySelector('#plErr');err.textContent='';
    go.disabled=true;go.textContent='Posting…';
    try{
      await DPolls.create(key,{
        question:m.body.querySelector('#plQ').value,
        options:[...host.querySelectorAll('input[data-pl-in]')].map(i=>i.value),
        multi:m.body.querySelector('#plMulti').checked,
        hours:Number(m.body.querySelector('#plHours').value)||0
      });
      m.close();
    }catch(e){
      err.textContent=(e&&e.message)||'Could not post it.';
      go.disabled=false;go.textContent='Post the poll';
    }
  };
}

/* The + menu entry. Added when the menu opens rather than once at load, because the flag can be
   switched on in settings without reloading. */
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('#attachBtn');
  if(!b)return;
  setTimeout(()=>{
    const menu=document.getElementById('plusMenu');
    if(!menu||menu.classList.contains('hidden'))return;
    const existing=menu.querySelector('#plusPoll');
    let on=false;try{on=!!Prefs.get('expFeatures')}catch(_){}
    if(!on){if(existing)existing.remove();return}
    if(existing)return;
    const item=document.createElement('button');
    item.type='button';item.className='dl-plus-item';item.id='plusPoll';
    item.setAttribute('role','menuitem');
    item.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" '+
      'stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V10m7 10V4m7 16v-7"/></svg>'+
      '<span>Create a Poll</span>';
    item.onclick=()=>{
      try{closePlusMenu()}catch(_){}
      openPollComposer();
    };
    menu.appendChild(item);
  },20);
},true);
