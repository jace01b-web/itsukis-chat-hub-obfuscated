/* ==========================================================================
 * js/discord/emoji.js  (v54)
 *
 * Custom server emoji: upload one, it gets a `:name:`, and anybody who can read the message
 * sees the picture.
 *
 * WHERE THEY LIVE
 *   serverEmoji/$sid/$eid = {name, img, by, at}
 *   Readable by anyone signed in - which it has to be, because an emoji posted in a channel has
 *   to render for whoever is reading it, including someone who is not in that server any more.
 *   Writable only with Manage Expressions in that server. Images are validated by the rules
 *   exactly like server icons and avatars are.
 *
 * HOW THEY GET INTO A MESSAGE, SAFELY
 *   Not by string-replacing on the message text, and not by string-replacing on the finished
 *   HTML either. Both are how you turn an emoji feature into an injection hole: the first lets
 *   the markdown passes mangle a tag this file produced, the second can match inside an
 *   attribute of a tag somebody else's text produced.
 *
 *   Instead the finished, already-escaped HTML from mdRender is parsed and only its TEXT NODES
 *   are rewritten, by building real elements. A `:name:` inside an href, inside a code block, or
 *   inside anything else that is not text is therefore never touched, and nothing this file adds
 *   can carry attacker-controlled attributes - the src comes from the validated database value
 *   and nowhere else.
 * ========================================================================== */
'use strict';

const SEmoji=(function(){
  const S={byServer:{}};
  const perServer={};
  const subs=new Set();

  function emit(){subs.forEach(f=>{try{f()}catch(e){console.warn('[SEmoji] subscriber failed',e)}})}

  /* Watched only for the servers you can actually see, like DBoost does, so opening the app does
     not subscribe to the emoji of every server you have ever joined. */
  function attach(sid){
    if(!sid||sid===DModel.ICH_ID||perServer[sid])return;
    perServer[sid]=onValue(R('serverEmoji/'+sid),s=>{
      S.byServer[sid]=s.val()||{};emit();
    },e=>console.warn('[SEmoji] denied',sid,e&&e.code));
  }
  function detach(sid){
    const u=perServer[sid];if(!u)return;
    try{u()}catch(_){}
    delete perServer[sid];delete S.byServer[sid];
  }
  function stop(){Object.keys(perServer).forEach(detach)}

  function isSafeImg(s){
    return typeof s==='string'&&s.length>30&&s.length<=120000&&
      /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s);
  }

  function of(sid){
    const raw=S.byServer[sid]||{};
    return Object.keys(raw).map(id=>({id,...raw[id]}))
      .filter(e=>e&&/^[a-zA-Z0-9_]{2,32}$/.test(String(e.name||''))&&isSafeImg(e.img))
      .sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  }

  /* Every emoji from every server currently being watched, indexed by name. A name collision
     between two servers resolves to the server you are looking at, which is what you would
     expect when you type it. */
  function lookup(name){
    name=String(name||'').toLowerCase();
    const here=(typeof view!=='undefined'&&view.sid)||null;
    const order=here?[here,...Object.keys(S.byServer).filter(s=>s!==here)]:Object.keys(S.byServer);
    for(const sid of order){
      const hit=of(sid).find(e=>String(e.name).toLowerCase()===name);
      if(hit)return hit;
    }
    return null;
  }

  function count(sid){return of(sid).length}
  const MAX_PER_SERVER=50;

  async function add(sid,name,file){
    if(sid===DModel.ICH_ID)throw new Error('Itsukis Chat Hub is defined in code, so it has no custom emoji.');
    if(!DModel.can(sid,'manageEmoji',ME.id))throw new Error('You need Manage Expressions in this server.');
    name=String(name||'').trim().replace(/[^a-zA-Z0-9_]/g,'_');
    if(!/^[a-zA-Z0-9_]{2,32}$/.test(name))throw new Error('A name needs 2-32 characters: letters, numbers and underscores.');
    if(of(sid).some(e=>String(e.name).toLowerCase()===name.toLowerCase()))
      throw new Error('This server already has an emoji called :'+name+':');
    if(count(sid)>=MAX_PER_SERVER)throw new Error('This server is at its limit of '+MAX_PER_SERVER+' emoji.');
    const img=await fromFile(file);
    const eid=push(R('serverEmoji/'+sid)).key;
    await set(R('serverEmoji/'+sid+'/'+eid),{name,img,by:Number(ME.id),at:Date.now()+SKEW});
    return eid;
  }

  async function del(sid,eid){
    if(!DModel.can(sid,'manageEmoji',ME.id))throw new Error('You need Manage Expressions in this server.');
    await remove(R('serverEmoji/'+sid+'/'+eid));
  }

  /* Squares and shrinks the upload to 64x64, which is the size it is ever drawn at, and keeps an
     animated GIF animated by passing it straight through rather than re-encoding it (a canvas
     only ever gives back the first frame). The size cap is checked after, because a GIF that is
     not re-encoded can still be too big. */
  function fromFile(file){
    return new Promise((resolve,reject)=>{
      if(!file)return reject(new Error('Pick an image first.'));
      if(!/^image\//.test(file.type||''))return reject(new Error('That is not an image.'));
      if(file.size>2*1024*1024)return reject(new Error('Keep it under 2 MB.'));
      const fr=new FileReader();
      fr.onerror=()=>reject(new Error('Could not read that file.'));
      fr.onload=()=>{
        const data=String(fr.result||'');
        if(/^data:image\/gif/.test(data)){
          if(data.length>120000)return reject(new Error('That GIF is too big — try one under about 80 KB.'));
          return resolve(data);
        }
        const img=new Image();
        img.onerror=()=>reject(new Error('That image could not be opened.'));
        img.onload=()=>{
          try{
            const N=64;
            const c=document.createElement('canvas');c.width=N;c.height=N;
            const x=c.getContext('2d');
            /* Square crop from the centre, so a wide picture is not squashed. */
            const side=Math.min(img.width,img.height);
            x.drawImage(img,(img.width-side)/2,(img.height-side)/2,side,side,0,0,N,N);
            let out=c.toDataURL('image/png');
            if(out.length>120000)out=c.toDataURL('image/webp',.9);
            if(out.length>120000)out=c.toDataURL('image/jpeg',.85);
            if(out.length>120000)return reject(new Error('That image would not compress small enough.'));
            resolve(out);
          }catch(e){reject(new Error('That image could not be processed.'))}
        };
        img.src=data;
      };
      fr.readAsDataURL(file);
    });
  }

  return{attach,detach,stop,of,lookup,count,add,del,fromFile,isSafeImg,MAX_PER_SERVER,
         onChange:f=>{subs.add(f);return()=>subs.delete(f)}};
})();

