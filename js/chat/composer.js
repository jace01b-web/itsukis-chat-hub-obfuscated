/* ==========================================================================
 * js/chat/composer.js
 * Composer: @mentions, sending, reply / edit
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

/* Composer */
const msgIn=$('#msgIn');
msgIn.addEventListener('input',()=>{
  msgIn.style.height='auto';msgIn.style.height=Math.min(msgIn.scrollHeight,140)+'px';
  $('#cc').textContent=msgIn.value.length;
  updateMentionPop();
});
msgIn.addEventListener('keydown',e=>{
  const pop=$('#mentionPop');
  if(!pop.classList.contains('hidden')){
    const items=[...pop.children];
    if(e.key==='ArrowDown'){e.preventDefault();view.mentionSel=(view.mentionSel+1)%items.length;hilite();return}
    if(e.key==='ArrowUp'){e.preventDefault();view.mentionSel=(view.mentionSel-1+items.length)%items.length;hilite();return}
    if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();items[view.mentionSel].click();return}
    if(e.key==='Escape'){pop.classList.add('hidden');return}
  }
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}
  if(e.key==='Escape'){
    e.stopPropagation();
    if(view.editingId||view.replyingTo)cancelCompose();   // 1st Escape: cancel edit / reply
    else msgIn.blur();                                    // otherwise: stop typing
  }
});
function hilite(){[...$('#mentionPop').children].forEach((c,i)=>c.classList.toggle('sel',i===view.mentionSel))}
function mentionCandidates(){
  const key=view.roomKey;let ids=[];
  if(key===CFG.GLOBAL_ROOM||key===CFG.ANNOUNCEMENTS_ROOM||key===CFG.SHITPOST_ROOM)ids=DB.allUsers().map(u=>u.id);
  else if(key?.startsWith('dm_'))ids=key.split('_').slice(1).map(Number);
  else{
    // A server channel: you can only @ the people who are actually in that server.
    try{
      const ch=DModel.channelByKey(key);
      ids=ch?DModel.memberIds(ch.sid):[];
    }catch(_){ids=[]}
    if(!ids.length)ids=DB.allUsers().map(u=>u.id);
  }
  return ids.map(i=>DB.getUser(i)).filter(Boolean);
}
// :emoji_name autocomplete (type ":" + 2 letters -> first 10 matches) and instant ":name:" -> emoji.
function updateEmojiPop(pop,pos,before){
  // finished shortcode, e.g. ":v:" or ":sob:" -> swap in the emoji right away
  const done=before.match(/(^|\s):([a-z0-9_+-]{1,40}):$/i);
  if(done&&EMOJI_BY_NAME[done[2].toLowerCase()]){
    const e=EMOJI_BY_NAME[done[2].toLowerCase()],start=pos-done[0].length+done[1].length;
    msgIn.value=msgIn.value.slice(0,start)+e+msgIn.value.slice(pos);
    const np=start+e.length;msgIn.setSelectionRange(np,np);
    $('#cc').textContent=msgIn.value.length;
    pop.classList.add('hidden');return true;
  }
  const m=before.match(/(^|\s):([a-z0-9_+-]{2,40})$/i);   // ":" must start a word so links like https:// never trigger
  if(!m)return false;
  const res=searchEmoji(m[2],10);
  if(!res.length){pop.classList.add('hidden');return true}
  view.mentionSel=0;pop.innerHTML='';
  res.forEach((r,i)=>{
    const d=document.createElement('div');d.className=i===0?'sel':'';
    d.innerHTML=`<span style="font-size:18px;display:inline-block;width:26px;text-align:center">${esc(r.emoji)}</span> :${esc(r.name)}:`;
    d.onclick=()=>{
      const start=pos-m[2].length-1;
      msgIn.value=msgIn.value.slice(0,start)+r.emoji+' '+msgIn.value.slice(pos);
      msgIn.focus();pop.classList.add('hidden');
      const np=start+r.emoji.length+1;msgIn.setSelectionRange(np,np);
      $('#cc').textContent=msgIn.value.length;
    };
    pop.appendChild(d);
  });
  pop.classList.remove('hidden');
  return true;
}
function updateMentionPop(){
  const pop=$('#mentionPop');
  const pos=msgIn.selectionStart;
  const before=msgIn.value.slice(0,pos);
  if(updateEmojiPop(pop,pos,before))return;
  const m=before.match(/@([0-9a-zA-Z._-]*)$/);
  if(!m){pop.classList.add('hidden');return}
  const q=m[1].toLowerCase();
  let opts=mentionCandidates().filter(u=>u.username.toLowerCase().startsWith(q)).slice(0,6)
    .map(u=>({label:u.username,ic:'👤'}));
  if(view.roomKey!==null&&!view.roomKey.startsWith('dm_')&&'everyone'.startsWith(q))opts.unshift({label:'everyone',ic:'📣'});
  if(!opts.length){pop.classList.add('hidden');return}
  view.mentionSel=0;pop.innerHTML='';
  opts.forEach((o,i)=>{
    const d=document.createElement('div');d.className=i===0?'sel':'';
    d.innerHTML=`${o.ic} ${esc(o.label)}`;
    d.onclick=()=>{
      const start=pos-m[0].length;
      msgIn.value=msgIn.value.slice(0,start)+'@'+o.label+' '+msgIn.value.slice(pos);
      msgIn.focus();pop.classList.add('hidden');
      const np=start+o.label.length+2;msgIn.setSelectionRange(np,np);
    };
    pop.appendChild(d);
  });
  pop.classList.remove('hidden');
}
$('#sendBtn').onclick=send;

