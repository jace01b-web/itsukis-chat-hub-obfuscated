/* ==========================================================================
 * js/settings/discord-settings.js
 * Discord's User Settings: the nav, and the panes the old settings page didn't have.
 *
 * The complaint this answers: "the settings aren't the same, profile settings aren't in
 * settings". They weren't - the profile editor was a separate modal you reached from the home
 * screen, and the settings nav was a short list of this site's own tabs (Messages, Background,
 * Theme, Pings, Music, Filter, About). Discord's is a long sectioned list, and your profile is
 * the second item in it.
 *
 * How this fits together: js/settings/settings-page.js owns the settings modal and already has a
 * generic tab mechanism (a <button data-t="x"> shows the <div data-p="x">). So this file supplies
 *   SET_NAV(me)        the whole nav column, in Discord's order and grouping
 *   SET_PANES(me,s)    the panes that didn't exist before
 *   wireDiscordSettings(root,me,s)   their event handlers
 * and settings-page.js calls all three. Existing panes keep their ids, so nothing that already
 * worked had to be rewritten - they are just relabelled and regrouped the way Discord does it.
 *
 * Loaded before settings-page.js (load order lives in js/manifest.js).
 * ========================================================================== */
'use strict';

/* ---------- icons (Discord's own, redrawn) ---------- */
const DSI={
  account:'<svg class="dl-si" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5c0-3-4-5.5-9-5.5Z"/></svg>',
  profile:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2.2"/><path d="M14 9h4M14 13h4M5.5 17c.8-1.7 2-2.5 3.5-2.5s2.7.8 3.5 2.5"/></svg>',
  shield:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/></svg>',
  friends:'<svg class="dl-si" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 4.5V20h14v-2.5C16 15 13 13 9 13Zm9-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm.5 2c-.5 0-1 .1-1.4.2A6.4 6.4 0 0 1 18 17.5V20h4v-2.5c0-2.4-1.6-4.5-3.5-4.5Z"/></svg>',
  gem:'<svg class="dl-si" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h10l4 6-9 12L3 9z"/></svg>',
  paint:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>',
  a11y:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="4.5" r="1.8"/><path d="M4.5 8.5h15M12 8.5v6m0 0-3 6m3-6 3 6"/></svg>',
  voice:'<svg class="dl-si" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>',
  text:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
  image:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/></svg>',
  bell:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>',
  keys:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9"/></svg>',
  globe:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15 0 18M12 3c-2.5 2.6-2.5 15 0 18"/></svg>',
  music:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
  info:'<svg class="dl-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>',
  game:'<svg class="dl-si" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 7h10a5 5 0 0 1 4.9 6l-.8 4A3 3 0 0 1 16 18.4L14.6 17H9.4L8 18.4A3 3 0 0 1 2.9 17l-.8-4A5 5 0 0 1 7 7Zm0 3v2H5v2h2v2h2v-2h2v-2H9v-2H7Zm9 1a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm2.4 2.6a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/></svg>'
};

/* Only old Google accounts can still be missing a password. hasPasswordLogin() reads the live
   Firebase user's providerData, which is undefined in a few states (signed out mid-render, the
   test harness, a session that hasn't settled), and it threw there - taking the whole settings
   page down with it. Treat anything it can't answer as "nothing to add". */
function dsNeedsPassword(me){
  try{return me.provider==='google'&&typeof DB.hasPasswordLogin==='function'&&!DB.hasPasswordLogin()}
  catch(_){return false}
}

function dsBtn(t,label,icon,extraCls){
  return '<button data-t="'+t+'"'+(extraCls?' class="'+extraCls+'"':'')+'>'+icon+'<i class="dl-e"></i>'+label+'</button>';
}
function dsHead(t){return '<div class="dl-set-h">'+t+'</div>'}
const DS_SEP='<div class="dl-set-sep"></div>';

/* ======================================================================
 *  THE NAV
 *  Discord's order and grouping, with this site's own extras folded into the group they
 *  belong to rather than bolted on the end.
 * ====================================================================== */
function SET_NAV(me){
  const staff=typeof isStaff==='function'&&isStaff(me.id);
  return [
    dsHead('User Settings'),
    dsBtn('account','My Account',DSI.account,'active'),
    dsBtn('profile','Profiles',DSI.profile),
    dsBtn('filter','Privacy &amp; Safety',DSI.shield),
    dsBtn('friends','Friend Requests',DSI.friends),
    DS_SEP,
    dsHead('Billing Settings'),
    dsBtn('nitro','Perks &amp; Shop',DSI.gem),
    DS_SEP,
    dsHead('App Settings'),
    dsBtn('ui','Appearance',DSI.paint),
    dsBtn('a11y','Accessibility',DSI.a11y),
    dsBtn('voice','Voice &amp; Video',DSI.voice),
    dsBtn('msg','Text &amp; Images',DSI.text),
    dsBtn('bg','Chat Background',DSI.image,'dl-hide'),
    dsBtn('ping','Notifications',DSI.bell),
    dsBtn('keys','Keybinds',DSI.keys),
    dsBtn('lang','Language',DSI.globe),
    dsBtn('music','Music',DSI.music),
    DS_SEP,
    dsHead('Itsukis Chat Hub'),
    dsBtn('about','Advanced',DSI.info),
    staff?DS_SEP+dsHead('Staff')+dsBtn('mod','Moderation',DSI.shield):''
  ].join('');
}