/* ======================================================================
 *  RENDERING  :name:  ->  <img>
 *  Text nodes only. See the note at the top of this file for why that is the only safe way.
 * ====================================================================== */
const EMOJI_RE=/:([a-zA-Z0-9_]{2,32}):/g;

function emojiizeNode(root){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
    acceptNode(n){
      /* Never inside code: `:shrug:` in a code block is text the author meant literally. */
      let p=n.parentNode;
      while(p&&p!==root){
        const t=p.nodeName;
        if(t==='CODE'||t==='PRE'||t==='A'||t==='IMG')return NodeFilter.FILTER_REJECT;
        p=p.parentNode;
      }
      return EMOJI_RE.test(n.nodeValue||'')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
    }
  });
  const hits=[];
  let n;while((n=walker.nextNode()))hits.push(n);
  hits.forEach(node=>{
    const text=node.nodeValue;
    EMOJI_RE.lastIndex=0;
    let m,last=0;
    const frag=document.createDocumentFragment();
    let changed=false;
    while((m=EMOJI_RE.exec(text))){
      const rec=SEmoji.lookup(m[1]);
      if(!rec)continue;
      changed=true;
      if(m.index>last)frag.appendChild(document.createTextNode(text.slice(last,m.index)));
      const img=document.createElement('img');
      img.className='cemoji';
      img.src=rec.img;                 /* validated by SEmoji.of() before it ever gets here */
      img.alt=':'+rec.name+':';
      img.title=':'+rec.name+':';
      img.setAttribute('draggable','false');
      frag.appendChild(img);
      last=m.index+m[0].length;
    }
    if(!changed)return;
    if(last<text.length)frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag,node);
  });
}

/* Takes finished HTML, returns finished HTML with the custom emoji swapped in. */
function emojiizeHTML(html){
  const s=String(html==null?'':html);
  if(!/:[a-zA-Z0-9_]{2,32}:/.test(s))return s;        /* nothing to do: the common case */
  try{
    const t=document.createElement('template');
    t.innerHTML=s;
    emojiizeNode(t.content);
    return t.innerHTML;
  }catch(e){console.warn('[SEmoji] render failed',e);return s}
}

/* mdRender is what every message, bio and embed goes through. Wrapping it is what makes custom
   emoji appear everywhere at once rather than in whichever places remembered to ask. */
const _mdRender_v53=mdRender;
mdRender=function(text){
  let html;
  try{html=_mdRender_v53(text)}
  catch(e){console.error('[markdown] failed',e);return esc(String(text==null?'':text))}
  return emojiizeHTML(html);
};

/* ======================================================================
 *  THE PICKER
 *  A row of this server's emoji above the standard grid. Injected rather than built into
 *  js/chat/emoji-picker.js so that file stays as it is - and placed OUTSIDE #emojiGrid, because
 *  the grid is rebuilt from scratch on every keystroke in the search box.
 * ====================================================================== */