function extractPings(text){
  const out=new Set();
  if(/@everyone\b|@here\b/.test(text)&&view.roomKey!==null)out.add('everyone');
  const re=/@([0-9a-zA-Z._-]{1,20})/g;let m;
  while((m=re.exec(text))){
    const id=DB.get().usernameIndex[m[1].toLowerCase()];
    if(id!==undefined)out.add(id);
  }
  return[...out].slice(0,99);
}
let _lastSendAt=0;
let _sendScanning=false;
/* The other person in a DM key, or null if this is not a DM. "dm_<a>_<b>" with the two ids
   sorted, so which half is mine is not fixed - both are checked. */
function dmPartnerOf(key){
  const m=/^dm_(\d+)_(\d+)$/.exec(String(key||''));
  if(!m||!ME)return null;
  const a=Number(m[1]),b=Number(m[2]);
  if(a===ME.id)return b;
  if(b===ME.id)return a;
  return null;
}

async function send(){
  const msgLimit=view.roomKey===CFG.ANNOUNCEMENTS_ROOM?Infinity:maxMsgFor(ME.id);
  const text=expandShortcodes(msgIn.value.trim()).slice(0,msgLimit);
  if(!view.roomKey)return;
  if(DB.isBanned(ME.id)){toast('Your account has been banned.','bad');return}
  {const br=(typeof chatBlockReason==='function')?chatBlockReason():null;if(br){toast(br,'bad');if(TOS_GATE.accepted===false&&typeof modalTos==='function'&&!$('#modalRoot').innerHTML.trim())modalTos({});return}}
  if(view.roomKey===CFG.ANNOUNCEMENTS_ROOM&&!isOwner(ME.id)){toast('Only the owner can post announcements.','bad');return}
  if(view.roomKey===CFG.SHITPOST_ROOM&&!isStaff(ME.id)){toast('Only mods, admins and owners can post in #shitpost.','bad');return}

  if(view.editingId){
    if(!text){toast('Message can\'t be empty.','bad');return}
    const id=view.editingId,key=view.roomKey;
    DB.editMessage(key,id,text).catch(e=>toast(e.message,'bad'));
    cancelCompose();
    renderMessages(view.roomKey);
    return;
  }

  const _pf=view.pendingFiles||[];
  if(!text&&!view.pending.length&&!_pf.length)return;
  {const pr=FILES.sendProblem(_pf);if(pr){toast(pr,'bad');return}}
  if(_pf.length&&NSFW.on()){
    if(_sendScanning)return;
    _sendScanning=true;
    toast('Checking file'+(_pf.length===1?'':'s')+'…');
    let bad=false;
    try{bad=await FILES.anyFlagged(_pf)}finally{_sendScanning=false}
    if(bad){
      clearPendingFiles();view.pending=[];renderPreviews();
      DB.selfMuteNsfw().catch(()=>{});
      toast('File blocked: NSFW content isn\'t allowed. You are muted for 1 hour.','bad');
      return;
    }
  }
  if(view.pending.length&&NSFW.on()){
    if(_sendScanning)return;
    _sendScanning=true;
    toast('Checking image'+(view.pending.length===1?'':'s')+'…');
    let bad=false;
    try{bad=await NSFW.anyFlagged(view.pending)}finally{_sendScanning=false}
    if(bad){
      view.pending=[];renderPreviews();
      DB.selfMuteNsfw().catch(()=>{});
      toast('Image blocked: NSFW content isn\'t allowed. You are muted for 1 hour.','bad');
      return;
    }
  }
  /* v54.5: messaging somebody who is not a friend.
     My own dmMembers row is what the rules check before letting me send, so it has to exist
     before the message goes out - and the request on their side is raised from the same
     call. Both are idempotent, so a conversation already under way just falls through.
     This is awaited rather than fired off: sending first would be refused by the rules,
     and the person would see their message bounce for no visible reason. */
  const _dmOther=dmPartnerOf(view.roomKey);
  if(_dmOther!=null&&!DB.dmOpenWith(_dmOther)){
    try{await DB.openDmRequest(_dmOther,text)}
    catch(e){toast((e&&e.message)||'Could not start that conversation.','bad');return}
  }

  _lastSendAt=Date.now();
  const replyTo=view.replyingTo?{id:view.replyingTo.id,senderId:view.replyingTo.senderId,preview:replyPreviewText(view.replyingTo)}:null;
  const _draftImgs=view.pending.slice();
  const _draftFiles=FILES.payload(_pf);
  DB.sendMessage(view.roomKey,{senderId:ME.id,text,images:_draftImgs,files:_draftFiles,pings:extractPings(text),replyTo})
    .catch(e=>{
      toast(e.message,'bad');
      FILES.deleteUrls(_draftFiles);   // the message never went out - don't leave the uploads orphaned
      // Refused for ANY reason (cooldown, mute, ban, rules): don't make the message vanish — restore the
      // draft so it isn't silently lost, as long as they haven't already started typing something else.
      if(text&&msgIn&&!msgIn.value){msgIn.value=text;$('#cc').textContent=text.length}
    });
  cancelCompose();
  msgIn.value='';msgIn.style.height='auto';$('#cc').textContent=0;
  view.pending=[];view.pendingFiles=[];renderPreviews();$('#mentionPop').classList.add('hidden');
  renderMessages(view.roomKey);
  $('#messages').scrollTop=$('#messages').scrollHeight;
}