/* ======================================================================
 *  THE NEW PANES
 * ====================================================================== */
function SET_PANES(me,s){
  const wait=me.lastNameChange+CFG.NAME_CHANGE_MS-Date.now();
  const canRename=wait<=0;
  const bannerChosen=safeColor(me.settings&&me.settings.bannerColor,safeColor(me.settings&&me.settings.meBubble,'#5865f2'));
  const mvp=typeof hasMvpPerks==='function'&&hasMvpPerks(me.id);

  /* ---------- My Account ---------- */
  const account=`<div data-p="account">
    <div class="dl-acct-card">
      <div class="dl-acct-banner" style="background:${bannerBg(me,bannerChosen)}"></div>
      <div class="dl-acct-body">
        <div class="dl-acct-top">
          <span class="dl-acct-av">${avatarHtml(me,me.username,'width:80px;height:80px;font-size:30px')}</span>
          <div class="dl-acct-name"><b>${esc(displayUsername(me.username))}</b><small>#${me.id}</small></div>
          <button type="button" class="btn dl-acct-edit" id="saGoProfile">Edit User Profile</button>
        </div>
        <div class="dl-acct-fields">
          <div class="dl-acct-f"><span>Username</span><b>${esc(me.username)}</b><button type="button" class="btn sec small" id="saRenameOpen">Edit</button></div>
          <div class="dl-acct-f"><span>User ID</span><b>#${me.id}</b><button type="button" class="btn sec small" id="saCopyId">Copy</button></div>
          <div class="dl-acct-f"><span>Sign-in</span><b>${esc(me.provider||'password')}${me.email?' · '+esc(me.email):''}</b></div>
        </div>
      </div>
    </div>

    <div class="set-card" id="saRenameCard" style="display:none">
      <div class="section-h" style="margin-top:0">Change username</div>
      <div class="field"><label>New username (1-20 chars: 0-9 a-z A-Z . _ -)</label><input id="saName" maxlength="20" value="${esc(me.username)}"></div>
      <div class="hint">${canRename?'You can change your username now. After that it’s once every 7 days.':`Next change available in ${Math.ceil(wait/86400000)} day(s).`}</div>
      <div class="err" id="saNameErr"></div>
      <div class="actions" style="justify-content:flex-start"><button class="btn" id="saNameSave" ${canRename?'':'disabled'}>Save</button></div>
    </div>

    <div class="set-card">
      <div class="section-h" style="margin-top:0">Password and Authentication</div>
      ${dsNeedsPassword(me)
        ? `<div class="hint" style="margin-bottom:10px">Add a password so you can sign in with your username too.</div>
           <div class="field"><label>New password</label><input id="saPw" type="password" autocomplete="new-password"></div>
           <div class="err" id="saPwErr"></div>
           <div class="actions" style="justify-content:flex-start"><button class="btn" id="saPwSave">Set Password</button></div>`
        : `<div class="hint">Your account signs in with a username and a password. There is no email on file, so keep your password somewhere safe — there is no reset link to send.</div>`}
    </div>

    <div class="set-card">
      <div class="section-h" style="margin-top:0">Session</div>
      <button class="btn sec" style="width:100%" id="saSignOut"><span style="margin-right:6px">\u{1F6AA}</span>Sign Out</button>
    </div>
  </div>`;

  /* ---------- Profiles (the profile editor, now inside settings) ---------- */
  const tagSection=(()=>{
    let own=[];try{own=DB.tagsOwned(me.id)}catch(_){}
    if(!own.length)return '';
    let hid=[];try{hid=DB.hiddenTagsOf(me.id)}catch(_){}
    const L={owner:['\u{1F531} Owner','Owner name styling, role and #ID tag'],mod:['\u{1F6E1}️ Mod','Mod tag on your profile card'],
      mvp:['\u{1F3C6} MVP','MVP title, name effect and role (your perks stay)'],vip:['\u{1F48E} VIP','VIP name styling and role'],
      flair:['✨ Flair','Name color and little badge'],confetti:['\u{1F389} Confetti badge','Confetti Blast badge and role']};
    return `<div class="set-card">
      <div class="section-h" style="margin-top:0">\u{1F3F7}️ Tags</div>
      <div class="hint" style="margin-bottom:8px">Hide a tag from everyone's view. You keep it and its permissions — just show it again any time.</div>
      <div class="tagvis" id="spTags">${own.map(t=>`<div class="tagvis-row${hid.includes(t)?' off':''}"><div><div class="tv-n">${L[t]?L[t][0]:esc(t)}</div><div class="tv-s">${L[t]?L[t][1]:''}</div></div><button class="btn sec small" data-tag="${esc(t)}">${hid.includes(t)?'Equip':'Unequip'}</button></div>`).join('')}</div>
      <div class="err" id="spTagErr"></div>
    </div>`;
  })();

  const profile=`<div data-p="profile" class="hidden">
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Avatar</div>
      <div style="display:flex;align-items:center;gap:14px">
        ${avatarHtml(me,me.username,'width:80px;height:80px;font-size:30px')}
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="file-btn" id="spAvLbl"><input type="file" id="spAvFile" accept="image/*"><span>${me.settings.avatar?'Change Avatar':'Choose an Avatar'}</span></label>
          ${me.settings.avatar?'<button class="btn sec small" id="spAvRemove">Remove Avatar</button>':''}
        </div>
      </div>
      <div class="err" id="spAvErr"></div>
    </div>

    <div class="set-card">
      <div class="section-h" style="margin-top:0">Profile Banner</div>
      <div class="acc-banner-preview${bannerImgOf(me)?' banner-img':' banner-anim'}" id="spBanner" style="background:${bannerBg(me,bannerChosen)}"></div>
      <div class="banner-swatches" id="spBannerSwatches">
        ${BANNER_PRESETS.map((c,i)=>`<button type="button" class="banner-swatch${c===bannerChosen?' sel':''}" data-c="${c}" style="background:${c};animation-delay:${(i*.03).toFixed(2)}s" title="${c}"><span class="bsw-check">✓</span></button>`).join('')}
      </div>
      <div class="banner-custom-row">
        <div class="field" style="flex:1;margin:0"><label>Custom color</label><input type="color" id="spBannerCustom" value="${bannerChosen}"></div>
        <button class="btn sec small" id="spBannerSave" style="margin-top:18px">Save banner</button>
      </div>
      <div class="err" id="spBannerErr"></div>
      ${mvp?`<div class="mvp-bb">
        <div class="mvp-bb-h">\u{1F3C6} MVP image banner</div>
        <div class="hint" style="margin:2px 0 8px">Use a picture instead of a colour. It's cropped to a wide strip, so wide images work best.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <label class="file-btn" id="spBnLbl"><input type="file" id="spBnFile" accept="image/*"><span>\u{1F5BC}️ ${bannerImgOf(me)?'Change image banner':'Choose image banner'}</span></label>
          ${bannerImgOf(me)?'<button class="btn sec small" id="spBnRemove" type="button">Remove image</button>':''}
        </div>
        <div class="err" id="spBnErr"></div>
      </div>`:`<div class="mvp-bb locked"><div class="mvp-bb-h">\u{1F3C6} Image banners are an MVP perk</div><div class="hint" style="margin:2px 0 0">MVP is a 0.1% prize on the Daily Spin.</div></div>`}
    </div>

    <div class="set-card">
      <div class="section-h" style="margin-top:0">Pronouns</div>
      <div class="field" style="margin-bottom:8px"><label>Shown on your profile card (optional)</label><input id="spPron" maxlength="30" autocomplete="off" placeholder="e.g. she/her, he/him, they/them" value="${esc(me.pronouns||'')}"></div>
      <!-- data-pron, NOT data-p: the settings page shows a pane with
           querySelectorAll('[data-p]'), so chips carrying data-p get hidden along with the panes
           the moment you switch tabs. -->
      <div class="pron-chips" id="spPronChips">${['he/him','she/her','they/them','he/they','she/they','any pronouns','ask me'].map(p=>`<button type="button" data-pron="${p}">${p}</button>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn sec small" id="spPronSave">Save pronouns</button><button class="btn sec small" id="spPronClear">Clear</button></div>
      <div class="err" id="spPronErr"></div>
    </div>

    <div class="set-card">
      <div class="section-h" style="margin-top:0">About Me</div>
      <div class="field" style="margin-bottom:0"><label>Shown on your profile card (optional)</label><textarea id="spDesc" maxlength="${descMaxFor(me.id)}" placeholder="Tell people a little about yourself...">${esc(me.description||'')}</textarea></div>
      <div class="desc-count" id="spDescCount"></div>
      ${mvp?'':`<div class="hint" style="margin-top:2px">\u{1F3C6} MVPs get ${CFG.MVP_DESC_MAX} characters.</div>`}
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn sec small" id="spDescSave">Save</button><button class="btn sec small" id="spDescClear">Clear</button></div>
      <div class="err" id="spDescErr"></div>
    </div>

    <div class="set-card dl-hide">
      <div class="section-h" style="margin-top:0">Your message colour (public)</div>
      <div class="set-grid">
        <div class="field"><label>Bubble colour</label><input type="color" id="spMe" value="${s.meBubble}"></div>
        <div class="field"><label>Text colour</label><input type="color" id="spMeT" value="${s.meText}"></div>
      </div>
    </div>

    ${tagSection}
  </div>`;

  /* ---------- Friend Requests ---------- */
  const friends=`<div data-p="friends" class="hidden">
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Who can add you as a friend</div>
      <div class="hint" style="margin-bottom:10px">Anyone on Itsukis Chat Hub can send you a friend request by username. Requests wait in Friends → Pending until you accept or decline them — nobody is added automatically.</div>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn sec" id="sfOpenFriends">Open Friends</button>
      </div>
    </div>
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Blocked Users</div>
      <div id="sfBlocked"></div>
    </div>
  </div>`;

  /* ---------- Perks & Shop ---------- */
  const nitro=`<div data-p="nitro" class="hidden">
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Your perks</div>
      <div id="snTier" class="hint">Checking…</div>
      <div class="actions" style="justify-content:flex-start;margin-top:10px">
        <button class="btn" id="snShop">Open the Shop</button>
        <button class="btn sec" id="snSpin">Daily Spin</button>
      </div>
    </div>
    <div class="set-card">
      <div class="section-h" style="margin-top:0">What each tier gives you</div>
      <div class="hint">VIP is $10 one-off and MVP is $30 and permanent. VIP and MVP both unlock their lounge channel, a name effect and a bigger profile. MVP also gets image banners, a longer About Me, longer messages and ${CFG.MVP_SPINS_PER_DAY} Daily Spins a day. Neither tier gives any moderation power.</div>
    </div>
  </div>`;

  /* ---------- Accessibility ---------- */
  const a11y=`<div data-p="a11y" class="hidden">
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Motion</div>
      <div class="toggle-row">
        <div>
          <div style="font-weight:600;font-size:14px">Reduce motion</div>
          <div class="hint" style="margin-top:2px">Turns off the animations, glows and looping effects across the whole site. Your device's own "reduce motion" setting is honoured automatically as well.</div>
        </div>
        <label class="switch"><input type="checkbox" id="saReduce"><span class="slider"></span></label>
      </div>
    </div>
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Performance</div>
      <div class="toggle-row" style="margin-bottom:0">
        <div>
          <div style="font-weight:600;font-size:14px">Anti-lag mode</div>
          <div class="hint" style="margin-top:2px">Draws far less: no blur, glow or shimmer, and solid panels. Everything still works. Saved to your account, so it follows you to every device.</div>
        </div>
        <label class="switch"><input type="checkbox" id="saAntiLag2" ${AntiLag.on()?'checked':''}><span class="slider"></span></label>
      </div>
    </div>
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Text size</div>
      <div class="field" style="margin-bottom:0"><label>Chat text size <span class="val" id="saSizeV"></span></label><input type="range" id="saSize" min="11" max="24" value="${s.size}"></div>
      <div class="hint">The same slider as Text &amp; Images — it's here too because this is where people look for it.</div>
    </div>
  </div>`;

  /* ---------- Voice & Video ---------- */
  const voice=`<div data-p="voice" class="hidden">
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Input Device</div>
      <div class="field"><label>Microphone</label><select id="svMic"><option value="">Default</option></select></div>
      <div class="hint" id="svMicHint">Your browser only lists microphones after you've allowed one. Press "Let me hear myself" and allow the prompt.</div>
    </div>
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Mic Test</div>
      <div class="hint" style="margin-bottom:10px">Checks the microphone without joining a channel — nothing is sent anywhere and it uses no voice minutes.</div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button class="btn sec" id="svTest">Let me hear myself</button>
        <div class="sv-meter" id="svMeter"><i></i></div>
      </div>
      <div class="err" id="svErr"></div>
    </div>
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Voice Minutes</div>
      <div class="hint" id="svUsage">Voice runs on Agora's free tier, which is billed per person per minute of connected audio.
      To make that last, a voice channel doesn't open an audio connection at all until a second person is in it — so sitting in an empty channel is free. The connection also closes again when you're the last one left, and after ${Math.round((window.VC_CONFIG&&window.VC_CONFIG.HIDDEN_MS||300000)/60000)} minutes with the tab in the background.</div>
    </div>
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Troubleshooting</div>
      <div class="hint" style="margin-bottom:10px">Voice needs UDP/WebRTC. Ad-blockers, VPNs and school networks are what usually break it.</div>
      <div class="actions" style="justify-content:flex-start"><button class="btn sec" id="svDiag">Run connection test</button></div>
      <pre class="vc-test" id="svDiagOut" style="display:none"></pre>
    </div>
  </div>`;

  /* ---------- Keybinds ---------- */
  const KEYS=[
    ['Enter','Send the message'],
    ['Shift + Enter','New line'],
    ['Esc','Close the dialog, menu or panel in front of you'],
    ['M','Mute yourself (while you’re in a voice channel)'],
    ['D','Deafen yourself (while you’re in a voice channel)'],
    ['@','Start a mention'],
    ['Up arrow','Edit your last message'],
    ['Ctrl/⌘ + K','Jump to a channel or DM'],
    ['Ctrl/⌘ + F','Search this channel']
  ];
  const keys=`<div data-p="keys" class="hidden">
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Keybinds</div>
      <div class="hint" style="margin-bottom:10px">These are fixed for now — they can't be rebound yet.</div>
      <div class="dl-keys">${KEYS.map(k=>`<div class="dl-key"><span class="dl-key-k">${esc(k[0])}</span><span class="dl-key-d">${esc(k[1])}</span></div>`).join('')}</div>
    </div>
  </div>`;

  /* ---------- Language ---------- */
  const lang=`<div data-p="lang" class="hidden">
    <div class="set-card">
      <div class="section-h" style="margin-top:0">Language</div>
      <div class="hint" style="margin-bottom:10px">Itsukis Chat Hub is only available in English at the moment. Dates and times already follow your device's own region settings.</div>
      <div class="dl-langs">
        <button type="button" class="dl-lang active"><b>English</b><small>English, UK/US</small><span class="dl-lang-tick">✓</span></button>
      </div>
      <div class="hint" style="margin-top:10px">Your device is set to <b>${esc((navigator.language||'en').toString())}</b>.</div>
    </div>
  </div>`;

  return account+profile+friends+nitro+a11y+voice+keys+lang;
}

/* ======================================================================
 *  WIRING
 *  `reopen` re-renders the whole settings modal on the same tab, which is how the panes that
 *  change their own markup (a new avatar, a removed banner) refresh themselves.
 * ====================================================================== */
function wireDiscordSettings(root,me,s,reopen){
  const q=id=>root.querySelector(id);
  const go=t=>{const b=root.querySelector('#sTabs button[data-t="'+t+'"]');if(b)b.click()};

  wireMobileSettingsNav(root);

  /* ---------- My Account ---------- */
  if(q('#saGoProfile'))q('#saGoProfile').onclick=()=>go('profile');
  if(q('#saRenameOpen'))q('#saRenameOpen').onclick=()=>{
    const c=q('#saRenameCard');if(!c)return;
    c.style.display=c.style.display==='none'?'':'none';
    if(c.style.display==='')q('#saName').focus();
  };
  if(q('#saCopyId'))q('#saCopyId').onclick=()=>{
    const b=q('#saCopyId');
    try{navigator.clipboard.writeText(String(me.id)).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1400)},()=>toast('Couldn’t copy.','bad'))}
    catch(_){toast('Couldn’t copy.','bad')}
  };
  if(q('#saNameSave'))q('#saNameSave').onclick=async()=>{
    const b=q('#saNameSave');b.disabled=true;q('#saNameErr').textContent='';
    try{
      const before=me.username;
      await DB.renameUser(me.id,q('#saName').value.trim());
      ME=DB.currentUser();
      if(ME.username===before){b.disabled=false;return}
      toast('Username changed. Reloading…');
      setTimeout(()=>location.reload(),900);
    }catch(e){b.disabled=false;q('#saNameErr').textContent=e.message}
  };
  if(q('#saPwSave'))q('#saPwSave').onclick=async()=>{
    try{await DB.setPassword(q('#saPw').value);toast('Password set.')}
    catch(e){q('#saPwErr').textContent=e.message}
  };
  if(q('#saSignOut'))q('#saSignOut').onclick=()=>doSignOut();

  /* ---------- Profiles ---------- */
  if(q('#spAvFile'))q('#spAvFile').onchange=()=>{
    const f=q('#spAvFile').files[0];if(!f)return;
    q('#spAvErr').textContent='';
    if(!f.type.startsWith('image/')){q('#spAvErr').textContent='Only images are allowed.';return}
    openAvatarCropper(f);
  };
  if(q('#spAvRemove'))q('#spAvRemove').onclick=async()=>{
    try{await DB.updateSettings(me.id,{avatar:''});ME=DB.currentUser();reopen('profile')}
    catch(e){q('#spAvErr').textContent='Could not remove: '+(e.code||e.message)}
  };
  const bnEl=q('#spBanner'),bnCustom=q('#spBannerCustom');
  if(bnEl&&bnCustom){
    let chosen=bnCustom.value;
    const paint=()=>{
      bnEl.style.background=bannerBg(me,chosen);
      root.querySelectorAll('#spBannerSwatches .banner-swatch').forEach(b=>b.classList.toggle('sel',b.dataset.c===chosen));
    };
    root.querySelectorAll('#spBannerSwatches .banner-swatch').forEach(b=>{
      b.onclick=()=>{chosen=b.dataset.c;bnCustom.value=chosen;paint()};
    });
    bnCustom.addEventListener('input',()=>{chosen=bnCustom.value;paint()});
    q('#spBannerSave').onclick=async()=>{
      const b=q('#spBannerSave');b.disabled=true;b.textContent='Saving…';q('#spBannerErr').textContent='';
      try{await DB.updateSettings(me.id,{bannerColor:chosen});ME=DB.currentUser();toast('Banner saved!')}
      catch(e){q('#spBannerErr').textContent='Could not save: '+(e.code||e.message)}
      b.disabled=false;b.textContent='Save banner';
    };
  }
  if(q('#spBnFile'))q('#spBnFile').onchange=async()=>{
    const f=q('#spBnFile').files[0];if(!f)return;
    const err=q('#spBnErr');err.textContent='';
    if(!f.type.startsWith('image/')){err.textContent='Only images are allowed.';return}
    if(f.size>CFG.MAX_IMG_BYTES){err.textContent='That image is too large (max 8MB).';return}
    err.textContent='Saving…';
    try{
      const out=await mvpBannerFromFile(f);
      await DB.updateSettings(me.id,{banner:out});ME=DB.currentUser();toast('Image banner saved!');reopen('profile');
    }catch(e){err.textContent=e.message||('Could not save: '+(e.code||e))}
  };
  if(q('#spBnRemove'))q('#spBnRemove').onclick=async()=>{
    try{await DB.updateSettings(me.id,{banner:''});ME=DB.currentUser();toast('Image banner removed.');reopen('profile')}
    catch(e){q('#spBnErr').textContent='Could not remove: '+(e.code||e.message)}
  };
  const pron=q('#spPron');
  if(pron){
    const paintP=()=>root.querySelectorAll('#spPronChips button').forEach(b=>b.classList.toggle('on',b.dataset.pron===pron.value.trim().toLowerCase()));
    paintP();
    pron.addEventListener('input',paintP);
    q('#spPronChips').onclick=e=>{const b=e.target.closest('button[data-pron]');if(!b)return;pron.value=b.dataset.pron;paintP()};
    const save=async(val,btn,label)=>{
      btn.disabled=true;btn.textContent='Saving…';q('#spPronErr').textContent='';
      try{await DB.updateSettings(me.id,{pronouns:val});ME=DB.currentUser();pron.value=ME.pronouns||'';paintP();toast(ME.pronouns?'Pronouns saved!':'Pronouns cleared.')}
      catch(e){q('#spPronErr').textContent='Could not save: '+(e.code||e.message)}
      btn.disabled=false;btn.textContent=label;
    };
    q('#spPronSave').onclick=()=>save(pron.value,q('#spPronSave'),'Save pronouns');
    q('#spPronClear').onclick=()=>{pron.value='';save('',q('#spPronClear'),'Clear')};
    pron.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();q('#spPronSave').click()}});
  }
  const desc=q('#spDesc');
  if(desc){
    const cnt=q('#spDescCount');
    const paintD=()=>{if(cnt)cnt.textContent=desc.value.length+'/'+descMaxFor(me.id)};paintD();
    desc.addEventListener('input',paintD);
    const save=async(val,btn,label)=>{
      btn.disabled=true;btn.textContent='Saving…';q('#spDescErr').textContent='';
      try{await DB.updateSettings(me.id,{description:val});ME=DB.currentUser();desc.value=ME.description||'';paintD();toast(ME.description?'Saved!':'Cleared.')}
      catch(e){q('#spDescErr').textContent='Could not save: '+(e.code||e.message)}
      btn.disabled=false;btn.textContent=label;
    };
    q('#spDescSave').onclick=()=>save(desc.value,q('#spDescSave'),'Save');
    q('#spDescClear').onclick=()=>{desc.value='';save('',q('#spDescClear'),'Clear')};
  }
  if(q('#spTags'))q('#spTags').onclick=async e=>{
    const b=e.target.closest('button[data-tag]');if(!b)return;
    const t=b.dataset.tag;let hid=DB.hiddenTagsOf(me.id);
    hid=hid.includes(t)?hid.filter(x=>x!==t):hid.concat(t);
    b.disabled=true;q('#spTagErr').textContent='';
    try{
      await DB.updateSettings(me.id,{hiddenTags:hid.join(',')});
      ME=DB.currentUser();toast(hid.includes(t)?'Tag hidden.':'Tag equipped.');
      if(typeof renderChat==='function')renderChat();
      reopen('profile');
    }catch(err){b.disabled=false;q('#spTagErr').textContent='Could not save: '+(err.code||err.message)}
  };

  /* ---------- Friend Requests ---------- */
  if(q('#sfOpenFriends'))q('#sfOpenFriends').onclick=()=>{closeModalAnimated(root);openChat('dms')};
  const blk=q('#sfBlocked');
  if(blk){
    let list=[];try{list=DB.blockedList(me.id)}catch(_){}
    if(!list.length)blk.innerHTML='<div class="hint">You haven’t blocked anyone.</div>';
    else blk.innerHTML=list.map(id=>{
      const u=DB.getUser(id)||{id,username:'User '+id};
      return `<div class="dl-blk"><span>${esc(displayUsername(u.username))}</span><button type="button" class="btn sec small" data-unblock="${id}">Unblock</button></div>`;
    }).join('');
    blk.onclick=async e=>{
      const b=e.target.closest('[data-unblock]');if(!b)return;
      b.disabled=true;
      try{await DB.unblockUser(me.id,Number(b.dataset.unblock));toast('Unblocked.');reopen('friends')}
      catch(err){b.disabled=false;toast(err.message||'Failed','bad')}
    };
  }

  /* ---------- Perks & Shop ---------- */
  if(q('#snShop'))q('#snShop').onclick=()=>{closeModalAnimated(root);if(typeof openShop==='function')openShop()};
  if(q('#snSpin'))q('#snSpin').onclick=()=>{closeModalAnimated(root);if(typeof openSpin==='function')openSpin()};
  const tier=q('#snTier');
  if(tier){
    let txt='You don’t have VIP or MVP yet.';
    try{
      if(typeof hasMvpPerks==='function'&&hasMvpPerks(me.id))txt='\u{1F3C6} You have <b>MVP</b> — permanent.';
      else{const v=DB.vipInfo(me.id,true,true);
        if(v&&v.kind==='owner')txt='\u{1F531} You’re an <b>owner</b> — every perk is on.';
        else if(v&&v.kind==='perm')txt='\u{1F48E} You have <b>VIP</b> — permanent.';
        else if(v)txt='\u{1F48E} You have <b>VIP</b> right now.';
      }
    }catch(_){}
    tier.innerHTML=txt;
  }

  /* ---------- Accessibility ---------- */
  const red=q('#saReduce');
  if(red){
    let on=false;try{on=localStorage.getItem('ich.reduceMotion')==='1'}catch(_){}
    red.checked=on;
    document.documentElement.classList.toggle('ich-reduce',on);
    red.onchange=()=>{
      try{localStorage.setItem('ich.reduceMotion',red.checked?'1':'0')}catch(_){}
      document.documentElement.classList.toggle('ich-reduce',red.checked);
    };
  }
  if(q('#saAntiLag2'))q('#saAntiLag2').onchange=()=>{
    const v=q('#saAntiLag2').checked;
    try{AntiLag.set(v)}catch(_){}
    const other=q('#sAntiLag');if(other)other.checked=v;
  };
  const szA=q('#saSize'),szV=q('#saSizeV');
  if(szA){
    const paint=()=>{if(szV)szV.textContent=szA.value+'px'};paint();
    szA.addEventListener('input',()=>{paint();const o=q('#sSize');if(o){o.value=szA.value;o.dispatchEvent(new Event('input',{bubbles:true}))}});
  }

  /* ---------- Voice & Video ---------- */
  wireVoiceSettings(root);
}

/* ======================================================================
 *  MOBILE SETTINGS: two levels, the way Discord's phone app does it.
 *
 *  Side by side, a 218px nav and a content column need about 1000px. On a phone there isn't
 *  room for both, and squeezing the nav into the top 40% of the screen gives you a cramped,
 *  half-scrolled list above a cramped, half-scrolled pane. Discord shows the list full-screen,
 *  then replaces it with the pane and a back arrow. That is all this does: a class on the
 *  modal, flipped by the nav buttons and the back arrow. The panes themselves don't change.
 * ====================================================================== */
function wireMobileSettingsNav(root){
  const modal=root.querySelector('.modal.wide');
  const tabs=root.querySelector('#sTabs');
  if(!modal||!tabs)return;

  let back=root.querySelector('#sMobileBack');
  if(!back){
    back=document.createElement('button');
    back.id='sMobileBack';back.type='button';back.className='dset-back';
    back.setAttribute('aria-label','Back to settings');
    back.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span></span>';
    modal.appendChild(back);
  }
  const label=back.querySelector('span');

  const toList=()=>{modal.classList.remove('dset-paned');
    const p=root.querySelector('[data-p]:not(.hidden)');if(p)p.scrollTop=0;};
  back.onclick=e=>{e.stopPropagation();toList()};

  /* Runs AFTER the settings page's own handler, which is what actually swaps the pane - this
     only moves the phone between the two levels and names the one you opened. */
  tabs.addEventListener('click',e=>{
    const b=e.target.closest('button[data-t]');if(!b)return;
    modal.classList.add('dset-paned');
    const ic=b.querySelector('.dl-si'),em=b.querySelector('.dl-e');
    let t=b.textContent||'';
    if(em)t=t.replace(em.textContent,'');
    label.textContent=t.trim();
    const p=root.querySelector('[data-p="'+b.dataset.t+'"]');if(p)p.scrollTop=0;
    if(ic){}
  });

  // Escape backs out one level on a phone before it closes the whole page
  modal.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    if(window.matchMedia&&window.matchMedia('(max-width:820px)').matches&&modal.classList.contains('dset-paned')){
      e.stopPropagation();toList();
    }
  },true);
}

/* The mic test runs entirely in the browser: getUserMedia -> an AnalyserNode -> a meter.
   It never touches Agora, so it can't cost a voice minute. */
function wireVoiceSettings(root){
  const q=id=>root.querySelector(id);
  const sel=q('#svMic'),meter=q('#svMeter'),test=q('#svTest'),err=q('#svErr');
  if(!sel)return;
  let stream=null,ctx=null,raf=0;

  const listMics=async()=>{
    try{
      const devs=await navigator.mediaDevices.enumerateDevices();
      const mics=devs.filter(d=>d.kind==='audioinput');
      let saved='';try{saved=localStorage.getItem('vcMicId')||''}catch(_){}
      sel.innerHTML='<option value="">Default</option>'+mics.map((d,i)=>
        `<option value="${esc(d.deviceId)}"${d.deviceId===saved?' selected':''}>${esc(d.label||('Microphone '+(i+1)))}</option>`).join('');
      const hint=q('#svMicHint');
      if(hint&&mics.length&&mics[0].label)hint.textContent='Picked here, used by every voice channel.';
    }catch(_){}
  };
  listMics();
  sel.onchange=()=>{try{localStorage.setItem('vcMicId',sel.value)}catch(_){}};

  const stop=()=>{
    cancelAnimationFrame(raf);raf=0;
    try{if(stream)stream.getTracks().forEach(t=>t.stop())}catch(_){}
    try{if(ctx)ctx.close()}catch(_){}
    stream=null;ctx=null;
    if(meter)meter.style.setProperty('--lvl','0');
    if(test)test.textContent='Let me hear myself';
  };
  if(test)test.onclick=async()=>{
    if(stream){stop();return}
    if(err)err.textContent='';
    try{
      const id=sel.value;
      stream=await navigator.mediaDevices.getUserMedia({audio:id?{deviceId:{exact:id}}:true});
      listMics();
      ctx=new (window.AudioContext||window.webkitAudioContext)();
      const src=ctx.createMediaStreamSource(stream),an=ctx.createAnalyser();
      an.fftSize=512;src.connect(an);
      const buf=new Uint8Array(an.frequencyBinCount);
      test.textContent='Stop';
      const loop=()=>{
        an.getByteTimeDomainData(buf);
        let peak=0;for(let i=0;i<buf.length;i++){const v=Math.abs(buf[i]-128)/128;if(v>peak)peak=v}
        if(meter)meter.style.setProperty('--lvl',Math.min(1,peak*2.6).toFixed(3));
        raf=requestAnimationFrame(loop);
      };
      loop();
    }catch(e){
      if(err)err.textContent=/NotAllowed|Permission/i.test(String(e&&(e.name||e.message)))
        ? 'Microphone blocked. Allow it for this site in your browser’s settings.'
        : 'Couldn’t open the microphone: '+String(e&&e.message||e);
      stop();
    }
  };
  // stop the mic the moment settings close, so no tab is left with a live recording light
  const obs=new MutationObserver(()=>{if(!root.querySelector('#svMic')){stop();obs.disconnect()}});
  obs.observe(root,{childList:true,subtree:true});

  if(q('#svDiag'))q('#svDiag').onclick=async()=>{
    const out=q('#svDiagOut'),b=q('#svDiag');
    b.disabled=true;b.textContent='Testing…';
    out.style.display='';out.textContent='Running…';
    try{out.textContent=await window.__vcTest()}
    catch(e){out.textContent='Test failed: '+String(e&&e.message||e)}
    b.disabled=false;b.textContent='Run connection test';
  };
}
