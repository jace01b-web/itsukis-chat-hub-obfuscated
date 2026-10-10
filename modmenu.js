/* VUS Mod Menu — loads AFTER the main script (see index.html).
   Client-side only: it changes how YOU see and write messages, and (via the Fake perms /
   Account protections toggles) what THIS browser enforces on itself. Nothing is written to
   the database for those toggles and other people's screens are never changed.
   Hotkeys: Alt+M = open/close menu · Alt+H = panic-hide menu + launcher. */
(()=>{
'use strict';
const LS='vusMod1';
const THEMES={Default:['#0f172a','#1e293b','#334155','#14532d','#166534','#f1f5f9','#22c55e'],Midnight:['#000','#0b0b14','#1c1c2e','#1a1a40','#33336b','#e5e7eb','#818cf8'],Dracula:['#282a36','#44475a','#6272a4','#3b3f5c','#bd93f9','#f8f8f2','#bd93f9'],Nord:['#2e3440','#3b4252','#4c566a','#434c5e','#88c0d0','#eceff4','#88c0d0'],Matrix:['#000','#001a00','#003300','#003b00','#00aa00','#00ff41','#00ff41'],Sunset:['#2b1020','#3d1a2e','#6b2d4a','#7a2e1d','#c2410c','#fde8d8','#fb923c'],Ocean:['#06202b','#0a3446','#116466','#0e4d64','#1d8aa6','#e0f7fa','#22d3ee'],Rose:['#1f1017','#3a1c2a','#6b2c4a','#5b1a3a','#be185d','#ffe4ef','#f472b6'],Solar:['#002b36','#073642','#586e75','#0b4a4a','#2aa198','#eee8d5','#b58900'],Light:['#f1f5f9','#ffffff','#cbd5e1','#bbf7d0','#86efac','#0f172a','#16a34a'],Contrast:['#000','#000','#fff','#000','#ff0','#fff','#ff0']};
const mk=(s,v)=>Object.fromEntries(s.split(' ').map(k=>[k,v]));
const D={...mk('hs hb ht cp gr bi hi zen ag cs cap lock dnd mp dn fl vib tts open kc',false),...mk('lk lb an snap launch ut fv emo ttsm far fpp nc nb nt fas ar own fin',true),
theme:'Default',font:'system-ui,Arial,sans-serif',v:2,fs:16,ms:12,mw:82,gap:12,zoom:1,bs:'round',br:100,warm:0,dim:.4,bg:'',ac:'',ccss:'',kw:'',cw:'',pre:'',suf:'',fuName:'',tf:'none',snd:'off',st:'blip',vol:70,rate:1,op:100,msc:1,
muted:[],fr:[],hl:{},nick:{},snips:[],hist:[],pins:[],note:'',alias:{},away:false,awayMsg:"I'm away right now, back soon!",dup:false,pos:null,lpos:null};
const BOOL=Object.keys(D).filter(k=>typeof D[k]==='boolean');
let S={...D};try{Object.assign(S,JSON.parse(localStorage.getItem(LS)||'{}'))}catch(e){}
if((S.v||0)<2){S.fs=D.fs;S.ms=D.ms;S.v=2}/* one-time: new default text sizes for the revamped look */
const save=()=>{try{localStorage.setItem(LS,JSON.stringify(S))}catch(e){}};
const ST={seen:0,sent:0,t0:Date.now(),un:0,hold:false,held:0,ready:false};
const LOG=[];
const h=(t,a,...c)=>{const e=document.createElement(t);Object.assign(e,a||{});c.flat().forEach(x=>x!=null&&e.append(x));return e};
const lst=s=>(s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const toast=m=>{const t=h('div',{className:'vt',textContent:m});document.body.append(t);setTimeout(()=>t.remove(),3000)};
const copy=t=>navigator.clipboard&&navigator.clipboard.writeText(t).then(()=>toast('Copied'));
const ins=s=>{const i=$msgInput,a=i.selectionStart==null?i.value.length:i.selectionStart,b=i.selectionEnd==null?a:i.selectionEnd;i.setRangeText(s,a,b,'end');if(i.value.length>500)i.value=i.value.slice(0,500);i.dispatchEvent(new Event('input',{bubbles:true}));i.focus()};
const dl=(n,txt,type)=>{const a=h('a',{href:URL.createObjectURL(new Blob([txt],{type})),download:n});document.body.append(a);a.click();a.remove()};
const tog=(k,v)=>{const i=S[k].indexOf(v);i<0?S[k].push(v):S[k].splice(i,1);save();refresh()};

/* ───────── text styles / transforms (applied when YOU send) ───────── */
const FN={bold:[0x1D400,0x1D41A],italic:[0x1D434,0x1D44E],script:[0x1D4D0,0x1D4EA],fraktur:[0x1D56C,0x1D586],sans:[0x1D5A0,0x1D5BA],mono:[0x1D670,0x1D68A],wide:[0xFF21,0xFF41],circle:[0x24B6,0x24D0]};
const fancy=(s,[u,l],k)=>[...s].map(c=>{const n=c.charCodeAt(0);if(k==='italic'&&c==='h')return'ℎ';return n>=65&&n<=90?String.fromCodePoint(u+n-65):n>=97&&n<=122?String.fromCodePoint(l+n-97):c}).join('');
const TF={none:s=>s,upper:s=>s.toUpperCase(),lower:s=>s.toLowerCase(),mock:s=>[...s].map((c,i)=>i%2?c.toUpperCase():c.toLowerCase()).join(''),
uwu:s=>s.replace(/[lr]/g,'w').replace(/[LR]/g,'W').replace(/n([aeiou])/g,'ny$1').replace(/!+/g,' >w<'),clap:s=>s.split(/\s+/).join(' 👏 '),
leet:s=>s.replace(/[aeiolst]/gi,c=>({a:4,e:3,i:1,o:0,l:1,s:5,t:7})[c.toLowerCase()]),rev:s=>[...s].reverse().join(''),spaced:s=>[...s].join(' ')};
Object.keys(FN).forEach(k=>TF[k]=s=>fancy(s,FN[k],k));
const EM={smile:'😄',heart:'❤️',fire:'🔥',thumbsup:'👍',laugh:'😂',cry:'😭',think:'🤔',cool:'😎',party:'🎉',skull:'💀',eyes:'👀',100:'💯',sparkles:'✨',wave:'👋',ok:'👌',clap:'👏',rocket:'🚀',sob:'🥲',shrug:'¯\\_(ツ)_/¯',tableflip:'(╯°□°)╯︵ ┻━┻',unflip:'┬─┬ ノ( ゜-゜ノ)',lenny:'( ͡° ͜ʖ ͡°)'};
const cut=t=>{let o='';for(const c of t){if((o+c).length>500)break;o+=c}return o};
const tx=t=>{t=t.replace(/\{(time|date|me|online)\}/g,(m,k)=>({time:new Date().toLocaleTimeString(),date:new Date().toLocaleDateString(),me:myName,online:$onlineCount.textContent.trim()})[k]);if(S.emo)t=t.replace(/:(\w+):/g,(m,k)=>EM[k]||m);if(S.cap)t=t.replace(/(^\s*|[.!?]\s+)([a-z])/g,(m,a,b)=>a+b.toUpperCase());t=S.pre+t+S.suf;return cut((TF[S.tf]||TF.none)(t))};
const EMO='😀😁😂🤣😊😍😘😎🤔😴😭😡🥳🤯🥺😏🙄😬🤗😇👍👎👏🙌🙏💪👀🔥✨💯🎉❤️💔💀👻🤖🎮🎵🍕🍔☕🍺🚀⭐🌈🌙☀️⚡🐱🐶🦊🐸'.match(/\p{Extended_Pictographic}\uFE0F?(\u200D\p{Extended_Pictographic}\uFE0F?)*/gu);

/* ───────── sounds / alerts ───────── */
let AC;const beep=(ty)=>{ty=ty||S.st;try{AC=AC||new AudioContext();const v=S.vol/100*.3,t=AC.currentTime;({blip:[[880,0,.1]],chime:[[660,0,.15],[990,.12,.25]],pop:[[300,0,.05],[600,.04,.08]],bell:[[1200,0,.6]]})[ty].forEach(([f,d,l])=>{const o=AC.createOscillator(),g=AC.createGain();o.frequency.value=f;o.type=ty==='pop'?'square':ty==='bell'?'triangle':'sine';g.gain.setValueAtTime(v,t+d);g.gain.exponentialRampToValueAtTime(.0001,t+d+l);o.connect(g).connect(AC.destination);o.start(t+d);o.stop(t+d+l+.05)})}catch(e){}};
const BASE=document.title;
const badge=()=>{if(S.ut)document.title=ST.un?'('+ST.un+') '+BASE:BASE;if(S.fv){const c=h('canvas',{width:32,height:32}),x=c.getContext('2d');x.fillStyle=ST.un?'#ef4444':'#22c55e';x.beginPath();x.arc(16,16,15,0,7);x.fill();if(ST.un){x.fillStyle='#fff';x.font='bold 20px Arial';x.textAlign='center';x.fillText(ST.un>9?'9+':ST.un,16,23)}let l=document.querySelector('link[rel=icon]');if(!l){l=h('link',{rel:'icon'});document.head.append(l)}l.href=c.toDataURL()}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden){ST.un=0;badge()}});
const fire=(why,n,raw)=>{if(S.dnd)return;if(S.snd==='all'||(S.snd==='mention'&&why))beep();
if(S.tts&&(!S.ttsm||why)&&window.speechSynthesis){const u=new SpeechSynthesisUtterance(n+' says '+raw);u.rate=+S.rate;speechSynthesis.speak(u)}
if(document.hidden){ST.un++;badge();if(S.dn&&why&&window.Notification&&Notification.permission==='granted')try{new Notification(n,{body:raw})}catch(e){}}
if(why&&S.fl){document.body.classList.add('vm-flash');setTimeout(()=>document.body.classList.remove('vm-flash'),400)}
if(why&&S.vib&&navigator.vibrate)navigator.vibrate(200)};

/* ───────── per-message processing ───────── */
const style1=el=>{const n=el.dataset.vmName||'',k=n.toLowerCase();el.classList.toggle('vm-hide',S.muted.includes(k)||el.dataset.vmH==='1');
el.style.borderLeft=S.hl[k]?'3px solid '+S.hl[k]:'';el.style.paddingLeft=S.hl[k]?'8px':'';
const m=el.querySelector('.msg-meta');if(m&&el.dataset.vmMeta){let t=el.dataset.vmMeta;if(S.own&&myName&&el.classList.contains('mine'))t=t.replace(/^You(?=\s|$)/,myName);if(S.nick[k]&&n!==myName)t=t.replace(n,S.nick[k]+'*');m.textContent=t}};
const refresh=()=>document.querySelectorAll('.msg:not(.system)').forEach(style1);
const rich=b=>{const cw=lst(S.cw),kw=lst(S.kw);const w=[];const tw=document.createTreeWalker(b,NodeFilter.SHOW_TEXT);while(tw.nextNode())w.push(tw.currentNode);
w.forEach(t=>{const o=esc(t.nodeValue);const s=o.split(/(https?:\/\/[^\s<]+)/g).map((p,i)=>{if(i%2)return S.lk?`<a href="${p}" target="_blank" rel="noopener noreferrer" style="color:var(--vm-ac);text-decoration:underline">${p}</a>`:p;
cw.forEach(x=>{p=p.replace(new RegExp(reEsc(esc(x)),'gi'),m=>'•'.repeat(m.length))});kw.forEach(x=>{p=p.replace(new RegExp(reEsc(esc(x)),'gi'),m=>`<mark class="vm-mk">${m}</mark>`)});return p}).join('');
if(s!==o){const sp=h('span');sp.innerHTML=s;t.replaceWith(sp)}})};
const actions=el=>{const b=(t,ti,f)=>h('button',{textContent:t,title:ti,onclick:e=>{e.stopPropagation();f()}});
return h('div',{className:'vm-act'},b('📋','Copy',()=>copy(el.dataset.vmRaw)),b('↩','Quote',()=>ins('> '+el.dataset.vmName+': '+el.dataset.vmRaw.slice(0,120)+'\n')),
b('🔇','Mute this user (local)',()=>{if(el.dataset.vmName!==myName)tog('muted',el.dataset.vmName.toLowerCase())}),b('📌','Pin (local)',()=>{S.pins.push({n:el.dataset.vmName,t:el.dataset.vmRaw});save();toast('Pinned')}),b('👁','Hide this message',()=>{el.dataset.vmH='1';style1(el)}))};
const proc=el=>{if(el.dataset.vm||el.classList.contains('system'))return;el.dataset.vm=1;if(!ST.rt)ST.rt=setTimeout(()=>ST.ready=true,5000);
const br=el.querySelector('.role-bubble-row'),n=br?br.dataset.senderName:'',b=el.querySelector('.msg-bubble'),m=el.querySelector('.msg-meta'),img=b&&b.querySelector('img');
el.dataset.vmName=n;el.dataset.vmMeta=m?m.textContent:'';if(!b)return;const raw=img?'[image]':b.textContent;el.dataset.vmRaw=raw;LOG.push({n,t:raw,ts:Date.now()});ST.seen++;
const chip=el.querySelector('.mention-chip-inline'),ment=!!myName&&((chip&&chip.textContent==='@'+myName)||new RegExp('@'+reEsc(myName)+'\\b','i').test(raw)),hit=lst(S.kw).some(k=>raw.toLowerCase().includes(k));
if(!img)rich(b);const pv=el.previousElementSibling;if(pv&&pv.dataset.vmName===n&&!pv.classList.contains('system'))el.classList.add('vm-grp');
el.append(actions(el));if(ST.hold){el.classList.add('vm-held');ST.held++}style1(el);if(ment||hit)el.classList.add('vm-me');
if(ST.ready&&n!==myName&&!el.classList.contains('vm-hide'))fire(ment||hit,n,raw);if(ment&&n!==myName)sendAwayReply(n)};

/* ───────── appearance ───────── */
const dyn=h('style'),stat=h('style');document.head.append(stat,dyn);
stat.textContent=`:root{--vm-ac:#22c55e}
body.vm-hs .msg.system,body.vm-hb .role-bubble-row,body.vm-ht .msg-meta,body.vm-zen .chat-header,body.vm-zen #toolbar,body.vm-zen #typingBar,body.vm-hi .msg-bubble img{display:none!important}
body.vm-cp #messages{gap:3px!important}body.vm-cp .msg-bubble{padding:4px 10px!important}
body.vm-gr .vm-grp .msg-meta,body.vm-gr .vm-grp .role-bubble-row{display:none!important}body.vm-gr .vm-grp{margin-top:-9px}
body.vm-bi .msg-bubble img{filter:blur(14px);transition:.2s}body.vm-bi .msg-bubble img:hover{filter:none}
body.vm-an .msg{animation:vmpop .25s}@keyframes vmpop{from{opacity:0;transform:translateY(8px) scale(.97)}}
body.vm-ag #messages{background:linear-gradient(120deg,#1e3a8a33,#7c3aed33,#06b6d433,#22c55e33)!important;background-size:400% 400%;animation:vmg 14s ease infinite}@keyframes vmg{50%{background-position:100% 50%}}
body.vm-flash{box-shadow:inset 0 0 0 6px var(--vm-ac)}
.vm-hide,.vm-nf,.vm-held{display:none!important}.msg{position:relative}.vm-me .msg-bubble{box-shadow:0 0 0 2px var(--vm-ac)}.vm-mk{background:#facc15;color:#000;border-radius:3px;padding:0 2px}
.vm-act{position:absolute;top:-12px;right:4px;display:none;gap:1px;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:1px 3px;z-index:5}.msg.mine .vm-act{right:auto;left:4px}.msg:hover .vm-act{display:flex}.vm-act button{background:none;border:0;cursor:pointer;font-size:14px;padding:2px}
.vlb{position:fixed;inset:0;background:#000d;z-index:100000;display:flex;align-items:center;justify-content:center;cursor:zoom-out}.vlb img{max-width:92vw;max-height:92vh;border-radius:8px}
.vt{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:rgba(15,20,34,.92);backdrop-filter:blur(14px);color:#f1f5f9;border:1px solid rgba(255,255,255,.1);border-left:3px solid var(--vm-ac);padding:10px 16px;border-radius:12px;z-index:100001;font:13.5px system-ui,Arial;box-shadow:0 12px 40px #000a;animation:vmt .22s ease-out;max-width:90vw}@keyframes vmt{from{opacity:0;transform:translate(-50%,10px)}}
.vm-panic #vm,.vm-panic #vml{display:none!important}
#vml{position:fixed;z-index:99998;width:52px;height:52px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:radial-gradient(circle at 30% 25%,#2b3550,#0f1424);color:#fff;font-size:22px;cursor:grab;box-shadow:0 8px 26px #000a,0 0 0 3px color-mix(in srgb,var(--vm-ac) 25%,transparent);transition:box-shadow .2s,transform .15s}#vml:hover{transform:scale(1.07);box-shadow:0 8px 26px #000a,0 0 22px var(--vm-ac)}#vml.vml-on::after{content:'';position:absolute;top:4px;right:4px;width:11px;height:11px;border-radius:50%;background:var(--vm-ac);border:2px solid #0f1424}
#vm{position:fixed;z-index:99999;width:500px;height:650px;min-width:340px;min-height:300px;max-width:98vw;max-height:96vh;background:linear-gradient(160deg,rgba(20,27,45,.97),rgba(9,13,24,.97));backdrop-filter:blur(22px) saturate(1.3);color:#e5e9f2;border:1px solid rgba(255,255,255,.09);border-radius:22px;box-shadow:0 30px 80px #000c,0 0 70px -25px var(--vm-ac);display:none;flex-direction:column;resize:both;overflow:hidden;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;transform-origin:top left}
#vm.on{display:flex;animation:vmo .2s ease-out}@keyframes vmo{from{opacity:0;transform:scale(.97) translateY(6px)}}#vm.min{height:auto!important;min-height:0;resize:none}#vm.min .vmain{display:none}
#vm .vhd{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:linear-gradient(90deg,color-mix(in srgb,var(--vm-ac) 14%,transparent),transparent 70%);border-bottom:1px solid rgba(255,255,255,.07);cursor:move;font-weight:700;user-select:none;font-size:14px}
#vm .vbrand{display:flex;align-items:center;gap:9px}#vm .vlogo{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,var(--vm-ac),color-mix(in srgb,var(--vm-ac) 40%,#6366f1));color:#05080f;font-size:15px}
#vm .vchip{margin-left:2px;font-weight:600;color:#aab4c8;background:rgba(255,255,255,.07);border-radius:20px;padding:3px 10px;font-size:11px;white-space:nowrap}
#vm .vhd button{background:rgba(255,255,255,.05);border:0;color:#aab4c8;font-size:15px;cursor:pointer;border-radius:9px;width:28px;height:28px;margin-left:4px;transition:.15s}#vm .vhd button:hover{background:rgba(255,255,255,.14);color:#fff}
#vm .vmain{flex:1;display:flex;min-height:0}
#vm .vtabs{display:flex;flex-direction:column;width:74px;flex-shrink:0;overflow-y:auto;background:rgba(0,0,0,.22);border-right:1px solid rgba(255,255,255,.06);padding:8px 6px;gap:3px;scrollbar-width:none}
#vm .vtabs button{position:relative;background:none;border:0;border-radius:12px;color:#8e9ab1;padding:8px 2px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10.5px;font-weight:600;transition:.15s}#vm .vtabs button span{font-size:19px}#vm .vtabs button:hover{background:rgba(255,255,255,.06);color:#dbe3f2}
#vm .vtabs button.on{background:rgba(255,255,255,.08);background:color-mix(in srgb,var(--vm-ac) 20%,transparent);color:#fff;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--vm-ac) 55%,transparent)}
#vm .vcol{flex:1;display:flex;flex-direction:column;min-width:0}
#vm .vsrch{margin:10px 12px 0;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);border-radius:12px;color:#f1f5f9;padding:9px 12px;font:inherit;outline:none;transition:.15s}#vm .vsrch:focus{border-color:var(--vm-ac);box-shadow:0 0 0 3px color-mix(in srgb,var(--vm-ac) 20%,transparent)}
#vm .vbody{flex:1;overflow-y:auto;padding:4px 12px 18px;scrollbar-width:thin;scrollbar-color:#3a4560 transparent}
#vm .vsec{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:4px 6px 6px;margin:10px 0}
#vm .vh{margin:0;padding:9px 8px 4px;color:var(--vm-ac);font-weight:800;text-transform:uppercase;font-size:10.5px;letter-spacing:.12em}#vm .vh2{margin:14px 2px 6px;color:#8e9ab1;font-weight:800;text-transform:uppercase;font-size:10.5px;letter-spacing:.12em}
#vm .vn{color:#7f8aa1;font-size:12px;padding:4px 8px}
#vm .vr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px;border-radius:11px;transition:background .12s}#vm .vr:hover{background:rgba(255,255,255,.045)}#vm .vr.col{display:block}
#vm .vl{display:flex;flex-direction:column;min-width:0}#vm .vl b{font-weight:600;color:#f1f5f9}#vm .vl small{color:#8794ac;font-size:11.5px;margin-top:1px}
#vm input[type=text],#vm input[type=number],#vm textarea,#vm select,#vm .vi{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);color:#f1f5f9;border-radius:10px;padding:8px 10px;font:inherit;max-width:100%;outline:none;transition:.15s}#vm .vi:focus,#vm textarea:focus,#vm input[type=text]:focus,#vm select:focus{border-color:var(--vm-ac);box-shadow:0 0 0 3px color-mix(in srgb,var(--vm-ac) 18%,transparent)}#vm .col input,#vm .col textarea,#vm .vi{width:100%;margin:4px 0;box-sizing:border-box}
#vm input[type=range]{width:130px;accent-color:var(--vm-ac)}
#vm input[type=checkbox]{appearance:none;-webkit-appearance:none;width:40px;height:23px;border-radius:23px;background:#2c3750;position:relative;cursor:pointer;transition:.2s;flex:none;margin:0}#vm input[type=checkbox]::after{content:'';position:absolute;top:2.5px;left:2.5px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 4px #0006}#vm input[type=checkbox]:checked{background:var(--vm-ac);box-shadow:0 0 14px -2px var(--vm-ac)}#vm input[type=checkbox]:checked::after{left:19.5px}
#vm button.vb{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#e5e9f2;border-radius:10px;padding:7px 12px;margin:5px 5px 0 0;cursor:pointer;font:inherit;font-weight:600;transition:.15s}#vm button.vb:hover:not(:disabled){border-color:var(--vm-ac);background:color-mix(in srgb,var(--vm-ac) 16%,transparent);transform:translateY(-1px)}#vm button.vb:active:not(:disabled){transform:none}#vm button.vb:disabled{opacity:.4;cursor:not-allowed}
#vm .vp{background:rgba(0,0,0,.32);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:10px;white-space:pre-wrap;font:12px ui-monospace,Consolas,monospace;margin:6px 0;word-break:break-word}
#vm .vcard{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:13px;padding:10px;margin:8px 0}#vm .vcn{display:flex;justify-content:space-between;align-items:center}#vm .vlock{color:#f87171;font-size:11px;font-weight:700}#vm .vok{color:var(--vm-ac);font-size:11px;font-weight:700}
#vm .vhero{display:flex;align-items:center;gap:12px;padding:14px;margin:10px 0 0;border-radius:18px;background:linear-gradient(135deg,color-mix(in srgb,var(--vm-ac) 22%,transparent),rgba(255,255,255,.03));border:1px solid color-mix(in srgb,var(--vm-ac) 35%,transparent)}
#vm .vav{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-weight:800;font-size:20px;background:linear-gradient(135deg,var(--vm-ac),#6366f1);color:#06090f;flex:none}#vm .vwho{display:flex;flex-direction:column;min-width:0}#vm .vwho b{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#vm .vwho small{color:#aab4c8;font-size:12px}
#vm .vgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#vm .vtile{display:flex;align-items:center;gap:10px;text-align:left;padding:11px;border-radius:14px;cursor:pointer;color:#cbd5e4;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);font:inherit;transition:.15s}#vm .vtile:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.2)}
#vm .vtile.on{background:color-mix(in srgb,var(--vm-ac) 16%,transparent);border-color:color-mix(in srgb,var(--vm-ac) 60%,transparent);box-shadow:0 0 20px -8px var(--vm-ac);color:#fff}
#vm .vti{font-size:22px}#vm .vtt{display:flex;flex-direction:column;flex:1;min-width:0}#vm .vtt b{font-size:12.5px}#vm .vtt small{color:#8e9ab1;font-size:10.5px;line-height:1.3}
#vm .vst{font-size:9.5px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:20px;background:rgba(255,255,255,.08);color:#8e9ab1}#vm .vtile.on .vst{background:var(--vm-ac);color:#05080f}
@media(max-width:700px){#vm{left:0!important;right:0!important;top:auto!important;bottom:0!important;width:100vw!important;max-width:100vw;height:88vh!important;border-radius:22px 22px 0 0;resize:none;transform:none!important}#vm .vmain{flex-direction:column}#vm .vtabs{flex-direction:row;width:auto;overflow-x:auto;border-right:0;border-bottom:1px solid rgba(255,255,255,.06);padding:6px}#vm .vtabs button{flex:0 0 auto;min-width:60px}#vm .vgrid{grid-template-columns:1fr}}`;
stat.textContent+=`
#vm .vh{cursor:pointer;display:flex;justify-content:space-between;align-items:center}#vm .vh::after{content:'⌄';font-size:15px;opacity:.55;transition:transform .2s}#vm .vsec.closed .vh::after{transform:rotate(-90deg)}#vm .vsec.closed>*:not(.vh){display:none}
#vm .rg{display:block}#vm .rgt{display:flex;justify-content:space-between;align-items:center}#vm .rgv{font-weight:700;font-size:11.5px;padding:2px 10px;border-radius:20px;background:rgba(255,255,255,.09);min-width:30px;text-align:center}
#vm input[type=range]{-webkit-appearance:none;appearance:none;width:100%!important;height:6px;margin:10px 0 4px!important;padding:0!important;border:0!important;border-radius:6px;background:linear-gradient(90deg,var(--vm-ac) var(--p,50%),rgba(255,255,255,.14) var(--p,50%))!important;outline:none;box-shadow:none!important}
#vm input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;border:3px solid var(--vm-ac);box-shadow:0 2px 8px #0008;cursor:pointer}#vm input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid var(--vm-ac);cursor:pointer}
#vm select{color-scheme:dark;cursor:pointer}
#vm .vgrid3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}#vm .vsb{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:9px 6px;text-align:center}#vm .vsb b{display:block;font-size:17px}#vm .vsb small{color:#8e9ab1;font-size:10.5px}
#vm .vft{display:flex;justify-content:space-between;gap:8px;padding:7px 14px;font-size:11px;color:#7f8aa1;border-top:1px solid rgba(255,255,255,.06);background:rgba(0,0,0,.22)}#vm .vft span:first-child{color:var(--vm-ac);font-weight:700}#vm.min .vft{display:none}`;
if(typeof PING_YOU_WEBHOOK_URL!=='undefined'&&!PING_YOU_WEBHOOK_URL)stat.textContent+='#pingYouBtn{display:none!important}';
let menu,launcher;
const apply=()=>{const t=THEMES[S.theme]||THEMES.Default,ac=S.ac||t[6],r=document.documentElement.style;r.setProperty('--vm-ac',ac);
BOOL.forEach(k=>document.body.classList.toggle('vm-'+k,!!S[k]));
const A=`border-color:${ac}!important`,bs={round:'',square:'border-radius:3px!important',pill:'border-radius:26px!important',glass:'backdrop-filter:blur(8px)',outline:A,neon:`box-shadow:0 0 12px ${ac}`}[S.bs]||'';
const bgb=S.bs==='glass'?'background:rgba(255,255,255,.1)!important':S.bs==='outline'?'background:transparent!important':'';
const nat=S.theme==='Default',chg=k=>S[k]!==D[k];
dyn.textContent=`${nat?'':`body{background:${t[0]}!important;color:${t[5]}!important}.chat-header,#toolbar{border-color:${t[2]}!important}.msg-bubble{border-color:${t[2]}!important}
.msg-bubble:not([style*=background]){background:${t[1]}!important;color:${t[5]};${bgb}}.msg.mine .msg-bubble:not([style*=background]){background:${t[3]}!important;${bgb}}.msg.mine .msg-bubble{border-color:${t[4]}!important}`}
${chg('font')?`body{font-family:${S.font}!important}`:''}${chg('zoom')?`html{zoom:${S.zoom}}`:''}
.msg-bubble{${chg('fs')?`font-size:${S.fs}px!important;`:''}${bs}}${nat&&bgb?`.msg-bubble:not([style*=background]){${bgb}}`:''}
${chg('ms')?`.msg-meta{font-size:${S.ms}px!important}`:''}${chg('mw')?`.msg{max-width:${S.mw}%!important}`:''}
#messages{${chg('gap')?`gap:${S.gap}px!important;`:''}${chg('br')||chg('warm')?`filter:brightness(${S.br}%) sepia(${S.warm}%);`:''}${S.bg?`background:linear-gradient(rgba(0,0,0,${S.dim}),rgba(0,0,0,${S.dim})),url("${S.bg.replace(/"/g,'%22')}") center/cover fixed;`:''}}
.mention-chip-inline,.toolbar-btn.active{color:${ac}!important}.toolbar-btn.active{border-color:${ac}!important}
${S.ccss}`;
try{$pingSound.muted=S.mp;$pingSound.volume=Math.min(1,S.vol/100)}catch(e){}
if(launcher)launcher.classList.toggle('vml-on',!!(S.far||S.fpp||S.nc||S.nb||S.nt));if(menu){menu.style.opacity=S.op/100;menu.style.transform='scale('+S.msc+')';launcher.style.display=S.launch?'':'none'}};
const set=(k,v)=>{S[k]=v;save();apply()};

/* ───────── menu building blocks ───────── */
const btn=(t,f,ti)=>h('button',{className:'vb',textContent:t,title:ti||'',onclick:f});
const row=r=>{const [t,k,l,a,b,c]=r;
if(t==='h')return h('div',{className:'vh',textContent:k});if(t==='n')return h('div',{className:'vn',textContent:k});if(t==='x')return k();
if(t==='b')return h('div',{},k.map(([x,f,ti])=>btn(x,f,ti)));
if(t==='t'){const i=h('input',{type:'checkbox',checked:!!S[k],onchange:()=>{set(k,i.checked);a&&a(i.checked)}});const m=String(l).match(/^(.*?)\s*\((.+)\)\s*$/);return h('label',{className:'vr'},h('span',{className:'vl'},h('b',{textContent:m?m[1]:l}),m?h('small',{textContent:m[2]}):null),i)}
if(t==='r'){const v=h('span',{className:'rgv',textContent:S[k]}),pc=()=>i.style.setProperty('--p',((i.value-i.min)/((i.max-i.min)||1)*100)+'%'),i=h('input',{type:'range',min:a,max:b,step:c||1,value:S[k],oninput:()=>{v.textContent=i.value;pc();set(k,+i.value)}});pc();return h('div',{className:'vr rg'},h('div',{className:'rgt'},h('span',{className:'vl'},h('b',{textContent:l})),v),i)}
if(t==='s'){const o=x=>Array.isArray(x)?x:[x,x],i=h('select',{onchange:()=>set(k,i.value)},a.map(x=>h('option',{value:o(x)[0],textContent:o(x)[1],selected:o(x)[0]==S[k]})));return h('label',{className:'vr'},l,i)}
if(t==='c'){const i=h('input',{type:'color',value:S[k]||'#22c55e',oninput:()=>set(k,i.value)});return h('label',{className:'vr'},l,h('span',{},i,btn('Auto',()=>{set(k,'');i.value='#22c55e'})))}
if(t==='i')return h('div',{className:'vr col'},l,h('input',{type:'text',value:S[k]||'',oninput:e=>a?a(e.target.value):set(k,e.target.value)}));
if(t==='a')return h('div',{className:'vr col'},l,h('textarea',{rows:a||4,value:S[k]||'',oninput:e=>set(k,e.target.value)}))};

/* ───────── custom panels ───────── */
const live=(node,f,ms)=>{f();const iv=setInterval(()=>node.isConnected?f():clearInterval(iv),ms);return node};
const people=()=>{const box=h('div'),q=h('input',{className:'vi',placeholder:'Filter online users…',oninput:()=>r()}),L=h('div');box.append(q,L);
const HLC=['','#facc15','#f472b6','#38bdf8','#a78bfa','#fb923c'];
const r=()=>L.replaceChildren(...(typeof latestPresenceList!=='undefined'?latestPresenceList:[]).filter(e=>e.name.toLowerCase().includes(q.value.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>{const k=e.name.toLowerCase(),ro=e.loginId&&ROLES[effectiveRoleForLoginId(e.loginId)];
return h('div',{className:'vr'},(ro?ro.icon+' ':'')+e.name+(e.name===myName?' (you)':'')+(S.muted.includes(k)?' 🔇':'')+(S.fr.includes(k)?' ⭐':''),h('span',{},
btn('🔇',()=>{if(e.name!==myName){tog('muted',k);r()}},'Mute/unmute (local)'),btn('⭐',()=>{tog('fr',k);r()},'Friend: get a toast when they join/leave'),
btn('✏️',()=>{const n=prompt('Local nickname for '+e.name+' (only you see it):',S.nick[k]||'');if(n!==null){n?S.nick[k]=n:delete S.nick[k];save();refresh();r()}},'Nickname'),
btn('🎨',()=>{S.hl[k]=HLC[(HLC.indexOf(S.hl[k]||'')+1)%HLC.length];if(!S.hl[k])delete S.hl[k];save();refresh()},'Cycle highlight color')))}));
return live(box,r,3000)};
const listNode=(key,fmt,onClick,emptyMsg)=>{const L=h('div');const r=()=>{L.replaceChildren(...(S[key].length?S[key].map((x,i)=>h('div',{className:'vr'},h('span',{textContent:fmt(x),style:'cursor:pointer;flex:1',onclick:()=>onClick(x)}),btn('✕',()=>{S[key].splice(i,1);save();r()}))):[h('div',{className:'vn',textContent:emptyMsg})]))};r();return L};
const snippets=()=>{const box=h('div'),i=h('input',{className:'vi',placeholder:'New quick reply…'});box.append(i,btn('Add',()=>{if(i.value.trim()){S.snips.push(i.value.trim());save();i.value='';box.replaceChildren(...snippets().childNodes)}}),listNode('snips',x=>x,x=>ins(x),'No quick replies yet.'));return box};
const emojis=()=>h('div',{style:'line-height:1.9'},EMO.map(e=>h('span',{textContent:e,style:'cursor:pointer;font-size:20px;padding:2px',onclick:()=>ins(e)})));
const styler=()=>{const i=h('input',{className:'vi',placeholder:'Type text, click a style to insert it into your message'}),L=h('div');i.oninput=()=>L.replaceChildren(...Object.keys(TF).filter(k=>k!=='none').map(k=>h('div',{className:'vr'},h('span',{textContent:k,style:'color:#94a3b8;width:70px'}),h('span',{textContent:TF[k](i.value||'Hello World'),style:'cursor:pointer;flex:1;word-break:break-all',onclick:()=>ins(cut(TF[k](i.value||'Hello World')))}))));i.oninput();return h('div',{},i,L)};
const preview=()=>{const p=h('div',{className:'vp'});return live(p,()=>{p.textContent='Next message will send as:\n'+($msgInput.value?tx($msgInput.value):'(type something in the chat box)')},700)};
const sched=()=>{const m=h('input',{type:'number',min:1,max:120,value:1,style:'width:60px'}),t=h('input',{className:'vi',placeholder:'Message to send later…'});
return h('div',{},t,h('div',{className:'vr'},'Send in (minutes):',m),btn('Schedule',()=>{const txt=t.value.trim();if(!txt)return;const wait=Math.max(1,+m.value||1)*60000;toast('Scheduled in '+m.value+' min');t.value='';
setTimeout(()=>{const go=()=>{const old=$msgInput.value;$msgInput.value=txt;$msgInput.dispatchEvent(new Event('input',{bubbles:true}));$sendBtn.click();setTimeout(()=>{if($msgInput.value===txt)$msgInput.value=old;else if(old&&!$msgInput.value)$msgInput.value=old;$msgInput.dispatchEvent(new Event('input',{bubbles:true}))},1800)};
const left=currentMessageCooldownMs()-(Date.now()-lastSentAt);left>0?setTimeout(go,left+100):go()},wait)}),h('div',{className:'vn',textContent:'Sends through the normal send button, so your rank delay, timeouts and bans still apply.'}))};
const dice=()=>{const R=n=>1+Math.floor(Math.random()*n),B=['Yes.','No.','Maybe.','Definitely.','Ask again later.','Not a chance.','Signs point to yes.','Very doubtful.'];
return h('div',{},[6,20,100].map(n=>btn('🎲 d'+n,()=>ins('🎲 d'+n+': '+R(n)+' '))),btn('🪙 Coin',()=>ins('🪙 '+(R(2)>1?'Heads':'Tails')+' ')),btn('🎱 8-ball',()=>ins('🎱 '+B[R(B.length)-1]+' ')))};
const timer=()=>{const m=h('input',{type:'number',min:1,max:600,value:5,style:'width:60px'});return h('div',{className:'vr'},'Timer (min):',m,btn('Start',()=>{toast('Timer started: '+m.value+' min');setTimeout(()=>{beep('bell');toast('⏰ Timer finished!')},m.value*60000)}))};
const upl=()=>h('input',{type:'file',accept:'.json',onchange:e=>{const f=e.target.files[0];if(!f)return;f.text().then(x=>{try{Object.assign(S,JSON.parse(x));save();apply();refresh();toast('Settings imported')}catch(err){toast('Bad file')}})}});
const STOP=new Set('that this with have from they been were what when your will just like about there their would could should them then than into some more very also because'.split(' '));
const stats=()=>{const p=h('div',{className:'vp'}),f=()=>{const u={},w={};LOG.forEach(m=>{u[m.n]=(u[m.n]||0)+1;(m.t.toLowerCase().match(/[a-z']{4,}/g)||[]).forEach(x=>STOP.has(x)||(w[x]=(w[x]||0)+1))});
const top=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,8),bar=(n,mx)=>'█'.repeat(Math.max(1,Math.round(n/mx*12)));const tu=top(u),tw=top(w),cut10=LOG.filter(m=>Date.now()-m.ts<6e5).length;
p.textContent='Messages seen: '+LOG.length+'  ·  last 10 min: '+cut10+'\nTop talkers\n'+(tu.map(([n,c])=>n.slice(0,12).padEnd(13)+bar(c,tu[0][1])+' '+c).join('\n')||'—')+'\n\nTop words\n'+(tw.map(([n,c])=>n.slice(0,12).padEnd(13)+bar(c,tw[0][1])+' '+c).join('\n')||'—')};f();return h('div',{},btn('Refresh stats',f),p)};
const diag=()=>{const dp=h('div',{className:'vp'});return live(dp,()=>{dp.textContent=['Connection: '+($onlineDot.classList.contains('offline')?'offline':'connected'),'You: '+myName+' ('+myRoleId()+')','Online: '+$onlineCount.textContent,'Messages on screen: '+$messages.querySelectorAll('.msg').length,'Seen / sent this session: '+ST.seen+' / '+ST.sent,'Server clock offset: '+Math.round(ChatBackend._offsetCache||0)+' ms','Session length: '+Math.round((Date.now()-ST.t0)/60000)+' min'].join('\n')},1000)};
const find=q=>{q=q.toLowerCase();$messages.querySelectorAll('.msg:not(.system)').forEach(e=>e.classList.toggle('vm-nf',!!q&&!((e.dataset.vmRaw||'')+' '+(e.dataset.vmName||'')).toLowerCase().includes(q)))};
const exp=f=>{const d=new Date().toISOString().slice(0,10);
if(f==='txt')dl('vus-chat-'+d+'.txt',LOG.map(m=>`[${new Date(m.ts).toLocaleString()}] ${m.n}: ${m.t}`).join('\n'),'text/plain');
if(f==='json')dl('vus-chat-'+d+'.json',JSON.stringify(LOG,null,2),'application/json');
if(f==='csv')dl('vus-chat-'+d+'.csv','time,name,text\n'+LOG.map(m=>[new Date(m.ts).toISOString(),m.n,m.t].map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\n'),'text/csv');
if(f==='html')dl('vus-chat-'+d+'.html','<meta charset=utf-8><body style="background:#0f172a;color:#f1f5f9;font:16px Arial;max-width:700px;margin:auto">'+LOG.map(m=>`<p><b>${esc(m.n)}</b> <small style="color:#64748b">${new Date(m.ts).toLocaleString()}</small><br>${esc(m.t)}</p>`).join(''),'text/html')};
const hold=()=>{ST.hold=!ST.hold;if(!ST.hold){document.querySelectorAll('.vm-held').forEach(e=>e.classList.remove('vm-held'));toast(ST.held+' new message(s) released');ST.held=0;$messages.scrollTop=$messages.scrollHeight}else toast('Feed frozen — new messages are held back')};

/* ───────── local command console (;help) ───────── */
const LC={},OUT=[];
const sayO=s=>{OUT.push(s);if(OUT.length>80)OUT.shift()};
const nm=a=>(a[0]||'').toLowerCase();
const TG=k=>{set(k,!S[k]);return k+': '+(S[k]?'on':'off')};
Object.assign(LC,{
help:()=>'Local commands (type ;name in chat or here):\n'+Object.keys(LC).concat(Object.keys(S.alias)).join('  '),
clear:()=>{document.querySelectorAll('.msg').forEach(e=>{e.dataset.vmH='1';style1(e)});return'Cleared YOUR view only.'},
unclear:()=>{document.querySelectorAll('.msg').forEach(e=>{delete e.dataset.vmH;style1(e)});return'View restored.'},
theme:a=>{const k=Object.keys(THEMES).find(x=>x.toLowerCase()===nm(a));if(!k)return'Themes: '+Object.keys(THEMES).join(', ');set('theme',k);return'Theme: '+k},
accent:a=>{set('ac',a[0]||'');return'Accent: '+(a[0]||'auto')},font:a=>{set('fs',+a[0]||20);return'Font size set'},zoom:a=>{set('zoom',+a[0]||1);return'Zoom set'},
mute:a=>{if(!a[0])return'Use mute name';if(!S.muted.includes(nm(a)))tog('muted',nm(a));return'Muted '+a[0]},unmute:a=>{if(S.muted.includes(nm(a)))tog('muted',nm(a));return'Unmuted '+a[0]},
friend:a=>{tog('fr',nm(a));return'Toggled friend '+a[0]},nick:a=>{const k=nm(a);a.length>1?S.nick[k]=a.slice(1).join(' '):delete S.nick[k];save();refresh();return'Nickname updated'},
roll:a=>{const m=(a[0]||'1d6').match(/^(\d{1,2})d(\d{1,4})$/);if(!m)return'Use roll 2d20';let t=0,r=[];for(let i=0;i<+m[1];i++){const x=1+Math.floor(Math.random()*+m[2]);r.push(x);t+=x}return'🎲 '+a[0]+': '+r.join(' + ')+' = '+t},
flip:()=>'🪙 '+(Math.random()<.5?'Heads':'Tails'),time:()=>new Date().toString(),uptime:()=>Math.round((Date.now()-ST.t0)/60000)+' min this session',
who:()=>(latestPresenceList||[]).map(e=>e.name).join(', ')||'Nobody',whoami:()=>{const s=curSession();return s?('Account: '+s.username+' (#'+s.id+')  ·  Chat name: '+(myName||'—')):'Not logged in'},signout:()=>{try{clearSavedAccount()}catch(e){}return'Signed out of this browser'},away:a=>{set('away',!S.away);if(a.length)set('awayMsg',a.join(' '));return'Away mode: '+(S.away?'on':'off')},count:()=>ST.seen+' messages seen, '+ST.sent+' sent',last:()=>{const l=LOG[LOG.length-1];if(l)copy(l.t);return l?'Copied last message':'None yet'},
find:a=>{find(a.join(' '));return a.length?'Filtering: '+a.join(' '):'Filter cleared'},export:a=>{exp(nm(a)||'txt');return'Exporting…'},
top:()=>{$messages.scrollTop=0;return'↑'},bottom:()=>{$messages.scrollTop=$messages.scrollHeight;return'↓'},hold:()=>{hold();return ST.hold?'Feed frozen':'Released'},
zen:()=>TG('zen'),dnd:()=>TG('dnd'),tts:()=>TG('tts'),compact:()=>TG('cp'),panic:()=>{document.documentElement.classList.toggle('vm-panic');return'Toggled (Alt+H brings it back)'},
sound:()=>{beep();return'🔔'},pins:()=>S.pins.map(p=>p.n+': '+p.t).join('\n')||'No pins',
alias:a=>{if(!a[0])return Object.entries(S.alias).map(([k,v])=>k+' → '+v).join('\n')||'Use alias name text…';if(a.length<2){delete S.alias[nm(a)];save();return'Alias removed'}S.alias[nm(a)]=a.slice(1).join(' ');save();return'Alias ;'+nm(a)+' saved'}});
const isLocal=v=>{const m=v.match(/^;(\w+)/);return !!m&&!!(LC[m[1].toLowerCase()]||S.alias[m[1].toLowerCase()])};
const runLocal=async line=>{const [c,...a]=line.trim().replace(/^;/,'').split(/\s+/),k=c.toLowerCase();if(LC[k])try{return await LC[k](a)}catch(e){return'⚠ '+e.message}if(S.alias[k]){ins(S.alias[k]);return'Inserted alias'}return'Unknown command. Try help'};
const consoleUI=()=>{const o=h('div',{className:'vp',style:'max-height:210px;overflow:auto'}),i=h('input',{className:'vi',placeholder:'help · theme dracula · roll 2d20 · who …'});
const draw=()=>{o.textContent=OUT.join('\n')||'Type help to see every command. In the chat box, start with ; (e.g. ;roll 1d20).';o.scrollTop=1e9};
const go=async c=>{const l=(c||i.value).trim();if(!l)return;i.value='';sayO('> '+l);sayO(String(await runLocal(l)));draw()};i.onkeydown=e=>e.key==='Enter'&&go();draw();
return h('div',{},i,btn('Run',()=>go()),['help','who','stats','time','roll 1d20','flip','unclear','zen'].map(c=>btn(c,()=>go(c))),o)};
/* ───────── staff panel: real app commands, rank-checked by the app itself ───────── */
const runCmd=t=>{$msgInput.value=t;$msgInput.dispatchEvent(new Event('input',{bubbles:true}));$sendBtn.click()};
const staff=()=>{const box=h('div');const r=()=>{const rank=myRank(),ro=ROLES[myRoleId()],names=(latestPresenceList||[]).map(e=>e.name).sort();
box.replaceChildren(h('div',{className:'vp'},'Your rank: '+ro.icon+' '+ro.label+'\nCommands run through the app, which checks your rank every time. Locked ones need a higher rank.'),
h('div',{},btn('👑 Owner Menu',()=>rank>=ROLES.crown.rank?openOwnerMenu():toast('Owner rank required')),btn('📜 Roster',()=>openRoster()),btn('📖 Rank guide',()=>openRankGuide()),btn('🔨 Bans & timeouts',()=>rank>=ROLES.admin.rank?openModListMenu():toast('Admin rank required')),btn('🔄 Refresh',r)),
...SLASH_COMMANDS.map(c=>{const ok=rank>=c.minRank,need=(Object.values(ROLES).find(x=>x.rank===c.minRank)||{}).label,a=h('input',{className:'vi',placeholder:c.args||'(no arguments)',disabled:!ok}),
sel=h('select',{className:'vi',disabled:!ok,onchange:()=>{if(sel.value){a.value=(a.value+' '+sel.value).trim();sel.value=''}}},h('option',{value:'',textContent:'＋ add online user…'}),names.map(n=>h('option',{textContent:n})));
return h('div',{className:'vcard'},h('div',{className:'vcn'},h('b',{textContent:c.name}),h('span',{className:ok?'vok':'vlock',textContent:ok?'✔ available':'🔒 '+need})),h('div',{className:'vn',textContent:commandDescription(c,rank)}),a,ok&&c.args?sel:'',btn(ok?'Run '+c.name:'Locked',()=>ok&&runCmd((c.name+' '+a.value).trim())))}))};r();return box};
/* ───────── away auto-reply (goes through the real send button — same cooldowns apply) ───────── */
const awayReplied=new Set();
const sendAwayReply=senderName=>{if(!S.away||!S.awayMsg||senderName===myName)return;if(awayReplied.has(senderName.toLowerCase()))return;awayReplied.add(senderName.toLowerCase());
const go=()=>{const old=$msgInput.value;$msgInput.value=S.awayMsg;$msgInput.dispatchEvent(new Event('input',{bubbles:true}));$sendBtn.click();setTimeout(()=>{if($msgInput.value===S.awayMsg)$msgInput.value=old;$msgInput.dispatchEvent(new Event('input',{bubbles:true}))},1200)};
const left=currentMessageCooldownMs()-(Date.now()-lastSentAt);left>0?setTimeout(go,left+200):go()};
/* ───────── duplicate-send guard ───────── */
let dupArmed=false,dupTimer=null;
const dupCheck=text=>{if(!S.dup||!text.trim())return true;if(S.hist[0]&&S.hist[0]===text.trim()&&!dupArmed){toast('You just sent that — press Send again within 5s to confirm');dupArmed=true;clearTimeout(dupTimer);dupTimer=setTimeout(()=>dupArmed=false,5000);return false}dupArmed=false;return true};

/* ───────── accounts (hooks the app's real DM account system — no bypass) ───────── */
const randPass=(n=14)=>{const a=crypto.getRandomValues(new Uint32Array(n));return[...a].map(x=>PW[x%PW.length]).join('')};
const randTempUser=()=>'SukisVusModUser_'+Array.from(crypto.getRandomValues(new Uint8Array(5))).map(b=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b%33]).join('');
const curSession=()=>{try{return loadDmSession()}catch(e){return null}};
const credBox=(u,p)=>{const b=h('div',{className:'vp'});const line=(lbl,val)=>h('div',{className:'vr'},lbl+': '+val,btn('Copy',()=>copy(val)));b.append(line('Username',u),line('Password',p),h('div',{className:'vn',textContent:'Copy these now — the password is never shown again.'}));return b};
const doJoin=async(session,nickname)=>{try{if(typeof ChatBackend!=='undefined'&&ChatBackend.releasePresenceSilently&&myLoginId)ChatBackend.releasePresenceSilently()}catch(e){}
try{await joinWithDmSession(session,nickname)}catch(e){toast('Logged in, but joining chat failed — try again from the chat screen.')}};
const acctCard=(title,body)=>h('div',{className:'vcard'},h('b',{textContent:title}),body);
const fakeUser=()=>{const box=h('div'),inp=h('input',{className:'vi',placeholder:'Any username (max 24 chars)',maxLength:24,value:S.fuName||''}),out=h('div',{className:'vn'});
const go=async name=>{const s=loadDmSession();if(!s){out.textContent='Log in first.';return}
name=(name||'').trim().slice(0,24);if(!name){out.textContent='Type a name first.';return}
try{if(hasHiddenChars(name)){out.textContent='That name has hidden characters.';return}
if(await ChatBackend.isNameTaken(name,s.id)){out.textContent='Someone online already has that name (or a lookalike).';return}}catch(e){}
S.fuName=name;save();out.textContent='Switching to "'+name+'"…';
try{logoutToNamePicker();await joinWithDmSession(s,name);out.textContent='You are now "'+name+'" in chat.'}catch(e){out.textContent='Failed: '+(e&&e.message||e)}};
box.append(h('div',{className:'vn',textContent:'Really changes your chat name: you leave and rejoin as this name, so everyone sees it in the online list and on new messages. Your account (ID, roles, items) stays the same. Names someone else is using right now are refused.'}),inp,
btn('🎭 Become this username',()=>go(inp.value)),
btn('↩ Back to my real username',()=>{const s=loadDmSession();if(s)go(s.username)}),out);return box};
const accountPanel=()=>{const box=h('div');
const status=h('div',{className:'vp'});const refreshStatus=()=>{const s=curSession();status.textContent=s?('Logged in as '+s.username+'  ·  ID #'+s.id+(myName?'  ·  chat name "'+myName+'"':'')):'Not logged in on this browser.'};refreshStatus();

const cu=h('input',{className:'vi',placeholder:'Username (3–24 letters, numbers, _)'}),cp=h('input',{className:'vi',type:'password',placeholder:'Password (min 4 chars)'}),cc=h('input',{className:'vi',type:'password',placeholder:'Confirm password'}),ce=h('div',{className:'vn'});
const create=acctCard('Create account',h('div',{},cu,cp,cc,ce,btn('Create & log in',async()=>{ce.textContent='Creating…';const r=await createAccountFromChat(cu.value,cp.value,cc.value);if(!r.ok){ce.textContent=r.error;return}
ce.textContent='Created — logging in…';const session={accountKey:r.accountKey,username:r.username,id:r.id};saveDmSession(session);await doJoin(session,r.username);refreshStatus();ce.textContent='';toast('Welcome, '+r.username+'!')})));

const tempOut=h('div');
const temp=acctCard('Temporary account',h('div',{},h('div',{className:'vn',textContent:'One click: random username + password, created and logged in automatically.'}),
btn('Create temp account',async()=>{const u=randTempUser(),p=randPass();tempOut.textContent='';tempOut.append(h('div',{className:'vn',textContent:'Creating '+u+'…'}));
const r=await createAccountFromChat(u,p,p);if(!r.ok){tempOut.textContent='';tempOut.append(h('div',{className:'vn',textContent:r.error}));return}
const session={accountKey:r.accountKey,username:r.username,id:r.id};saveDmSession(session);await doJoin(session,r.username);refreshStatus();
tempOut.textContent='';tempOut.append(credBox(r.username,p));toast('Temp account created & logged in')}),tempOut));

const lu=h('input',{className:'vi',placeholder:'Username or ID'}),lp=h('input',{className:'vi',type:'password',placeholder:'Password'}),le=h('div',{className:'vn'});
const login=acctCard('Log in to an existing account',h('div',{},lu,lp,le,btn('Log in',async()=>{le.textContent='Checking…';const r=await loginFromChat(lu.value,lp.value);if(!r.ok){le.textContent=r.error;return}
const session={accountKey:r.accountKey,username:r.username,id:r.id};saveDmSession(session);await doJoin(session,r.username);refreshStatus();le.textContent='';toast('Logged in as '+r.username)})));

const op=h('input',{className:'vi',type:'password',placeholder:'Current password'}),np=h('input',{className:'vi',type:'password',placeholder:'New password (min 4 chars)'}),nc=h('input',{className:'vi',type:'password',placeholder:'Confirm new password'}),pe=h('div',{className:'vn'});
const chpass=acctCard('Change password',h('div',{},op,np,nc,pe,btn('Update password',async()=>{const s=curSession();if(!s){pe.textContent='Log in first.';return}
if(!np.value||np.value.length<4){pe.textContent='New password must be at least 4 characters.';return}if(np.value!==nc.value){pe.textContent='New passwords do not match.';return}
pe.textContent='Checking current password…';const check=await loginFromChat(s.username,op.value);if(!check.ok){pe.textContent='Current password is wrong.';return}
let done=false;for(const db of[dmAuthDb,legacyDmAuthDb]){if(!db)continue;try{const snap=await db.ref('users/'+s.accountKey).get();if(snap.exists()){await db.ref('users/'+s.accountKey+'/password').set(await hashPassword(np.value));done=true;break}}catch(e){}}
pe.textContent=done?'Password updated.':'Could not find your account to update.';if(done){op.value=np.value=nc.value=''}})));

const nu=h('input',{className:'vi',placeholder:'New account username'}),ncp=h('input',{className:'vi',type:'password',placeholder:'Current password (to confirm)'}),ne=h('div',{className:'vn'});
const chuser=acctCard('Change account username',h('div',{},h('div',{className:'vn',textContent:'This is your login username, not your chat display name (use "Change name" for that).'}),nu,ncp,ne,
btn('Update username',async()=>{const s=curSession();if(!s){ne.textContent='Log in first.';return}
if(!/^[a-zA-Z0-9_]{3,24}$/.test(nu.value.trim())){ne.textContent='3–24 letters, numbers, or underscores.';return}
ne.textContent='Checking…';const check=await loginFromChat(s.username,ncp.value);if(!check.ok){ne.textContent='Current password is wrong.';return}
const newKey=nu.value.trim().toLowerCase();let done=false,target=null;
for(const db of[dmAuthDb,legacyDmAuthDb]){if(!db)continue;try{const snap=await db.ref('users/'+s.accountKey).get();if(snap.exists()){target=db;break}}catch(e){}}
if(!target){ne.textContent='Could not find your account.';return}
if((await target.ref('usernameIndex/'+newKey).get()).exists()){ne.textContent='That username is taken.';return}
const oldKey=s.username.toLowerCase();
await target.ref().update({['users/'+s.accountKey+'/username']:nu.value.trim(),['users/'+s.accountKey+'/usernameLower']:newKey,['usernameIndex/'+newKey]:s.accountKey,['usernameIndex/'+oldKey]:null});
saveDmSession({accountKey:s.accountKey,username:nu.value.trim(),id:s.id});refreshStatus();done=true;ne.textContent='Username updated.';nu.value=ncp.value=''})));

const signout=acctCard('Sign out of this browser',h('div',{},h('div',{className:'vn',textContent:'Forgets the saved account on this browser only. Does not kick you from the current chat session.'}),
btn('Sign out',()=>{try{clearSavedAccount()}catch(e){}refreshStatus();toast('Signed out of this browser.')})));

box.append(status,create,temp,login,chpass,chuser,signout);return box};

/* ───────── toolbox ───────── */
const MORSE='.- -... -.-. -.. . ..-. --. .... .. .--- -.- .-.. -- -. --- .--. --.- .-. ... - ..- ...- .-- -..- -.-- --..'.split(' '),PW='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
const OPS={'Upper case':s=>s.toUpperCase(),'Lower case':s=>s.toLowerCase(),'Title Case':s=>s.replace(/\w\S*/g,w=>w[0].toUpperCase()+w.slice(1).toLowerCase()),'Reverse text':TF.rev,
'Count chars / words / lines':s=>[...s].length+' chars · '+(s.match(/\S+/g)||[]).length+' words · '+s.split('\n').length+' lines','Clean extra spaces':s=>s.replace(/\s+/g,' ').trim(),'Sort lines':s=>s.split('\n').sort().join('\n'),'Unique lines':s=>[...new Set(s.split('\n'))].join('\n'),'Shuffle words':s=>s.split(/\s+/).sort(()=>Math.random()-.5).join(' '),
'Base64 encode':s=>btoa(unescape(encodeURIComponent(s))),'Base64 decode':s=>decodeURIComponent(escape(atob(s.trim()))),'URL encode':encodeURIComponent,'URL decode':decodeURIComponent,
'ROT13':s=>s.replace(/[a-z]/gi,c=>{const b=c<='Z'?65:97;return String.fromCharCode((c.charCodeAt(0)-b+13)%26+b)}),'To binary':s=>[...s].map(c=>c.charCodeAt(0).toString(2).padStart(8,'0')).join(' '),
'To Morse':s=>[...s.toLowerCase()].map(c=>c>='a'&&c<='z'?MORSE[c.charCodeAt(0)-97]:c===' '?'/':c).join(' '),
'SHA-256 hash':async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join(''),
'JSON format':s=>JSON.stringify(JSON.parse(s),null,2),'JSON minify':s=>JSON.stringify(JSON.parse(s)),'Unix → date':s=>new Date(+s*(s.length>11?1:1000)).toString(),'Date → Unix':s=>String(Math.floor(new Date(s)/1000)),
'Calculator':s=>{if(!/^[\d+\-*/().%\s^e]+$/.test(s))throw new Error('Numbers and + - * / ( ) % ^ only');return String(Function('"use strict";return ('+s.replace(/\^/g,'**')+')')())},
'Password (type length)':s=>{const n=Math.min(64,+s||16),a=crypto.getRandomValues(new Uint32Array(n));return[...a].map(x=>PW[x%PW.length]).join('')},'UUID':()=>crypto.randomUUID(),
'Hex color → RGB':s=>{const m=s.trim().replace('#','').match(/^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);if(!m)throw new Error('Use a 6-digit hex like #22c55e');return'rgb('+m.slice(1).map(x=>parseInt(x,16)).join(', ')+')'},
'Random hex color':()=>'#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0')};
const toolbox=()=>{const i=h('textarea',{rows:3,className:'vi',placeholder:'Input…'}),s=h('select',{className:'vi'},Object.keys(OPS).map(k=>h('option',{textContent:k}))),o=h('div',{className:'vp',textContent:'Output appears here'});
const run=async()=>{try{o.textContent=await OPS[s.value](i.value)}catch(e){o.textContent='⚠ '+(e&&e.message||'Invalid input')}};
return h('div',{},i,s,btn('Run',run),btn('Copy',()=>copy(o.textContent)),btn('Insert into message',()=>ins(o.textContent)),btn('Use my message text',()=>{i.value=$msgInput.value}),o)};
const stopwatch=()=>{let t0=0,el=0,laps=[];const d=h('div',{className:'vp',style:'font-size:22px;text-align:center'});const f=()=>{const ms=el+(t0?Date.now()-t0:0);d.textContent=new Date(ms).toISOString().slice(14,22)+(laps.length?'\n'+laps.map((l,i)=>'Lap '+(i+1)+' '+l).join('  '):'')};
return live(h('div',{},d,btn('Start / Stop',()=>{if(t0){el+=Date.now()-t0;t0=0}else t0=Date.now();f()}),btn('Lap',()=>{laps.push(d.textContent.slice(0,8));f()}),btn('Reset',()=>{t0=el=0;laps=[];f()})),f,200)};
const picker=()=>{const i=h('input',{className:'vi',placeholder:'Options, comma separated (pizza, tacos, sushi)'}),o=h('div',{className:'vp',textContent:'—'});
return h('div',{},i,btn('Pick one',()=>{const a=i.value.split(',').map(x=>x.trim()).filter(Boolean);o.textContent=a.length?a[Math.floor(Math.random()*a.length)]:'Add options first'}),btn('Insert',()=>ins('🎯 '+o.textContent+' ')),o)};
const quick=()=>h('div',{},btn('Copy room code',()=>currentRoomCode?copy(currentRoomCode):toast('Not in a private room')),btn('Copy online names',()=>copy((latestPresenceList||[]).map(e=>e.name).join(', '))),btn('Copy last 10 messages',()=>copy(LOG.slice(-10).map(m=>m.n+': '+m.t).join('\n'))),btn('Clear my view',()=>toast(LC.clear())),btn('Restore view',()=>toast(LC.unclear())));

/* ───────── fake perms + account protections ─────────
   far = Fake All Roles · fpp = Fake pic perms · nc = No cooldown · nb = Ban immunity · nt = Timeout immunity
   All client-side: they wrap the app's own functions in THIS browser only. */
const safe=f=>{try{f()}catch(e){}};
const FAKE_ROLES=()=>Object.values(ROLES).filter(r=>!r.implicit).sort((a,b)=>a.rank-b.rank);
const rfx={badge:()=>fakeSync(),pics:()=>safe(updateUploadButtonVisibility),tmo:()=>safe(watchMyTimeout),cd:()=>safe(updateSendButtonState)};
/* Fake All Roles: this browser adds YOUR account id to every role's holder list, so rank, the online list,
   the roster and message badges all agree. Real data is never written; turning it off removes only what was added. */
const INJ=new Map();
const inject=()=>{const id=myLoginId?String(myLoginId):'';
INJ.forEach((v,set)=>{if(!S.far||v!==id){set.delete(v);INJ.delete(set)}});
if(!S.far||!id)return;
FAKE_ROLES().forEach(r=>{const set=roleIdHolders[r.id]||(roleIdHolders[r.id]=new Set());if(!set.has(id)){set.add(id);INJ.set(set,id)}})};
const invIds=()=>Object.keys(typeof INVENTORY_ITEMS==='object'?INVENTORY_ITEMS:{protection:1});
const invFake=d=>{d=d||{};const id=myLoginId?String(myLoginId):'';if(!S.fin||!id)return d;const mine={...(d[id]||{})};invIds().forEach(k=>{if(!(Number(mine[k])>0))mine[k]=99});(S.xitems||[]).forEach(k=>{if(!(Number(mine[k])>0))mine[k]=99});return{...d,[id]:mine}};
let RAWINV={};const invSync=()=>safe(()=>{inventoryData=invFake(RAWINV);if($inventoryOverlay.style.display==='flex')renderInventory()});
const fakeSync=()=>safe(()=>{inject();rebuildRoleHolders();onMyRoleMaybeChanged();updateYouAre();if($onlineListPanel.style.display==='block')renderOnlineListPanel()});
const hooks=()=>{
const wrap=(n,f)=>{try{const o=window[n];if(typeof o==='function')window[n]=f(o);else console.warn('VUS Mod Menu: '+n+' not found')}catch(e){console.error('VUS Mod Menu hook failed: '+n,e)}};
const B=ChatBackend,bw=(k,f)=>{try{const o=B[k];if(typeof o==='function')B[k]=f(o);else console.warn('VUS Mod Menu: ChatBackend.'+k+' not found')}catch(e){console.error('VUS Mod Menu hook failed: '+k,e)}};
/* Fake All Roles: every role badge shows on YOUR name (your screen only) */
wrap('fillRoleBadge',o=>function(row){o.apply(this,arguments);if(!S.ar||!row.firstChild)return;
const id=loginIdForName(row.dataset.senderName);if(!id)return;const rs=FAKE_ROLES().filter(r=>holdsRoleId(r.id,id));if(rs.length<2)return;
const fk=S.far&&String(id)===String(myLoginId);row.replaceChildren(...rs.map(r=>h('div',{className:r.bubbleClass,textContent:r.icon,title:r.label+(fk?' (fake, only you see this)':'')})))});
wrap('updateYouAre',o=>function(){o.apply(this,arguments);if(!S.far||!myName)return;const e=$youAre.querySelector('.ya-role');if(e){e.textContent=FAKE_ROLES().map(r=>r.icon).join('')+' All roles';$youAre.title=myName+' (all roles, fake)'}});
/* Fake pic perms: image button + image sending always allowed on this browser */
wrap('canPostImages',o=>function(){return(S.fpp&&!!myLoginId)||o.apply(this,arguments)});
/* No cooldown: send delay (text + images), @ping cooldowns, mod re-timeout wait */
wrap('currentMessageCooldownMs',o=>function(){return S.nc?0:o.apply(this,arguments)});
wrap('currentImageCooldownMs',o=>function(){return S.nc?0:o.apply(this,arguments)});
wrap('getPingYouRemainingMs',o=>function(){return S.nc?0:o.apply(this,arguments)});
bw('tryStartAtPingCooldown',o=>function(){return S.nc?Promise.resolve({ok:true,remainingMs:0}):o.apply(this,arguments)});
bw('getModRetimeoutRemainingMs',o=>function(){return S.nc?Promise.resolve(0):o.apply(this,arguments)});
/* Ban + timeout immunity: this browser never sees (or obeys) a ban/timeout record on itself */
bw('getBan',o=>function(){return S.nb?Promise.resolve(null):o.apply(this,arguments)});
bw('watchBan',o=>function(id,cb){return o.call(this,id,b=>cb(S.nb?null:b))});
bw('watchTimeout',o=>function(id,cb){return o.call(this,id,ms=>cb(S.nt?0:ms))});
wrap('rebuildRoleHolders',o=>function(){inject();return o.apply(this,arguments)});
/* Unlock all items (fake): your inventory shows every known item x99 on THIS browser only; the database is untouched */
bw('watchInventory',o=>function(cb){return o.call(this,d=>{RAWINV=d||{};cb(invFake(RAWINV))})});
wrap('renderInventory',o=>function(){safe(()=>{inventoryData=invFake(RAWINV)});return o.apply(this,arguments)});
/* Stay in when chat is closed (this browser ignores the close signal) */
bw('watchChatClosed',o=>function(cb){return o.call(this,c=>cb(S.kc?false:c))});
let lastId='';setInterval(()=>{const id=myLoginId?String(myLoginId):'';if(id!==lastId){lastId=id;fakeSync();invSync()}},800);
fakeSync();rfx.pics();rfx.tmo();rfx.cd()};

/* ───────── owner panel (REAL: writes roleIds/crown in the database) ─────────
   Shows controls if the database says YOUR account really holds Owner, or your account username is on OWNER_USERS. Fake All Roles does not count. */
const OWNER_USERS=['45bawo','aniitsuki'];
const nameAllowed=()=>{try{const s=loadDmSession();return!!s&&OWNER_USERS.includes(String(s.username||'').trim().toLowerCase())}catch(e){return false}};
const realOwner=async()=>{if(nameAllowed())return true;try{const id=myLoginId&&String(myLoginId);if(!id)return false;const sn=await ChatBackend._roleIdRefs.crown.child(ChatBackend._pid(id)).get();return sn.exists()}catch(e){return false}};
const ownerPanel=()=>{const box=h('div'),msg=h('div',{className:'vn'}),list=h('div'),inp=h('input',{className:'vi',placeholder:'Username (online now) or 6-digit login ID'});
const roleOpts=Object.values(ROLES).filter(r=>!r.implicit).sort((a,b)=>b.rank-a.rank);
const sel=h('select',{className:'vi'},roleOpts.map(r=>h('option',{value:r.id,textContent:r.icon+' '+r.label})));
const resolve=v=>{v=(v||'').trim();if(!v)return null;return /^\d{6}$/.test(v)?v:loginIdForName(v)};
const label=id=>{const p=(latestPresenceList||[]).find(e=>String(e.loginId||'')===String(id));return(p?p.name+' · ':'')+'ID #'+id};
const denied=(e,rid)=>{const r=ROLES[rid];return(/permission[_ ]denied/i.test(String((e&&(e.code||e.message))||''))&&(rid==='crown'||rid==='coowner'))?'Your database rules block '+r.label+' from the browser. Add it by hand in the Firebase console: roleIds/'+rid+'/<6-digit ID> = true (or loosen the rules for that path).':'Refused: '+(e&&e.message||'no permission')};
const draw=async()=>{if(!(await realOwner())){box.replaceChildren(h('div',{className:'vn',textContent:'Owner only. Your account does not hold the Owner role in the database (Fake All Roles does not count).'}));return}
const rid=sel.value||roleOpts[0].id;let holders=[];try{const sn=await ChatBackend._roleIdRefs[rid].get();holders=Object.keys(sn.val()||{})}catch(e){}
list.replaceChildren(...(holders.length?holders:[]).map(id=>h('div',{className:'vr'},h('span',{className:'vl'},h('b',{textContent:label(id)+(String(id)===String(myLoginId)?' (you)':'')})),
(rid==='crown'&&String(id)===String(myLoginId))?h('span',{className:'vst',textContent:'👑'}):btn('Remove',async()=>{if(!confirm('Remove '+ROLES[rid].label+' from #'+id+'?'))return;try{await ChatBackend.removeRoleFromId(rid,id);msg.textContent='Removed '+ROLES[rid].label+' from #'+id}catch(e){msg.textContent=denied(e,rid)}draw()}))));
if(!holders.length)list.replaceChildren(h('div',{className:'vn',textContent:'Nobody holds this role.'}));
heading.textContent='Current '+ROLES[rid].label+'s'};
const heading=h('div',{className:'vh2'});
sel.onchange=()=>{msg.textContent='';draw()};
box.append(h('div',{className:'vn',textContent:'Real: writes to the database. Pick a role, then add or remove people. Owner/Co-owner may be blocked by your database rules (then the menu tells you the console path).'}),
h('div',{className:'vh2',textContent:'Role'}),sel,inp,
btn('➕ Give role',async()=>{const id=resolve(inp.value),rid=sel.value;if(!id){msg.textContent='Unknown user. They must be online by that name, or enter their 6-digit ID.';return}
if(!confirm('Give '+ROLES[rid].label+' to '+label(id)+'?'))return;try{await ChatBackend.grantRoleToId(rid,id);msg.textContent='Done: #'+id+' is now '+ROLES[rid].label+'.';inp.value=''}catch(e){msg.textContent=denied(e,rid)}draw()}),msg,heading,list);
const first=h('div');first.append(box);
(async()=>{if(!(await realOwner())){box.replaceChildren(h('div',{className:'vn',textContent:'Owner only. Your account does not hold the Owner role in the database (Fake All Roles does not count).'}));return}draw()})();
return first};

/* ───────── items ───────── */
const itemsPanel=()=>{const box=h('div'),nm=h('input',{className:'vi',placeholder:'Username or login ID (blank = me)'}),it=h('input',{className:'vi',placeholder:'Item id (e.g. protection)',value:'protection'}),q=h('input',{className:'vi',type:'number',value:'1',placeholder:'Quantity'});
const target=()=>{const v=nm.value.trim();if(!v)return myLoginId?String(myLoginId):null;return /^\d+$/.test(v)?v:loginIdForName(v)};
const write=async(id,item,n)=>ChatBackend._db.ref('inventory/'+id+'/'+item).set(n);
box.append(h('div',{className:'vn',textContent:'Fake = only this browser. Real = writes to the database, so everyone sees it (needs database permission).'}),
btn('🎁 Real: give myself every item',async()=>{const id=myLoginId&&String(myLoginId);if(!id)return toast('Join chat first');try{for(const k of invIds())await write(id,k,99);toast('Real items given to you');invSync()}catch(e){toast('Database refused: '+(e&&e.message||'no permission'))}}),
btn('🧹 Real: clear my items',async()=>{const id=myLoginId&&String(myLoginId);if(!id)return;if(!confirm('Remove all your items from the database?'))return;try{await ChatBackend._db.ref('inventory/'+id).remove();toast('Items cleared')}catch(e){toast('Database refused: '+(e&&e.message||'no permission'))}}),
h('div',{className:'vh2',textContent:'Grant / set a single item'}),nm,it,q,
btn('➕ Set item (real)',async()=>{const id=target();if(!id)return toast('Unknown user');const k=it.value.trim();if(!k)return toast('Item id?');try{await write(id,k,Math.max(0,Math.floor(+q.value||0)));toast('Set '+k+' ×'+q.value+' for #'+id)}catch(e){toast('Database refused: '+(e&&e.message||'no permission'))}}),
btn('👻 Add custom item (fake, me)',()=>{const k=it.value.trim();if(!k)return;S.xitems=[...new Set([...(S.xitems||[]),k])];save();S.fin=true;invSync();toast('Fake item added: '+k)}),
btn('♻ Forget custom fake items',()=>{S.xitems=[];save();toast('Cleared')}));
return box};

/* ───────── home dashboard ───────── */
const chatState=()=>{const box=h('div'),st=h('span',{className:'vst',textContent:'…'});
const chk=async()=>{try{const sn=await ChatBackend._chatStateRef.child('closed').get();const c=sn.val()===true;st.textContent=c?'CLOSED':'OPEN';st.style.background=c?'#f87171':'var(--vm-ac)';st.style.color='#05080f'}catch(e){st.textContent='?'}};
const act=async closed=>{try{await ChatBackend.setChatClosed(closed);toast(closed?'Chat closed for everyone':'Chat reopened');if(!closed&&!myName)safe(()=>autoLoginOrPrompt())}catch(e){toast('Could not change chat state: '+(e&&e.message||'check your connection'))}chk()};
box.append(h('div',{className:'vr'},h('span',{className:'vl'},h('b',{textContent:'Chat status'}),h('small',{textContent:'Open lets people join, closed removes everyone'})),st),
btn('🔓 Reopen Chat',()=>act(false),'Reopen VUS Chat for everyone'),btn('🔒 Close Chat',()=>{if(confirm('Close chat for everyone? All connected users will be removed.'))act(true)},'Close VUS Chat for everyone'));
return live(box,chk,4000)};
const TILES=[['far','👑','Fake All Roles','Every role on your account',()=>fakeSync()],['fpp','🖼️','Fake pic perms','Image upload always on',()=>rfx.pics()],['nc','⚡','No cooldown','No send or ping delay',()=>rfx.cd()],['nb','🛡️','Ban immunity','Ignore bans on you',()=>{}],['nt','⏱️','Timeout immunity','Never locked out',()=>rfx.tmo()],['fin','🎒','Unlock all items','Fake inventory (local)',()=>invSync()]];
const home=()=>{const box=h('div'),me=h('div',{className:'vhero'}),grid=h('div',{className:'vgrid'});
const tiles=TILES.map(([k,ic,t,sub,cb])=>{const st=h('span',{className:'vst'}),b=h('button',{className:'vtile',onclick:()=>{set(k,!S[k]);cb();upd()}},h('span',{className:'vti',textContent:ic}),h('span',{className:'vtt'},h('b',{textContent:t}),h('small',{textContent:sub})),st);grid.append(b);return[k,b,st]});
const upd=()=>{tiles.forEach(([k,b,st])=>{b.classList.toggle('on',!!S[k]);st.textContent=S[k]?'ON':'OFF'});
let r=null;try{r=ROLES[myRoleId()]}catch(e){}
me.replaceChildren(h('div',{className:'vav',textContent:(myName||'?').slice(0,1).toUpperCase()}),h('div',{className:'vwho'},h('b',{textContent:myName||'Not in chat yet'}),h('small',{textContent:(myLoginId?'ID #'+myLoginId+'  ·  ':'')+(S.far?FAKE_ROLES().map(x=>x.icon).join(' ')+' all roles (fake)':r?r.icon+' '+r.label:'')})))};
const sts=h('div',{className:'vgrid3'});const sb=(t)=>{const b=h('b'),sm=h('small',{textContent:t});sts.append(h('div',{className:'vsb'},b,sm));return b};const s1=sb('Online'),s2=sb('Messages seen'),s3=sb('Session');
const upd2=()=>{s1.textContent=($onlineCount.textContent||'').trim()||'0';s2.textContent=ST.seen;s3.textContent=Math.round((Date.now()-ST.t0)/60000)+'m'};
box.append(me,h('div',{className:'vh2',textContent:'Quick switches'}),grid,h('div',{className:'vh2',textContent:'This session'}),sts,h('div',{className:'vh2',textContent:'Good to know'}),
h('div',{className:'vn',textContent:'These switches only change what this browser shows and allows. The database and other people\'s screens stay as they are. Alt+M opens the menu, Alt+H hides it, Esc closes it.'}));
return live(box,()=>{upd();safe(upd2)},1500)};

/* ───────── tabs ───────── */
const SPEC={
Home:[['x',home]],
Chat:[['h','Scrolling & badges'],['t','fas','Fix Auto Scroll (jump to the newest message when one arrives)'],['t','own','Show my own username (instead of "You")',refresh],['t','ar','Show all roles on badges (everyone, not just their highest)',()=>safe(scheduleRoleBadgeRefresh)],['h','Display'],['t','hs','Hide join/leave messages'],['t','hb','Hide rank badges'],['t','ht','Hide name/time line'],['t','cp','Compact mode'],['t','gr','Group consecutive messages'],['t','lk','Clickable links'],['t','lb','Image lightbox (click to zoom)'],['t','bi','Blur images until hover'],['t','hi','Hide all images'],
['r','fs','Message font size',12,36],['r','ms','Name/time size',9,26],['r','mw','Max bubble width %',40,100],['r','gap','Message spacing',0,32],
['h','Find & filter'],['i','','Search messages / users',find],['i','kw','Highlight + alert keywords (comma separated)'],['i','cw','Censor words (comma separated)'],
['h','Navigate'],['b',[['⏫ Top',()=>$messages.scrollTop=0],['⏬ Bottom',()=>$messages.scrollTop=$messages.scrollHeight],['📍 Last mention',()=>{const a=document.querySelectorAll('.vm-me');a.length?a[a.length-1].scrollIntoView({block:'center'}):toast('No mentions yet')}],['❄ Freeze / release feed',hold]]],
['h','Pins (local)'],['x',()=>listNode('pins',p=>p.n+': '+p.t.slice(0,60),p=>copy(p.t),'Hover a message and press 📌.')],
['h','Export chat'],['b',[['TXT',()=>exp('txt')],['JSON',()=>exp('json')],['CSV',()=>exp('csv')],['HTML',()=>exp('html')],['Copy all',()=>copy(LOG.map(m=>m.n+': '+m.t).join('\n'))]]],['h','Stats'],['x',stats]],
Write:[['h','Send transform'],['s','tf','Style every message I send',Object.keys(TF)],['i','pre','Prefix (added to every message)'],['i','suf','Suffix (added to every message)'],['t','emo',':shortcodes: → emoji (:fire: :shrug: :tableflip: :lenny:)'],['t','cap','Auto-capitalize sentences'],['t','cs','Enter = new line, Ctrl+Enter = send'],['x',preview],['n','Up/Down arrows in an empty box recall your last messages. Output is always cut to 500 chars.'],
['h','Emoji'],['x',emojis],['h','Text styler'],['x',styler],['h','Quick replies'],['x',snippets],['h','Scheduled message'],['x',sched],['h','Random (inserts into your message)'],['x',dice]],
Look:[['h','Theme'],['s','theme','Preset',Object.keys(THEMES)],['c','ac','Accent color'],['s','bs','Bubble style',['round','square','pill','glass','outline','neon']],['s','font','Font',[['system-ui,Arial,sans-serif','System'],['Georgia,serif','Serif'],['ui-monospace,Consolas,monospace','Mono'],['"Comic Sans MS","Comic Neue",cursive','Comic'],['Verdana,sans-serif','Verdana']]],
['r','zoom','Page zoom',.7,1.5,.05],['t','zen','Zen mode (hide header, toolbar, typing bar)'],['t','an','Message pop-in animation'],['t','ag','Animated gradient background'],
['h','Background image'],['i','bg','Image URL (https://… or data:)'],['r','dim','Dim background',0,.9,.05],['h','Filters (message area)'],['r','br','Brightness %',40,140],['r','warm','Warm / night tint %',0,80],['h','Custom CSS'],['a','ccss','',6]],
Alerts:[['t','dnd','Do Not Disturb (silences everything here)'],['s','snd','Message sound',[['off','Off'],['mention','Mentions + keywords'],['all','Every new message']]],['s','st','Sound',['blip','chime','pop','bell']],['r','vol','Volume',0,100],['b',[['▶ Test sound',()=>beep()]]],['t','mp','Mute the built-in ping sound'],
['t','dn','Desktop notifications when tab is hidden',v=>{if(v&&window.Notification)Notification.requestPermission()}],['t','ut','Unread count in tab title'],['t','fv','Unread badge on favicon'],['t','fl','Flash screen on mention'],['t','vib','Vibrate on mention'],['t','tts','Read new messages aloud'],['t','ttsm','…only mentions/keywords'],['r','rate','Voice speed',.5,2,.1],
['h','Away mode'],['t','away','Auto-reply once per person while away'],['i','awayMsg','Away message'],
['h','Safety'],['t','dup','Warn before sending the same message twice']],
Staff:[['h','Chat'],['x',chatState],['t','kc','Stay in when chat is closed (ignore the close signal on this browser)'],['h','Fake perms (only you see these)'],['t','fin','Unlock all items (fake, on by default)',invSync],['t','far','Fake All Roles (every role badge on your name)',rfx.badge],['t','fpp','Fake pic perms (image button always on)',rfx.pics],['n','Cosmetic/local: they change what this browser shows and allows. The database and other people are not changed.'],['h','Owner (real)'],['x',ownerPanel],['h','Items'],['x',itemsPanel],['x',staff]],
Account:[['h','Fake username'],['x',fakeUser],['h','Account protections (this browser)'],['t','nc','No cooldown (send delay, images, @pings)',rfx.cd],['t','nb','Ban immunity (ignore ban records on you)'],['t','nt','Timeout immunity (ignore timeouts on you)',rfx.tmo],['n','Applies to whichever account is logged in here. Turning Ban immunity off takes effect the next time the app checks your ban (e.g. on rejoin).'],['x',accountPanel]],
Commands:[['h','Local command console'],['x',consoleUI],['n','Works in the chat box too: start a message with ; (e.g. ;theme nord). Your own aliases: ;alias hi Hello everyone → then ;hi. Anything else you type is sent as normal; real /commands are handled by the app.']],
People:[['n','Mute, nickname, highlight and ⭐ friends are local — only you see them. Friends trigger a toast when they join/leave.'],['x',people],['h','Muted'],['x',()=>listNode('muted',x=>'🔇 '+x+'  (click ✕ to unmute)',()=>{},'Nobody muted.')],['h','Friends'],['x',()=>listNode('fr',x=>'⭐ '+x,()=>{},'No friends starred.')]],
Tools:[['h','Toolbox'],['x',toolbox],['h','Stopwatch'],['x',stopwatch],['h','Random picker'],['x',picker],['h','Quick actions'],['x',quick],['h','Notepad'],['a','note','',6],['b',[['Copy',()=>copy(S.note)],['Insert into message',()=>ins(S.note)]]],['h','Timer'],['x',timer],['h','Diagnostics'],['x',diag],['b',[['Force reconnect',()=>{try{firebase.database().goOffline();setTimeout(()=>firebase.database().goOnline(),600);toast('Reconnecting…')}catch(e){}}],['Scroll chat to bottom',()=>$messages.scrollTop=$messages.scrollHeight]]]],
Menu:[['h','Window'],['r','op','Menu opacity %',40,100],['r','msc','Menu scale',.7,1.3,.05],['t','lock','Lock menu position'],['t','snap','Snap to screen edges'],['t','launch','Show 🧰 launcher button'],['t','open','Open menu on page load'],
['b',[['Reset position',()=>{S.pos=S.lpos=null;save();place0()}],['Minimize',()=>menu.classList.toggle('min')]]],['n','Hotkeys: Alt+M toggles the menu · Alt+H panic-hides menu and launcher · ; at the start of a chat message runs a local command (;help).'],
['h','Settings'],['b',[['Export settings',()=>dl('vus-mod-settings.json',JSON.stringify(S,null,2),'application/json')],['Reset everything',()=>{if(confirm('Reset all mod menu settings?')){localStorage.removeItem(LS);location.reload()}}]]],['x',upl]]};
let cur='Home';
const ICON={Home:'🏠',Chat:'💬',Write:'✍️',Look:'🎨',Alerts:'🔔',Staff:'🛡️',Commands:'⌨️',Account:'🔑',People:'👥',Tools:'🧰',Menu:'⚙️'};
const body=h('div',{className:'vbody'}),tabs=h('div',{className:'vtabs'}),srch=h('input',{className:'vsrch',placeholder:'🔎 Search all settings…',oninput:()=>show(cur)}),col=h('div',{className:'vcol'},srch,body),chip=h('small',{className:'vchip'}),ft=h('div',{className:'vft'});
const COLL=new Set();
const cards=rows=>{const out=[];let c=null;rows.forEach(r=>{if(r[0]==='h'){const key=cur+'|'+r[1];
c=h('section',{className:'vsec'+(COLL.has(key)?' closed':'')},h('div',{className:'vh',title:'Click to collapse',textContent:r[1],onclick:e=>{const sec=e.currentTarget.parentElement;sec.classList.toggle('closed');sec.classList.contains('closed')?COLL.add(key):COLL.delete(key)}}));out.push(c)}
else{if(!c||r[0]==='x'&&r[1]===home){c=h('section',{className:'vsec'});out.push(c)}let e;try{e=row(r)}catch(err){console.error('VUS Mod Menu: item failed',err);e=h('div',{className:'vn',textContent:'⚠ This item failed to load: '+(err&&err.message||err)})}c.append(e)}});return out};
const show=n=>{cur=n;[...tabs.children].forEach(b=>b.classList.toggle('on',b.dataset.n===n));const q=srch.value.trim().toLowerCase();
if(q){const rs=[];Object.keys(SPEC).forEach(k=>SPEC[k].forEach(r=>{if('trsci'.includes(r[0])){try{const e=row(r);if(e.textContent.toLowerCase().includes(q))rs.push(e)}catch(err){}}}));body.replaceChildren(...(rs.length?[h('section',{className:'vsec'},...rs)]:[h('div',{className:'vn',textContent:'No settings match.'})]))}else body.replaceChildren(...cards(SPEC[n]));body.scrollTop=0};

/* ───────── window + dragging ───────── */
const place=(el,x,y)=>{el.style.right=el.style.bottom='auto';el.style.left=Math.max(0,Math.min(innerWidth-50,x))+'px';el.style.top=Math.max(0,Math.min(innerHeight-40,y))+'px'};
const drag=(el,hd,key)=>{let sx,sy,ox,oy,on=0;hd.style.touchAction='none';hd.moved=0;
hd.addEventListener('pointerdown',e=>{if(e.target.closest('button')&&hd!==el)return;if(S.lock&&key==='pos')return;hd.setPointerCapture(e.pointerId);sx=e.clientX;sy=e.clientY;const r=el.getBoundingClientRect();ox=r.left;oy=r.top;on=1;hd.moved=0});
hd.addEventListener('pointermove',e=>{if(!on)return;const dx=e.clientX-sx,dy=e.clientY-sy;hd.moved=Math.max(hd.moved,Math.abs(dx)+Math.abs(dy));if(hd.moved>3)place(el,ox+dx,oy+dy)});
hd.addEventListener('pointerup',()=>{if(!on)return;on=0;if(hd.moved<=3)return;if(S.snap){const r=el.getBoundingClientRect();let x=r.left,y=r.top;if(x<40)x=8;if(innerWidth-r.right<40)x=innerWidth-r.width-8;if(y<40)y=8;if(innerHeight-r.bottom<40)y=innerHeight-r.height-8;place(el,x,y)}S[key]=[el.offsetLeft,el.offsetTop];save()})};
const place0=()=>{S.pos?place(menu,...S.pos):place(menu,innerWidth-420,70);S.lpos?place(launcher,...S.lpos):place(launcher,innerWidth-70,innerHeight-130)};
const toggle=v=>{menu.classList.toggle('on',v);S.open=menu.classList.contains('on');save()};

/* ───────── boot ───────── */
const build=()=>{
const hd=h('div',{className:'vhd'},h('span',{className:'vbrand'},h('span',{className:'vlogo',textContent:'🧰'}),'VUS Mod Menu',chip),h('span',{},h('button',{textContent:'—',title:'Minimize',onclick:()=>menu.classList.toggle('min')}),h('button',{textContent:'✕',title:'Close',onclick:()=>toggle(false)})));
menu=h('div',{id:'vm'},hd,h('div',{className:'vmain'},tabs,col),ft);launcher=h('button',{id:'vml',textContent:'🧰',title:'Mod menu (Alt+M)'});
Object.keys(SPEC).forEach(n=>{const b=h('button',{onclick:()=>{srch.value='';show(n)}},h('span',{textContent:ICON[n]||'•'}),n);b.dataset.n=n;tabs.append(b)});
document.body.append(menu,launcher);const fup=()=>{const on=['far','fpp','nc','nb','nt','fin'].filter(k=>S[k]).length;ft.replaceChildren(h('span',{textContent:'● '+on+'/6 switches on'}),h('span',{textContent:'Alt+M toggle · Alt+H hide · Esc close'}))};fup();setInterval(fup,1500);drag(menu,hd,'pos');drag(launcher,launcher,'lpos');
launcher.addEventListener('click',()=>{if(!launcher.moved)toggle()});
show(cur);place0();apply();if(S.open)menu.classList.add('on');
addEventListener('resize',()=>{place(menu,menu.offsetLeft,menu.offsetTop);place(launcher,launcher.offsetLeft,launcher.offsetTop)});
document.addEventListener('keydown',e=>{if(e.altKey&&e.code==='KeyM'){e.preventDefault();toggle()}if(e.key==='Escape'&&menu.classList.contains('on')&&!e.target.closest?.('.vlb')){toggle(false)}if(e.altKey&&e.code==='KeyH'){e.preventDefault();document.documentElement.classList.toggle('vm-panic')}});
/* message hooks */
new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>n.nodeType===1&&n.classList.contains('msg')&&proc(n)))).observe($messages,{childList:true});
$messages.querySelectorAll('.msg').forEach(proc);
$messages.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a');if(S.lb&&a&&a.querySelector('img')){e.preventDefault();const o=h('div',{className:'vlb',onclick:()=>o.remove()},h('img',{src:a.href}));document.body.append(o)}},true);
/* send hook: transforms text, then the app's own ChatBackend.send runs unchanged */
hooks();
/* Fix Auto Scroll: the app checks "near the bottom" AFTER the new message is added, so tall messages and late-loading
   images left you stranded. This remembers where you were BEFORE it arrived and keeps you at the newest message. */
let near=true;const dist=()=>$messages.scrollHeight-$messages.scrollTop-$messages.clientHeight;
$messages.addEventListener('scroll',()=>{near=dist()<400},{passive:true});
const toBottom=()=>{const go=()=>{$messages.scrollTop=$messages.scrollHeight};go();requestAnimationFrame(go);[120,400,1000].forEach(t=>setTimeout(go,t));safe(()=>{$jumpToBottomBtn.style.display='none'})};
new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType!==1||!n.classList.contains('msg')||!S.fas)return;
const keep=n.classList.contains('mine')||(typeof autoScroll==='undefined'||autoScroll)&&near;if(!keep)return;toBottom();
n.querySelectorAll('img').forEach(i=>i.complete||i.addEventListener('load',toBottom,{once:true}))}))).observe($messages,{childList:true});
const o=ChatBackend.send;ChatBackend.send=function(n,t,m,i){ST.sent++;S.hist=[t,...S.hist.filter(x=>x!==t)].slice(0,30);save();return o.call(this,n,tx(t),m,i)};
let hi=-1;$msgInput.addEventListener('keydown',e=>{
if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&isLocal($msgInput.value)){e.preventDefault();e.stopImmediatePropagation();const l=$msgInput.value;$msgInput.value='';$msgInput.dispatchEvent(new Event('input',{bubbles:true}));runLocal(l).then(r=>toast(String(r).slice(0,220)));return}
if(S.cs&&e.key==='Enter'){if(e.ctrlKey||e.metaKey){e.preventDefault();e.stopImmediatePropagation();$sendBtn.click()}else if(!e.shiftKey)e.stopImmediatePropagation();return}
if((e.key==='ArrowUp'||e.key==='ArrowDown')&&S.hist.length&&($msgInput.value===''||hi>=0)){e.preventDefault();hi=e.key==='ArrowUp'?Math.min(hi+1,S.hist.length-1):hi-1;$msgInput.value=hi<0?'':S.hist[hi];$msgInput.dispatchEvent(new Event('input',{bubbles:true}))}},true);
$msgInput.addEventListener('input',()=>{if($msgInput.value==='')hi=-1});
$sendBtn.addEventListener('click',e=>{if(!dupCheck($msgInput.value)){e.stopImmediatePropagation();return}if(isLocal($msgInput.value)){e.stopImmediatePropagation();const l=$msgInput.value;$msgInput.value='';$msgInput.dispatchEvent(new Event('input',{bubbles:true}));runLocal(l).then(r=>toast(String(r).slice(0,220)))}},true);
setInterval(()=>{try{const r=ROLES[myRoleId()];chip.textContent=(S.far?FAKE_ROLES().map(x=>x.icon).join(''):r?r.icon+' '+r.label:'')+' · '+$onlineCount.textContent.trim()}catch(e){}},2000);
/* friends watcher */
let prev=null;setInterval(()=>{if(typeof latestPresenceList==='undefined')return;const now=new Set(latestPresenceList.map(e=>e.name));if(prev){now.forEach(n=>!prev.has(n)&&S.fr.includes(n.toLowerCase())&&(toast('⭐ '+n+' came online'),!S.dnd&&beep('chime')));prev.forEach(n=>!now.has(n)&&S.fr.includes(n.toLowerCase())&&toast('⭐ '+n+' went offline'))}prev=now},3000);
window.VUSMod={settings:()=>S,open:()=>toggle(true),close:()=>toggle(false)};
};
try{build()}catch(err){console.error('VUS Mod Menu failed to start:',err)}
})();
