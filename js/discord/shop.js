/* ==========================================================================
 * js/discord/shop.js
 * The shop: VIP ("Nitro Basic") at $10 and MVP at $30 permanent.
 *
 * HOW BUYING WORKS, and why it is built this way:
 * there is no payment processor wired into this site, and a browser cannot be trusted to decide
 * that someone paid - your database rules are right to forbid it (vip/ and mvp/ are writable only
 * by owners). So the shop does two honest things instead of faking a checkout:
 *
 *   - for everyone: it shows the tiers and perks, and explains how to pay, quoting the buyer's
 *     user ID so an owner can match the payment to the account.
 *   - for owners:  a Grant panel that actually writes vip/$id = {perm:true} or mvp/$id = <when>,
 *     which is exactly what the rules allow an owner to do.
 *
 * If you later add a real payment provider, the only thing that should change is that your SERVER
 * (not this file) performs those same two writes after a verified webhook.
 * ========================================================================== */
'use strict';

const SHOP_TIERS=[
  {
    id:'vip',
    name:'VIP',
    tagline:'Nitro Basic',
    price:'$10',
    per:'one-off',
    color:'#b57cff',
    perks:[
      'The <b>VIP</b> tag and purple name across the whole site',
      'Access to the <b>#vip-lounge</b> channel',
      'Animated and custom avatars',
      'A custom profile description',
      'Priority in the member list',
      'Supports the site so it stays free for everyone'
    ]
  },
  {
    id:'mvp',
    name:'MVP',
    tagline:'Permanent, never expires',
    price:'$30',
    per:'permanent',
    color:'#ffd93d',
    featured:true,
    perks:[
      'Everything in VIP, plus <b>permanent VIP included free</b>',
      'The gold <b>MVP</b> tag, ranked above staff in member lists',
      'Access to the <b>#mvp-lounge</b> channel',
      'Messages up to <b>'+(2*2000)+' characters</b> (double everyone else)',
      'Profile descriptions up to 300 characters',
      'A custom image banner on your profile',
      '<b>3 Daily Spins</b> every day instead of one',
      'Never expires — one payment, kept forever'
    ]
  }
];

function shopStatus(id){
  if(!ME)return{};
  try{
    if(id==='mvp')return{owned:isMvp(ME.id)};
    const v=DB.vipInfo(ME.id,false,true);
    if(isMvp(ME.id))return{owned:true,via:'MVP'};
    if(v&&v.kind==='perm')return{owned:true};
    if(v&&v.kind==='day')return{owned:false,temp:true};
  }catch(_){}
  return{owned:false};
}