/* ---------- Reply / Edit ---------- */
function replyPreviewText(m){
  if(m.text)return m.text;
  if(m.images&&m.images.length)return '📷 '+m.images.length+' image'+(m.images.length===1?'':'s');
  if(m.files&&m.files.length)return filesLabel(m.files);
  return '';
}
function startReply(m){
  view.editingId=null;
  view.replyingTo={id:m.id,senderId:m.senderId};
  renderComposeContext();
  msgIn.focus();
}
function startEdit(m){
  view.replyingTo=null;
  view.editingId=m.id;
  msgIn.value=m.text||'';
  msgIn.style.height='auto';msgIn.style.height=Math.min(msgIn.scrollHeight,140)+'px';
  $('#cc').textContent=msgIn.value.length;
  renderComposeContext();
  msgIn.focus();
  const np=msgIn.value.length;msgIn.setSelectionRange(np,np);
}
function cancelCompose(){
  const wasEditing=!!view.editingId;
  view.replyingTo=null;view.editingId=null;
  renderComposeContext();
  if(wasEditing){msgIn.value='';msgIn.style.height='auto';$('#cc').textContent=0}
}
function renderComposeContext(){
  const box=$('#composeContext');
  if(view.editingId){
    box.classList.add('active');
    $('#ccLabel').textContent='Editing message';
    $('#ccText').textContent='';
  }else if(view.replyingTo){
    const s=DB.getUser(view.replyingTo.senderId);
    const name=(s&&!s.deleted)?dispName(s):'Deleted User';
    box.classList.add('active');
    $('#ccLabel').textContent='Replying to '+name;
    const arr=DB.messages(view.roomKey);
    const src=arr.find(x=>x.id===view.replyingTo.id);
    // Same plain, spoiler-safe preview the reply quote uses - see mdPlain() in js/discord/markdown.js.
    const pv=src?replyPreviewText(src):'';
    $('#ccText').textContent=(typeof mdPlain==='function')?mdPlain(pv):pv;
  }else{
    box.classList.remove('active');
  }
}