const _openEmojiPicker_v53=openEmojiPicker;
openEmojiPicker=function(anchorEl,onPick){
  _openEmojiPicker_v53(anchorEl,onPick);
  try{
    /* Reactions are stored as the emoji string itself and validated by the database rules, so a
       `:name:` would be stored as literal text and show as literal text. Custom emoji are
       therefore offered for the composer only, which is honest about what works. */
    if(anchorEl&&anchorEl.hasAttribute&&anchorEl.hasAttribute('data-react-btn'))return;
    const pop=document.querySelector('.emoji-pop');if(!pop)return;
    const quick=pop.querySelector('#emojiQuick');if(!quick)return;
    const sid=(typeof view!=='undefined'&&view.sid)||null;
    if(!sid||sid===DModel.ICH_ID)return;
    const list=SEmoji.of(sid);
    if(!list.length)return;
    const wrap=document.createElement('div');
    wrap.className='emoji-pop-custom';
    wrap.innerHTML='<div class="epc-h">'+esc((DModel.server(sid)||{}).name||'This server')+'</div><div class="epc-row"></div>';
    const row=wrap.querySelector('.epc-row');
    list.forEach(e=>{
      const b=document.createElement('button');
      b.type='button';b.title=':'+e.name+':';
      const img=document.createElement('img');img.src=e.img;img.alt=':'+e.name+':';
      b.appendChild(img);
      b.onclick=()=>{onPick(':'+e.name+':');const c=pop.parentNode;if(c)c.remove()};
      row.appendChild(b);
    });
    quick.insertAdjacentElement('afterend',wrap);
  }catch(e){console.warn('[SEmoji] picker row failed',e)}
};

/* ======================================================================
 *  THE SERVER SETTINGS SECTION
 * ====================================================================== */
registerServerSection({
  k:'emoji',n:'Emoji',cat:'Server',perm:'manageEmoji',ich:false,
  draw(main,sid,srv,api){
    function paint(){
      const list=SEmoji.of(sid);
      const can=DModel.can(sid,'manageEmoji',ME.id);
      main.innerHTML=
        '<div class="dset-h1">Emoji — '+list.length+' of '+SEmoji.MAX_PER_SERVER+'</div>'+
        '<div class="dnote">Type <b>:name:</b> in a message and it becomes the picture. '+
          'Anyone who can read the message sees it, whether or not they are in this server.</div>'+
        (can?'<div class="dem-add">'+
          '<input type="file" id="emFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>'+
          '<button type="button" class="dbtn" id="emPick">Upload an emoji</button>'+
          '<span class="dnote" style="margin:0">Square works best. Animated GIFs stay animated. Under 2 MB.</span>'+
          '</div><div class="derr" id="emErr"></div>':'')+
        (list.length
          ?'<div class="dem-grid">'+list.map(e=>
              '<div class="dem-item"><img src="'+esc(e.img)+'" alt=":'+esc(e.name)+':">'+
              '<span class="dem-n">:'+esc(e.name)+':</span>'+
              '<span class="dem-by">'+esc(e.by?(((DB.getUser(Number(e.by))||{}).username)||('User '+e.by)):'')+'</span>'+
              (can?'<button type="button" class="dbtn sm danger" data-emdel="'+esc(e.id)+'">Remove</button>':'')+
              '</div>').join('')+'</div>'
          :'<div class="dempty">No custom emoji yet.</div>');

      const pick=main.querySelector('#emPick'),file=main.querySelector('#emFile');
      const err=main.querySelector('#emErr');
      if(pick&&file){
        pick.onclick=()=>file.click();
        file.onchange=()=>{
          const f=file.files&&file.files[0];
          file.value='';
          if(!f)return;
          const suggested=String(f.name||'emoji').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_]/g,'_').slice(0,32)||'emoji';
          const m=dmodal({
            title:'Name this emoji',
            body:'<div class="dfield"><label class="dlabel">Name</label>'+
                 '<input class="dinput" id="emName" maxlength="32" value="'+esc(suggested)+'" spellcheck="false"></div>'+
                 '<div class="dnote">Letters, numbers and underscores. It will be typed as <b>:name:</b></div>'+
                 '<div class="derr" id="emNErr"></div>',
            footer:'<button type="button" class="dbtn sec" data-x>Cancel</button><button type="button" class="dbtn" data-go>Add</button>'
          });
          m.foot.querySelector('[data-x]').onclick=m.close;
          const go=m.foot.querySelector('[data-go]');
          go.onclick=async()=>{
            const e2=m.body.querySelector('#emNErr');e2.textContent='';
            go.disabled=true;go.textContent='Adding…';
            try{
              const name=m.body.querySelector('#emName').value;
              await SEmoji.add(sid,name,f);
              DAudit.log(sid,'emoji.create',{name:String(name)});
              m.close();toast('Emoji added.');paint();
            }catch(ex){
              e2.textContent=(ex&&ex.message)||'Could not add it.';
              go.disabled=false;go.textContent='Add';
            }
          };
        };
      }
      main.querySelectorAll('[data-emdel]').forEach(b=>b.onclick=async()=>{
        const eid=b.dataset.emdel;
        const rec=SEmoji.of(sid).find(x=>x.id===eid);
        b.disabled=true;
        try{
          await SEmoji.del(sid,eid);
          DAudit.log(sid,'emoji.delete',{name:rec?rec.name:eid});
          paint();
        }catch(e){if(err)err.textContent=(e&&e.message)||'Could not remove it.';b.disabled=false}
      });
    }
    SEmoji.attach(sid);
    paint();
    /* Redraw when the list changes under us - another admin adding one while this is open. */
    const off=SEmoji.onChange(()=>{if(document.body.contains(main))paint();else off()});
  }
});
