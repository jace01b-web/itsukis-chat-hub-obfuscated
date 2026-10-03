/* ==========================================================================
 * js/settings/account.js
 * Account modal (username change, banner, profile)
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

/* ---------- Account (username change) ---------- */
function openAccount(){
  ME=DB.currentUser();
  const wait=ME.lastNameChange+CFG.NAME_CHANGE_MS-Date.now();
  const can=wait<=0;
  const root=$('#modalRoot');
  let bannerChosen=safeColor(ME.settings&&ME.settings.bannerColor,safeColor(ME.settings&&ME.settings.meBubble,'#7c6cff'));
  root.innerHTML=`<div class="modal-bg"><div class="modal">
    <h2>👤 Account</h2>
    <div class="hint">User ID: <b>#${ME.id}</b> · Sign-in: ${ME.provider} ${ME.email?'· '+esc(ME.email):''}</div>
    <div class="section-h">Profile picture</div>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:4px">
      ${avatarHtml(ME,ME.username,'width:64px;height:64px;font-size:24px')}
      <div style="display:flex;flex-direction:column;gap:8px">
        <label class="file-btn" id="acAvLbl"><input type="file" id="acAvFile" accept="image/*"><span>📁 ${ME.settings.avatar?'Change picture':'Choose a picture'}</span></label>
        ${ME.settings.avatar?'<button class="btn sec small" id="acAvRemove">Remove picture</button>':''}
      </div>
    </div>
    <div class="err" id="acAvErr"></div>
    <div class="section-h">🎨 Profile banner</div>
    <div class="acc-banner-preview banner-anim" id="acBanner" style="background:${bannerGradCss(bannerChosen)}"></div>
    <div class="banner-swatches" id="acBannerSwatches">
      ${BANNER_PRESETS.map((c,i)=>`<button type="button" class="banner-swatch${c===bannerChosen?' sel':''}" data-c="${c}" style="background:${c};animation-delay:${(i*.03).toFixed(2)}s" title="${c}"><span class="bsw-check">✓</span></button>`).join('')}
    </div>
    <div class="banner-custom-row">
      <div class="field" style="flex:1;margin:0"><label>Custom color</label><input type="color" id="acBannerCustom" value="${bannerChosen}"></div>
      <button class="btn sec small" id="acBannerSave" style="margin-top:18px">Save banner</button>
    </div>
    <div class="err" id="acBannerErr"></div>
    <div class="section-h">🏷️ Pronouns</div>
    <div class="field" style="margin-bottom:8px"><label>Shown on your profile card (optional)</label><input id="acPron" maxlength="30" autocomplete="off" placeholder="e.g. she/her, he/him, they/them" value="${esc(ME.pronouns||'')}"></div>
    <div class="pron-chips" id="acPronChips">${['he/him','she/her','they/them','he/they','she/they','any pronouns','ask me'].map(p=>`<button type="button" data-p="${p}">${p}</button>`).join('')}</div>
    <div style="display:flex;gap:8px"><button class="btn sec small" id="acPronSave">Save pronouns</button><button class="btn sec small" id="acPronClear">Clear</button></div>
    <div class="err" id="acPronErr"></div>
    <div class="section-h">\u{1F4DD} Description</div>
    <div class="field" style="margin-bottom:0"><label>About you — shown on your profile card (optional)</label><textarea id="acDesc" maxlength="150" placeholder="Tell people a little about yourself...">${esc(ME.description||'')}</textarea></div>
    <div class="desc-count" id="acDescCount"></div>
    <div style="display:flex;gap:8px"><button class="btn sec small" id="acDescSave">Save description</button><button class="btn sec small" id="acDescClear">Clear</button></div>
    <div class="err" id="acDescErr"></div>
    <!-- TAG-VISIBILITY:START -->
    ${(()=>{const own=DB.tagsOwned(ME.id);if(!own.length)return'';const hid=DB.hiddenTagsOf(ME.id);
      const L={owner:['\u{1F531} Owner','Owner name styling, role and #ID tag'],mod:['\u{1F6E1}\uFE0F Mod','Mod tag on your profile card'],vip:['\u{1F48E} VIP','VIP name styling and role'],flair:['\u2728 Flair','Name color and little badge'],confetti:['\u{1F389} Confetti badge','Confetti Blast badge and role']};
      return `<div class="section-h">\u{1F3F7}\uFE0F Tags</div>
    <div class="hint" style="margin-bottom:8px">Hide a tag from everyone's view. You keep it and its permissions \u2014 just show it again any time.</div>
    <div class="tagvis" id="acTags">${own.map(t=>`<div class="tagvis-row${hid.includes(t)?' off':''}"><div><div class="tv-n">${L[t][0]}</div><div class="tv-s">${L[t][1]}</div></div><button class="btn sec small" data-tag="${t}">${hid.includes(t)?'Equip':'Unequip'}</button></div>`).join('')}</div>
    <div class="err" id="acTagErr"></div>`})()}
    <!-- TAG-VISIBILITY:END -->
    <div class="section-h">Change username</div>
    <div class="field"><label>New username (1-20 chars: 0-9 a-z A-Z . _ -)</label><input id="acName" maxlength="20" value="${esc(ME.username)}"></div>
    <div class="hint">${can?'You can change your username now (once every 7 days).':`Next change available in ${Math.ceil(wait/86400000)} day(s).`}</div>
    <div class="err" id="acErr"></div>
    <div class="actions"><button class="btn sec" id="acClose">Close</button><button class="btn" id="acSave">Save</button></div>
    ${ME.provider==='google'&&!DB.hasPasswordLogin()?`
    <div class="section-h">Sign in with a password too</div>
    <div class="hint">Add a password so you can also log in with your username instead of Google.</div>
    <div class="field" style="margin-top:10px"><label>New password</label><input id="acPw" type="password" autocomplete="new-password"></div>
    <div class="err" id="acPwErr"></div>
    <div class="actions"><button class="btn" id="acPwSave">Set Password</button></div>`:''}
    <div class="section-h">Session</div>
    <button class="btn sec" style="width:100%" id="acSignOut"><span style="margin-right:6px">🚪</span>Sign Out</button>
  </div></div>`;
  $('#acClose').onclick=()=>closeModalAnimated(root);
  $('#acSignOut').onclick=()=>doSignOut();
  $('#acAvFile').onchange=()=>{
    const f=$('#acAvFile').files[0];if(!f)return;
    $('#acAvErr').textContent='';
    if(!f.type.startsWith('image/')){$('#acAvErr').textContent='Only images are allowed.';return}
    openAvatarCropper(f);
  };
  if($('#acAvRemove'))$('#acAvRemove').onclick=async()=>{
    try{
      await DB.updateSettings(ME.id,{avatar:''});
      ME=DB.currentUser();
      openAccount();
    }catch(e){$('#acAvErr').textContent='Could not remove: '+(e.code||e.message)}
  };
  const acBanner=$('#acBanner'),acCustom=$('#acBannerCustom');
  const paintBanner=()=>{
    acBanner.style.background=bannerGradCss(bannerChosen);
    root.querySelectorAll('.banner-swatch').forEach(b=>b.classList.toggle('sel',b.dataset.c===bannerChosen));
  };
  root.querySelectorAll('.banner-swatch').forEach(b=>{
    b.onclick=()=>{bannerChosen=b.dataset.c;acCustom.value=bannerChosen;paintBanner()};
  });
  acCustom.addEventListener('input',()=>{bannerChosen=acCustom.value;paintBanner()});
  $('#acBannerSave').onclick=async()=>{
    const b=$('#acBannerSave');b.disabled=true;b.textContent='Saving...';$('#acBannerErr').textContent='';
    try{
      await DB.updateSettings(ME.id,{bannerColor:bannerChosen});
      ME=DB.currentUser();
      toast('Banner saved!');
      b.disabled=false;b.textContent='Save banner';
    }catch(e){b.disabled=false;b.textContent='Save banner';$('#acBannerErr').textContent='Could not save: '+(e.code||e.message)}
  };
  // TAG-VISIBILITY: equip / unequip
  if($('#acTags'))$('#acTags').onclick=async e=>{
    const b=e.target.closest('button[data-tag]');if(!b)return;
    const t=b.dataset.tag;let hid=DB.hiddenTagsOf(ME.id);
    hid=hid.includes(t)?hid.filter(x=>x!==t):hid.concat(t);
    b.disabled=true;$('#acTagErr').textContent='';
    try{
      await DB.updateSettings(ME.id,{hiddenTags:hid.join(',')});
      ME=DB.currentUser();
      toast(hid.includes(t)?'Tag hidden.':'Tag equipped.');
      if(typeof renderChat==='function')renderChat();
      openAccount();
    }catch(err){
      b.disabled=false;
      $('#acTagErr').textContent='Could not save: '+(err.code||err.message)+(/PERMISSION/i.test(err.code||err.message)?' \u2014 publish the updated database rules (hiddenTags).':'');
    }
  };
  // pronouns
  const acPron=$('#acPron');
  const paintPron=()=>root.querySelectorAll('#acPronChips button').forEach(b=>b.classList.toggle('on',b.dataset.p===acPron.value.trim().toLowerCase()));
  paintPron();
  acPron.addEventListener('input',paintPron);
  $('#acPronChips').onclick=e=>{const b=e.target.closest('button[data-p]');if(!b)return;acPron.value=b.dataset.p;paintPron()};
  const savePron=async(val,btn,label)=>{
    btn.disabled=true;btn.textContent='Saving...';$('#acPronErr').textContent='';
    try{
      await DB.updateSettings(ME.id,{pronouns:val});
      ME=DB.currentUser();
      acPron.value=ME.pronouns||'';paintPron();
      toast(ME.pronouns?'Pronouns saved!':'Pronouns cleared.');
    }catch(e){
      $('#acPronErr').textContent='Could not save: '+(e.code||e.message)+(/PERMISSION/i.test(e.code||e.message)?' — publish the updated database rules (pronouns).':'');
    }
    btn.disabled=false;btn.textContent=label;
  };
  $('#acPronSave').onclick=()=>savePron(acPron.value,$('#acPronSave'),'Save pronouns');
  $('#acPronClear').onclick=()=>{acPron.value='';savePron('',$('#acPronClear'),'Clear')};
  acPron.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();$('#acPronSave').click()}});
  // description
  const acDesc=$('#acDesc'),acDescCount=$('#acDescCount');
  const paintDesc=()=>{acDescCount.textContent=acDesc.value.length+'/150'};paintDesc();
  acDesc.addEventListener('input',paintDesc);
  const saveDesc=async(val,btn,label)=>{
    btn.disabled=true;btn.textContent='Saving...';$('#acDescErr').textContent='';
    try{
      await DB.updateSettings(ME.id,{description:val});
      ME=DB.currentUser();
      acDesc.value=ME.description||'';paintDesc();
      toast(ME.description?'Description saved!':'Description cleared.');
    }catch(e){
      $('#acDescErr').textContent='Could not save: '+(e.code||e.message)+(/PERMISSION/i.test(e.code||e.message)?' \u2014 publish the updated database rules (description).':'');
    }
    btn.disabled=false;btn.textContent=label;
  };
  $('#acDescSave').onclick=()=>saveDesc(acDesc.value,$('#acDescSave'),'Save description');
  $('#acDescClear').onclick=()=>{acDesc.value='';saveDesc('',$('#acDescClear'),'Clear')};
  enhanceColors(root);
  $('#acSave').onclick=async()=>{
    const b=$('#acSave');b.disabled=true;$('#acErr').textContent='';
    try{
      const nv=$('#acName').value.trim();
      const before=ME.username;
      await DB.renameUser(ME.id,nv);
      ME=DB.currentUser();
      if(ME.username===before){b.disabled=false;closeModalAnimated(root);return}
      $('#modalRoot').innerHTML=`<div class="modal-bg"><div class="modal" style="max-width:380px;text-align:center">
        <div style="font-size:42px;margin-bottom:6px">✅</div><h2>Username changed</h2>
        <div class="hint">You're now <b style="color:var(--text)">${esc(ME.username)}</b>. Refreshing in 1 second...</div></div></div>`;
      setTimeout(()=>location.reload(),1000);
    }catch(e){b.disabled=false;$('#acErr').textContent=e.message}
  };
  if($('#acPwSave'))$('#acPwSave').onclick=async()=>{
    try{
      await DB.setPassword($('#acPw').value);
      toast('Password set. You can now sign in with your username too.');
      closeModalAnimated(root);
    }catch(e){$('#acPwErr').textContent=e.message}
  };
}