function openShop(){
  closeServerSettings();
  const el=document.createElement('div');
  el.className='dset';
  el.innerHTML=
    '<div class="dset-nav"><div class="dset-nav-inner" id="shNav"></div></div>'+
    '<div class="dset-main"><div class="dset-main-inner" id="shMain"></div></div>'+
    '<div class="dset-close-col"><button type="button" class="dset-close" id="shX" aria-label="Close">'+DI.x+
      '</button><div class="dset-close-lbl">ESC</div></div>'+
    '<button type="button" class="dset-x-mobile" id="shXm" aria-label="Close">'+DI.x+'</button>'+
    /* v54.6, phone only (CSS hides it elsewhere): back to the section list. Without the paned
       behaviour below, every section of the Shop was display:none on a phone. */
    '<button type="button" class="dset-back-mobile" id="shBack" aria-label="Back to the shop menu">'+
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>'+
      '<span>Shop</span></button>';
  document.body.appendChild(el);
  const close=()=>{el.remove();document.removeEventListener('keydown',onKey)};
  const narrow=()=>!!(window.matchMedia&&window.matchMedia('(max-width:820px)').matches);
  function onKey(e){
    if(e.key!=='Escape')return;
    // on a phone, Escape backs out of a section to the list before it closes the whole panel
    if(narrow()&&el.classList.contains('dset-paned')){el.classList.remove('dset-paned');return}
    close();
  }
  document.addEventListener('keydown',onKey);
  el.querySelector('#shX').onclick=close;
  el.querySelector('#shXm').onclick=close;
  el.querySelector('#shBack').onclick=()=>el.classList.remove('dset-paned');

  const nav=el.querySelector('#shNav'),main=el.querySelector('#shMain');
  let sec='shop';
  const owner=isOwner(ME&&ME.id);

  function draw(){
    const items=[{cat:'Shop'},{k:'shop',n:'VIP & MVP'},{k:'perks',n:'Compare perks'}];
    if(owner)items.push({cat:'Owner'},{k:'grant',n:'Grant a tier'});
    nav.innerHTML=items.map(it=>it.cat
      ?'<div class="dset-cat">'+esc(it.cat)+'</div>'
      :'<div class="dset-item'+(sec===it.k?' active':'')+'" data-k="'+it.k+'">'+esc(it.n)+'</div>').join('');
    nav.querySelectorAll('[data-k]').forEach(n=>n.onclick=()=>{
      sec=n.dataset.k;
      // phones show one pane at a time; picking a section is what reveals it
      if(narrow())el.classList.add('dset-paned');
      draw();
    });
    if(sec==='shop')drawShop();
    else if(sec==='perks')drawCompare();
    else drawGrant();
  }

  function drawShop(){
    main.innerHTML=
      '<div class="dshop-hero"><h1>Get more out of ICH</h1>'+
      '<p>VIP and MVP unlock extra channels, bigger messages and a tag on your name — and they keep the site running for everyone.</p></div>'+
      '<div class="dtiers">'+SHOP_TIERS.map(t=>{
        const st=shopStatus(t.id);
        return '<div class="dtier'+(t.featured?' featured':'')+'">'+
          (t.featured?'<div class="ribbon">Best value</div>':'')+
          '<h3><span style="color:'+t.color+'">●</span> '+esc(t.name)+'</h3>'+
          '<div class="drow-d" style="margin-top:2px">'+esc(t.tagline)+'</div>'+
          '<div class="price">'+esc(t.price)+' <small>'+esc(t.per)+'</small></div>'+
          '<ul>'+t.perks.map(p=>'<li><span class="ck">'+DI.check+'</span><span>'+p+'</span></li>').join('')+'</ul>'+
          '<div class="cta">'+(st.owned
            ? '<span class="downed">'+DI.check+' You have '+(st.via||t.name)+'</span>'
            : '<button type="button" class="dbtn block" data-buy="'+t.id+'">Get '+esc(t.name)+'</button>')+
          '</div></div>';
      }).join('')+'</div>'+
      '<div class="dsep"></div>'+
      '<div class="dnote info">Free alternative: the <b>Daily Spin</b> can win you 24-hour VIP, and has a rare chance at permanent MVP — no payment involved.'+
      ' <button type="button" class="dbtn sm grey" id="shSpin" style="margin-left:6px">Open Daily Spin</button></div>';
    main.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>openBuy(b.dataset.buy));
    const sp=main.querySelector('#shSpin');
    if(sp)sp.onclick=()=>{close();if(typeof openSpin==='function')openSpin();else if(typeof modalSpin==='function')modalSpin();else toast('The Daily Spin lives in the Extras menu.')};
  }

  function drawCompare(){
    const rows=[
      ['VIP tag and coloured name',1,1],
      ['#vip-lounge access',1,1],
      ['#mvp-lounge access',0,1],
      ['Custom profile description',1,1],
      ['Profile description length','150','300'],
      ['Message length','2,000','4,000'],
      ['Custom image banner',0,1],
      ['Daily Spins per day','1','3'],
      ['Ranked above staff in member list',0,1],
      ['Expires','never','never']
    ];
    main.innerHTML='<div class="dset-h1">Compare perks</div>'+
      '<div class="drow"><div class="drow-txt"><div class="drow-nm">Perk</div></div>'+
      '<div style="width:72px;text-align:center;font-weight:700;color:#b57cff">VIP</div>'+
      '<div style="width:72px;text-align:center;font-weight:700;color:#ffd93d">MVP</div></div>'+
      rows.map(([n,a,b])=>{
        const cell=v=>v===1?'<span style="color:var(--dl-green)">'+DI.check+'</span>'
          :v===0?'<span style="color:var(--dl-faint)">—</span>':'<span>'+esc(String(v))+'</span>';
        return '<div class="drow"><div class="drow-txt"><div class="drow-nm" style="font-size:15px;font-weight:400">'+esc(n)+'</div></div>'+
          '<div style="width:72px;text-align:center">'+cell(a)+'</div>'+
          '<div style="width:72px;text-align:center">'+cell(b)+'</div></div>';
      }).join('');
  }

  /* ---------- owner-only: actually grant a tier ---------- */
  function drawGrant(){
    main.innerHTML='<div class="dset-h1">Grant a tier</div>'+
      '<div class="dnote">Use this after you have confirmed a payment. It writes directly to <b>vip/</b> or <b>mvp/</b>, which your database rules allow only for owners.</div>'+
      '<div class="dfield"><label class="dlabel">Username or user ID</label>'+
      '<input class="dinput" id="gUser" placeholder="e.g. someone or 42"></div>'+
      '<div class="dfield"><label class="dlabel">Tier</label><select class="dinput" id="gTier">'+
        '<option value="vip">VIP — permanent</option>'+
        '<option value="mvp">MVP — permanent</option>'+
      '</select></div>'+
      '<div class="derr" id="gErr"></div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn" id="gGo">Grant</button>'+
      '<button type="button" class="dbtn danger" id="gRm">Remove tier</button></div>'+
      '<div id="gOut" style="margin-top:14px"></div>';

    const resolve=()=>{
      const raw=main.querySelector('#gUser').value.trim();
      if(!raw)throw new Error('Enter a username or ID.');
      if(/^\d+$/.test(raw)){
        const id=Number(raw);
        if(!DB.getUser(id))throw new Error('No account with ID '+id+'.');
        return id;
      }
      const all=DB.allUsers().filter(u=>u&&String(u.username).toLowerCase()===raw.toLowerCase());
      if(!all.length)throw new Error('No account called “'+raw+'”.');
      return all[0].id;
    };
    const run=async(remove)=>{
      const err=main.querySelector('#gErr'),out=main.querySelector('#gOut');
      err.textContent='';out.innerHTML='';
      const btn=main.querySelector(remove?'#gRm':'#gGo');btn.disabled=true;
      try{
        const id=resolve();
        const tier=main.querySelector('#gTier').value;
        const u=DB.getUser(id);
        if(remove){
          await remove_(tier==='mvp'?'mvp/'+id:'vip/'+id);
          out.innerHTML='<div class="dnote">Removed '+tier.toUpperCase()+' from <b>'+esc(u.username)+'</b> (#'+id+').</div>';
        }else{
          if(tier==='mvp')await set(R('mvp/'+id),Date.now()+SKEW);
          else await set(R('vip/'+id),{perm:true});
          out.innerHTML='<div class="dnote">Granted <b>'+tier.toUpperCase()+'</b> to <b>'+esc(u.username)+'</b> (#'+id+').</div>';
        }
        toast('Done.','good');
      }catch(e){err.textContent=e.message||(e.code||'Failed')}
      finally{btn.disabled=false}
    };
    // `remove` is shadowed by the Firebase import name, so alias it once here.
    const remove_=p=>remove(R(p));
    main.querySelector('#gGo').onclick=()=>run(false);
    main.querySelector('#gRm').onclick=()=>run(true);
  }

  /* ---------- how to pay ---------- */
  function openBuy(tier){
    const t=SHOP_TIERS.find(x=>x.id===tier);if(!t)return;
    dmodal({
      title:'Get '+t.name+' — '+t.price,
      sub:'Payments are handled by the owners, not by the site.',
      body:'<div class="dnote info">Message an owner on our Discord and quote the details below. Once they confirm your payment they’ll switch '+esc(t.name)+' on for your account, usually within a day.</div>'+
           '<div class="dfield"><label class="dlabel">Your account</label>'+
           '<div class="dcode"><span>'+esc(ME?displayUsername(ME.username):'')+' · ID '+(ME?ME.id:'?')+' · '+esc(t.name)+' '+esc(t.price)+'</span>'+
           '<button type="button" class="dbtn sm grey cp" data-cp>Copy</button></div>'+
           '<div class="dhint">Copy this and paste it when you message an owner, so they can find your account.</div></div>',
      footer:'<button type="button" class="dbtn sec" data-x>Close</button>'+
             '<button type="button" class="dbtn" data-dc>Open our Discord</button>',
      onOpen:m=>{
        m.foot.querySelector('[data-x]').onclick=m.close;
        m.foot.querySelector('[data-dc]').onclick=()=>{
          const url='https://discord.gg/MV8RD9XzvA';
          try{window.open(url,'_blank','noopener')}catch(_){location.href=url}
        };
        m.body.querySelector('[data-cp]').onclick=async()=>{
          const txt=(ME?displayUsername(ME.username):'')+' · ID '+(ME?ME.id:'?')+' · '+t.name+' '+t.price;
          const ok=await copyText(txt);toast(ok?'Copied':'Could not copy',ok?'good':'bad');
        };
      }
    });
  }

  draw();
}
