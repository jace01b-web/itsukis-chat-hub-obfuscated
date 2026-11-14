/* ==========================================================================
 * js/settings/settings-plus.js  (v54)
 *
 * The settings work for v54. Two new panes (Connections, Devices & Sessions) and a lot of new
 * controls folded into the panes that already exist.
 *
 * HOW IT ATTACHES, AND WHY THAT WAY
 *   The existing panes are built as template strings in js/settings/settings-page.js and
 *   js/settings/discord-settings.js. Rather than rewrite either - both are long, both work, and
 *   both are covered by tests - this file:
 *     1. wraps SET_NAV to splice two new nav buttons into the right groups, and
 *     2. wraps wireDiscordSettings to APPEND new .set-card blocks into the panes that already
 *        exist, then wire everything.
 *   Both wrapped names are function declarations, so the binding is writable. Nothing existing
 *   is edited, so a mistake here cannot break a pane that worked before.
 *
 * THE ONE RULE THAT MATTERS
 *   "Every setting must actually work and persist." So almost nothing here is wired by hand.
 *   A control declares which preference it is (data-pref="key") and ONE loop at the bottom reads
 *   it, writes it through Prefs, and repaints. A control cannot be added without being wired,
 *   and a preference cannot be wired to the wrong key, because there is only one path.
 *
 *   Prefs stores everything in users/$id/settings/<key>, whose database rule already accepts any
 *   scalar - so none of this needed a rules change. The map-shaped things (per-server
 *   notification overrides, connections) have their own nodes.
 * ========================================================================== */
'use strict';

/* ======================================================================
 *  DECLARATIVE CONTROLS
 *  Each returns markup carrying data-pref, which is all the wiring loop needs.
 * ====================================================================== */

function sxToggle(key,title,hint){
  const on=Prefs.get(key);
  return '<div class="toggle-row sx-row">'+
    '<div><div class="sx-t">'+title+'</div>'+(hint?'<div class="hint sx-h">'+hint+'</div>':'')+'</div>'+
    '<label class="switch"><input type="checkbox" data-pref="'+esc(key)+'"'+(on?' checked':'')+'><span class="slider"></span></label>'+
  '</div>';
}

function sxSelect(key,title,opts,hint){
  const cur=String(Prefs.get(key));
  return '<div class="field sx-field">'+
    '<label>'+title+'</label>'+
    '<select data-pref="'+esc(key)+'">'+opts.map(o=>
      '<option value="'+esc(o[0])+'"'+(String(o[0])===cur?' selected':'')+'>'+esc(o[1])+'</option>').join('')+
    '</select>'+
    (hint?'<div class="hint sx-h">'+hint+'</div>':'')+
  '</div>';
}

function sxRange(key,title,min,max,step,suffix,hint){
  const v=Prefs.get(key);
  return '<div class="field sx-field">'+
    '<label>'+title+' <span class="val" data-prefval="'+esc(key)+'">'+esc(String(v)+(suffix||''))+'</span></label>'+
    '<input type="range" data-pref="'+esc(key)+'" data-suffix="'+esc(suffix||'')+'" min="'+min+'" max="'+max+'" step="'+(step||1)+'" value="'+esc(String(v))+'">'+
    (hint?'<div class="hint sx-h">'+hint+'</div>':'')+
  '</div>';
}

function sxTime(key,title,hint){
  return '<div class="field sx-field">'+
    '<label>'+title+'</label>'+
    '<input type="time" data-pref="'+esc(key)+'" value="'+esc(String(Prefs.get(key)))+'">'+
    (hint?'<div class="hint sx-h">'+hint+'</div>':'')+
  '</div>';
}

function sxCard(title,body,id){
  return '<div class="set-card"'+(id?' id="'+id+'"':'')+'>'+
    (title?'<div class="section-h" style="margin-top:0">'+title+'</div>':'')+body+'</div>';
}

/* ======================================================================
 *  THE NAV - two new entries, spliced into the groups they belong in
 * ====================================================================== */
const _SET_NAV_V53=SET_NAV;
SET_NAV=function(me){
  let html;
  try{html=_SET_NAV_V53(me)}catch(e){console.error('[settings] base nav failed',e);return ''}
  try{
    /* Connections sits with the other things about YOU, right after Friend Requests, which is
       where Discord keeps it. Devices & Sessions goes in the site group, next to Advanced,
       because it is about this browser rather than about your profile. */
    const conn=dsBtn('conn','Connections',DSI.globe);
    const sess=dsBtn('sessions','Devices &amp; Sessions',DSI.keys);
    const afterFriends=/<button data-t="friends"[\s\S]*?<\/button>/;
    if(afterFriends.test(html))html=html.replace(afterFriends,m=>m+conn);
    else html+=conn;
    const beforeAdvanced=/<button data-t="about"[\s\S]*?<\/button>/;
    if(beforeAdvanced.test(html))html=html.replace(beforeAdvanced,m=>m+sess);
    else html+=sess;
    /* v54.8: Activity & Presence — one of the categories the brief asks for (section 7), and
       the answer to a real discoverability problem: status, automatic idle and the custom
       status were only reachable from the little popout above the account panel, and the two
       halves of Do Not Disturb (the STATUS and the scheduled WINDOW) lived in different places
       with nothing saying they were the same feature. It sits next to Notifications because
       that is what most of it decides. */
    const pres=dsBtn('presence','Activity &amp; Presence',DSI.people||DSI.friends);
    const afterPing=/<button data-t="ping"[\s\S]*?<\/button>/;
    if(afterPing.test(html))html=html.replace(afterPing,m=>m+pres);
    else html+=pres;
  }catch(e){console.error('[settings] nav splice failed',e)}
  return html;
};

/* ======================================================================
 *  THE TWO NEW PANES
 *  Appended to the modal body, so they pair 1:1 with the two nav buttons above - the pairing
 *  test in test/run-v54.js checks that every data-t has a data-p and vice versa.
 * ====================================================================== */
function V54_PANES(me,s){
  const conn=`<div data-p="conn" class="hidden">
    ${sxCard('Connected accounts',
      `<div class="hint" style="margin-bottom:12px">Accounts you choose to show on your profile.
         <b>These are typed in by hand and nothing is verified</b> — there is no sign-in with
         YouTube or Steam here, so treat them as links somebody says are theirs, not as proof.
         Anyone who can see your profile can see the ones you haven't hidden.</div>
       <div id="sxConnList" class="sx-conn-list"></div>
       <div class="err" id="sxConnErr"></div>
       <button type="button" class="btn sec" id="sxConnAdd" style="margin-top:10px">+ Add a connection</button>`)}
    ${sxCard('Visibility',
      sxToggle('shareActivity','Show what I\'m listening to',
        'Puts the track the music player is on, and the voice channel you\'re in, on your profile. Turning this off removes it for everyone straight away.'))}
  </div>`;

  const sess=`<div data-p="sessions" class="hidden">
    ${sxCard('This device',`<div id="sxThisDevice" class="sx-dev"></div>`)}
    ${sxCard('Other sessions',
      `<div class="hint" style="margin-bottom:12px">Your account can only be chatting from one
         place at a time — signing in somewhere else takes the session over and the old tab is
         told it was replaced. There is no list of past devices to show, because none is kept:
         only the single current session token is stored, which is deliberately all it takes to
         make the one-session rule work.</div>
       <div id="sxSessInfo" class="sx-dev"></div>
       <button type="button" class="btn sec" id="sxSessClaim" style="margin-top:10px">Make this device the active one</button>
       <div class="hint" style="margin-top:8px">If you think somebody else is signed in, do this and then change your password.</div>`)}
    ${sxCard('Sign out',
      `<button type="button" class="btn sec" style="width:100%" id="sxSignOut2">🚪 Sign out of this device</button>`)}
  </div>`;

  /* ---------------- v54.8: Activity & Presence ---------------- */
  const presence=`<div data-p="presence" class="hidden">
    ${sxCard('Status',
      `<div class="hint" style="margin-bottom:12px">Your status is what everyone else sees next
         to your name. <b>Do Not Disturb silences notifications</b> — it does not stop messages
         arriving, hide them, or clear your unread counts.</div>
       <div class="sxp-st" id="sxpStatus">
         ${STATUSES.map(k=>
           '<button type="button" class="sxp-stbtn" data-sxst="'+k+'">'+
             '<span class="sxp-stdot '+k+'" aria-hidden="true"></span>'+
             '<span class="sxp-sttx"><b>'+esc(STATUS_LABEL[k])+'</b>'+
             (STATUS_SUB[k]?'<small>'+esc(STATUS_SUB[k])+'</small>':'')+'</span>'+
           '</button>').join('')}
       </div>`)}
    ${sxCard('Custom status',
      `<div class="field"><label for="sxpCustom">What's on your mind?</label>
         <input id="sxpCustom" type="text" maxlength="128" autocomplete="off"
                placeholder="Working on something" value="${esc((function(){try{return DB.customStatusOf(me.id)}catch(_){return ''}})())}"></div>
       <div class="field"><label for="sxpUntil">Clear after</label>
         <select id="sxpUntil">${CS_TERMS.map(([v,l])=>'<option value="'+v+'">'+esc(l)+'</option>').join('')}</select></div>
       <div class="hint" id="sxpUntilNow" style="min-height:16px"></div>
       <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
         <button type="button" class="btn" id="sxpSave" style="width:auto">Save status</button>
         <button type="button" class="btn sec" id="sxpClear" style="width:auto">Clear</button>
       </div>
       <div class="err" id="sxpErr"></div>`)}
    ${sxCard('Automatic idle',
      `<div class="hint">After about ${Math.round((typeof AutoIdle!=='undefined'?AutoIdle.IDLE_AFTER_MS:600000)/60000)} minutes
         without any activity, an <b>Online</b> status becomes <b>Idle</b> on its own, and goes
         back to Online as soon as you do something. Do Not Disturb and Invisible are never
         changed for you — if you picked one of those, it stays until you change it.</div>
       <div class="sxp-idle" id="sxpIdle"></div>`)}
    ${sxCard('Quiet hours',
      `<div class="hint" style="margin-bottom:10px">A scheduled window that silences
         notifications exactly the way Do Not Disturb does. Set it in
         <b>Notifications</b>; this is where it currently stands.</div>
       <div class="sxp-idle" id="sxpQuiet"></div>`)}
    ${sxCard('Activity',
      sxToggle('shareActivity','Show what I\'m listening to',
        'Puts the track the music player is on, and the voice channel you\'re in, on your profile. Turning this off removes it for everyone straight away.'))}
  </div>`;

  return conn+sess+presence;
}

const _SET_PANES_V53=SET_PANES;
SET_PANES=function(me,s){
  let base='';
  try{base=_SET_PANES_V53(me,s)}catch(e){console.error('[settings] base panes failed',e)}
  let extra='';
  try{extra=V54_PANES(me,s)}catch(e){console.error('[settings] v54 panes failed',e)}
  return base+extra;
};

/* ======================================================================
 *  THE BLOCKS APPENDED INTO EXISTING PANES
 *  Keyed by the pane's data-p value. Each returns markup; the wiring loop handles the controls.
 * ====================================================================== */
function V54_BLOCKS(me,s){
  return{

    /* ---------------- Profiles: accent, theme, decoration ---------------- */
    profile:(()=>{
      const curAccent=(()=>{try{return PData.accentOf(me.id)}catch(_){return '#5865f2'}})();
      const curTheme=(()=>{try{return PData.themeOf(me.id)}catch(_){return ''}})();
      const curDeco=(()=>{try{return String((me.style&&me.style.deco)||'')}catch(_){return ''}})();
      const themes=PROFILE_THEMES.map(t=>{
        const sw=t.a?('linear-gradient(135deg,'+t.a+','+t.b+')')
                    :('linear-gradient(135deg,'+curAccent+','+PData.shade(curAccent,-.55)+')');
        return '<button type="button" class="pf-theme-opt'+(curTheme===t.id?' on':'')+'" data-sxtheme="'+esc(t.id)+'">'+
          '<span class="pf-theme-sw" style="background:'+esc(sw)+'"></span><span class="n">'+esc(t.name)+'</span></button>';
      }).join('');
      const decos=PROFILE_DECOS.map(d=>{
        const allowed=(()=>{try{return PData.decoAllowed(me.id,d)}catch(_){return !d.tier}})();
        const inner=d.id
          ?'<span class="pf-deco pf-deco-'+esc(d.id)+'">'+avatarHtml(me,me.username,'width:34px;height:34px;font-size:14px')+'</span>'
          :avatarHtml(me,me.username,'width:34px;height:34px;font-size:14px');
        return '<button type="button" class="pf-deco-opt'+(curDeco===d.id?' on':'')+'" data-sxdeco="'+esc(d.id)+'"'+
          (allowed?'':' disabled')+'>'+inner+'<span>'+esc(d.name)+'</span>'+
          (allowed?'':'<span class="pf-deco-lock">'+(d.tier==='mvp'?'MVP':'VIP')+'</span>')+'</button>';
      }).join('');
      return sxCard('Profile Colour',
        `<div class="field"><label>Accent colour</label>
           <div class="sx-colorrow">
             <input type="color" id="sxAccent" value="${esc(curAccent)}" aria-label="Accent colour">
             <input type="text" id="sxAccentHex" maxlength="7" value="${esc(curAccent)}" spellcheck="false" aria-label="Accent colour hex">
             <button type="button" class="btn sec small" id="sxAccentReset">Use my message colour</button>
           </div>
         </div>
         <div class="hint">Tints your profile card, its banner gradient and the buttons on it.
           Everyone who opens your profile sees it.</div>
         <div class="err" id="sxAccentErr"></div>`)+
        sxCard('Profile Theme',
          '<div class="pf-themes">'+themes+'</div>'+
          '<div class="hint" style="margin-top:10px">Changes your profile card only — not the app. '+
          '“Accent” follows the colour above.</div>'+
          '<div class="err" id="sxThemeErr"></div>')+
        sxCard('Avatar Decoration',
          '<div class="pf-decos">'+decos+'</div>'+
          '<div class="hint" style="margin-top:10px">A frame around your avatar, everywhere it '+
          'appears. Some need VIP or MVP; if that lapses, the frame simply stops showing and comes '+
          'back if it returns — nothing is lost.</div>'+
          '<div class="err" id="sxDecoErr"></div>');
    })(),

    /* ---------------- My Account: password + deletion ---------------- */
    account:
      sxCard('Change your password',
        `<div class="field"><label>Current password</label>
           <input id="sxPwCur" type="password" autocomplete="current-password"></div>
         <div class="field"><label>New password (at least ${CFG.MIN_PW} characters)</label>
           <input id="sxPwNew" type="password" autocomplete="new-password"></div>
         <div class="field"><label>Type it again</label>
           <input id="sxPwNew2" type="password" autocomplete="new-password"></div>
         <div class="hint">Your current password is needed because there is no email on this
           account and therefore no reset link — it is the only way to prove it is you and not
           somebody who found your screen unlocked. The password is handled entirely by Firebase
           Authentication; no password is ever written to the database.</div>
         <div class="hint">If you forget the new one, nobody can recover it for you. Write it
           down somewhere safe.</div>
         <div class="err" id="sxPwErr"></div>
         <div class="actions" style="justify-content:flex-start"><button class="btn" id="sxPwSave">Change password</button></div>`)+
      sxCard('Delete your account',
        `<div class="hint">This cannot be undone. Here is exactly what happens, so there are no
           surprises:</div>
         <ul class="sx-list">
           <li>Your username is <b>released</b> — somebody else can take it.</li>
           <li>Your avatar, banner, bio, pronouns, status and every setting are <b>wiped</b>.</li>
           <li>Your account is marked deleted and your login is <b>removed</b> — you cannot sign back in.</li>
           <li>Your messages in the main channels and in your DMs are <b>deleted</b>.</li>
           <li>Messages you sent in servers other people made <b>stay</b>, shown as “Deleted User”.
               Only that server's staff can remove those, the same as any other message.</li>
         </ul>
         <div class="field"><label>Type your username (<b>${esc(me.username)}</b>) to confirm</label>
           <input id="sxDelName" autocomplete="off" spellcheck="false" placeholder="${esc(me.username)}"></div>
         <div class="err" id="sxDelErr"></div>
         <div class="actions" style="justify-content:flex-start">
           <button class="btn danger" id="sxDelGo" disabled>Delete my account permanently</button>
         </div>`),

    /* ---------------- Privacy & Safety ---------------- */
    filter:
      sxCard('Who can reach you',
        sxSelect('dmFrom','Direct messages from',[
          ['all','Anyone'],['friends','Friends only'],['none','Nobody']],
          'Applies to new conversations. Existing DMs with friends always stay open. ICH already '+
          'requires you to be friends before a DM can be sent, so “Friends only” is the normal setting.')+
        sxSelect('reqFrom','Friend requests from',[
          ['all','Anyone'],['mutual','People in a server with me'],['none','Nobody']],
          'Requests that don\'t pass this are declined automatically and you are never shown them.'))+
      sxCard('What others can see',
        sxToggle('showOnline','Show when I\'m online',
          'Off is the same as picking Invisible: you appear offline to everyone but yourself.')+
        sxToggle('shareActivity','Show what I\'m doing',
          'The track you\'re playing and the voice channel you\'re in, on your profile.')+
        sxToggle('readReceipts','Send read receipts',
          'Lets the person you\'re DMing see that you\'ve read it. Turning this off also stops you seeing theirs.'))+
      sxCard('Message filtering',
        sxToggle('allowDmScan','Filter explicit content in my DMs',
          'Runs the same image check the public channels use on pictures sent to you. '+
          'The word filter and the public-channel image check are set by the site\'s moderators and are not yours to turn off.'))+
      sxCard('Ignored users',
        `<div class="hint" style="margin-bottom:10px">Ignoring is lighter than blocking: their
           messages collapse to a line you can tap to read, they can still see you, and nothing
           is sent to them. Kept on this device.</div>
         <div id="sxIgnList" class="sx-ign-list"></div>`),

    /* ---------------- Appearance ---------------- */
    ui:
      sxCard('Message Display',
        sxSelect('density','Layout',[['cozy','Cozy — big avatars, roomy'],['compact','Compact — one line each']],
          'Cozy is Discord\'s default. Compact fits far more on screen and drops the avatars.')+
        sxSelect('msgSpacing','Space between messages',[['tight','Tight'],['normal','Normal'],['roomy','Roomy']])+
        sxToggle('showAvatars','Show avatars','Off keeps the layout but hides every picture.')+
        sxToggle('time24','24-hour clock','14:30 instead of 2:30 PM.'))+
      sxCard('Colour',
        sxRange('saturation','Saturation',0,100,5,'%',
          'Drags all the colour out of the app. 0% is greyscale. The colour pickers stay in colour so you can still use them.')+
        sxToggle('accentUi','Tint the app with my accent colour',
          'Uses the accent from Settings → Profiles for buttons and highlights, instead of the theme\'s own blurple.')+
        sxToggle('highContrast','High contrast',
          'Solid panels, hard borders and brighter secondary text. Helps on a dim screen or in sunlight.'))+
      sxCard('Motion',
        sxToggle('reduceMotion','Reduce motion',
          'Stops animations, glows and looping effects everywhere. Your device\'s own setting is honoured too.'))+
      sxCard('Reset',
        `<button type="button" class="btn sec" id="sxResetLook" style="width:100%">Reset appearance to defaults</button>
         <div class="hint" style="margin-top:8px">Puts everything on this page and on Accessibility
           back the way it shipped. Your colours, avatar and banner are not touched.</div>`),

    /* ---------------- Accessibility ---------------- */
    a11y:
      sxCard('Navigation',
        sxToggle('keyboardNav','Always show focus outlines',
          'Draws a clear ring around whatever the keyboard is on, so the app can be used without a mouse.')+
        sxToggle('bigTargets','Bigger tap targets',
          'Grows rows and buttons to at least 44px — the size a finger reliably hits.'))+
      sxCard('Reading',
        sxToggle('underlineLinks','Underline links',
          'So a link is not told apart by colour alone.')+
        sxToggle('srLabels','Screen reader labels',
          'Keeps the extra descriptions on icons and buttons. On by default; turning it off only '+
          'reduces what assistive software announces, it changes nothing visually.')+
        sxToggle('highContrast','High contrast','The same switch as Appearance.'))+
      sxCard('Chat text size',
        `<div class="hint">The chat text slider lives in <b>Text &amp; Images</b> and is repeated at
           the bottom of this page. There is deliberately only one of them, so the two can never
           disagree.</div>`),

    /* ---------------- Notifications ---------------- */
    ping:
      sxCard('Desktop notifications',
        sxToggle('desktopNotif','Show desktop notifications',
          'A system notification when a message arrives while this tab is in the background. Your browser has to allow it — turning this on asks.')+
        `<div id="sxNotifState" class="hint"></div>
         <button type="button" class="btn sec small" id="sxNotifTest" style="margin-top:8px">Send a test notification</button>`)+
      sxCard('What to notify about',
        /* v54.9: these are the ONLY notification switches now. This pane used to show these
           cards AND three older toggles of its own above them — two "Desktop notifications"
           switches and two sound switches, side by side, writing different storage. The older
           set is gone and its values were migrated; see js/core/prefs.js.
           `notifEveryone` is the one that was only in the old set, so it is here now. */
        sxToggle('notifSound','Play a sound',
          'The site\'s ping chime. Independent of desktop notifications — you can have the sound with them switched off, and it needs no browser permission.')+
        sxToggle('notifEveryone','Include @everyone',
          'Treat an @everyone as a mention of you. With this off, only a direct @you or a role you have counts.')+
        sxToggle('notifMentions','When I\'m mentioned','@you, @everyone and a role you have.')+
        sxToggle('notifDM','Direct messages')+
        sxToggle('notifFriend','Friend requests'))+
      sxCard('Do Not Disturb schedule',
        sxToggle('dndOn','Quiet hours','Nothing makes a sound or raises a notification inside this window. Picking “Do Not Disturb” as your status does the same thing at any hour.')+
        '<div class="sx-two">'+sxTime('dndFrom','From')+sxTime('dndTo','Until')+'</div>'+
        '<div class="hint" id="sxDndNow"></div>')+
      sxCard('Per-server and per-channel',
        `<div class="hint" style="margin-bottom:10px">Most specific wins: muting one channel in a
           server set to All Messages mutes that channel only. Right-click any server or channel
           to change it there too.</div>
         <div id="sxNotifServers" class="sx-notif-list"></div>`),

    /* ---------------- Text & Images / Chat ---------------- */
    msg:
      sxCard('Sending',
        sxToggle('enterToSend','Enter sends the message',
          'Off means Enter makes a new line and Ctrl+Enter sends.')+
        sxToggle('showSendBtn','Show the send button',
          'Off hides the arrow and leaves the keyboard as the only way to send.'))+
      sxCard('Formatting',
        sxToggle('markdownOn','Format messages',
          'Bold, italics, code blocks, quotes, spoilers and links. Off shows everybody\'s messages exactly as typed.')+
        sxToggle('jumboEmoji','Big emoji',
          'A message that is nothing but emoji is drawn large.')+
        sxToggle('emojiSuggest','Suggest emoji as I type',
          'The :name: autocomplete.'))+
      sxCard('Images, video and links',
        sxToggle('linkPreviews','Show link previews')+
        sxToggle('mediaAutoplay','Play videos automatically')+
        sxToggle('gifAutoplay','Animate GIFs automatically')+
        sxToggle('inlineAttach','Show attachments inline',
          'Off lists them as files to tap instead of drawing them in the message.')+
        sxToggle('spoilerClick','Hide spoilers until I click them',
          'Off reveals every spoiler straight away. It does not change what you send.')),

    /* ---------------- Advanced ---------------- */
    about:
      sxCard('Developer',
        sxToggle('devMode','Developer mode',
          'Adds “Copy ID” to the right-click menus and shows message ids on hover. Handy for reporting a specific message.')+
        sxToggle('expFeatures','Experimental features',
          'Turns on things that are finished enough to use but not finished enough to be on by default. Right now: polls in the + menu.'))+
      sxCard('Diagnostics',
        `<div id="sxDiag" class="sx-diag"></div>
         <div class="actions" style="justify-content:flex-start;margin-top:10px">
           <button class="btn sec small" id="sxDiagCopy">Copy diagnostics</button>
           <button class="btn sec small" id="sxDiagRefresh">Refresh</button>
         </div>
         <div class="hint" style="margin-top:8px">Paste this into a bug report. It has no passwords
           or message content in it — just your build, your browser and what the app thinks is
           connected.</div>`)+
      sxCard('Storage',
        `<div id="sxCacheInfo" class="hint"></div>
         <div class="actions" style="justify-content:flex-start;margin-top:10px">
           <button class="btn sec small" id="sxCacheClear">Clear this device's cache</button>
           <button class="btn sec small" id="sxCacheReload">Reload the app</button>
         </div>
         <div class="hint" style="margin-top:8px">Clears what is kept in this browser — your
           appearance choices on this device, drafts, the note cache and the dismissed banners.
           <b>Nothing on your account is touched</b>: sign in again and it all comes back.</div>`)
  };
}

/* ======================================================================
 *  WIRING
 * ====================================================================== */
const _wireDiscordSettings_V53=wireDiscordSettings;
wireDiscordSettings=function(root,me,s,reopen){
  try{_wireDiscordSettings_V53(root,me,s,reopen)}
  catch(e){console.error('[settings] base wiring failed',e)}
  try{wireV54Settings(root,me,s,reopen)}
  catch(e){console.error('[settings] v54 wiring failed',e)}
};

function wireV54Settings(root,me,s,reopen){
  const q=sel=>root.querySelector(sel);

  /* ---- 0. v54.8: Activity & Presence --------------------------------
     Everything here writes through the same DB functions the account panel's popout uses, so
     the two surfaces cannot drift apart: DB.setStatus and DB.setCustomStatus are the only
     writers, and DB.chosenStatusOf / DB.customStatusUntil are the only readers. */
  (function wirePresence(){
    const host=q('[data-p="presence"]');
    if(!host)return;

    const mark=()=>{
      let cur='online';try{cur=DB.chosenStatusOf(me.id)}catch(_){}
      host.querySelectorAll('[data-sxst]').forEach(b=>
        b.classList.toggle('on',b.dataset.sxst===cur));
    };
    mark();
    host.querySelectorAll('[data-sxst]').forEach(b=>b.onclick=async()=>{
      const v=b.dataset.sxst;
      host.querySelectorAll('[data-sxst]').forEach(x=>x.disabled=true);
      try{
        await DB.setStatus(me.id,v);
        ME=DB.currentUser();mark();
        toast('Status: '+STATUS_LABEL[v],'good');
        try{DiscordShell.refresh()}catch(_){}
        try{PCard.repaintAll()}catch(_){}
      }catch(e){toast('Could not change your status.','bad')}
      finally{host.querySelectorAll('[data-sxst]').forEach(x=>x.disabled=false)}
    });

    const ci=q('#sxpCustom'),selU=q('#sxpUntil'),nowEl=q('#sxpUntilNow'),err=q('#sxpErr');
    const showTerm=()=>{
      let until=0;try{until=DB.customStatusUntil(me.id)}catch(_){}
      if(nowEl)nowEl.textContent=until
        ?('Clears at '+new Date(until).toLocaleString([],{hour:'2-digit',minute:'2-digit'}))
        :'This status does not expire.';
    };
    showTerm();
    let busy=false;
    const save=async(text,term)=>{
      if(busy)return;busy=true;if(err)err.textContent='';
      const sv=q('#sxpSave'),cl=q('#sxpClear');
      if(sv)sv.disabled=true;if(cl)cl.disabled=true;
      try{
        await DB.setCustomStatus(me.id,text,term>0?Date.now()+term:0);
        ME=DB.currentUser();showTerm();
        try{DiscordShell.refresh()}catch(_){}
        try{PCard.repaintAll()}catch(_){}
        toast(text?'Custom status saved':'Custom status cleared','good');
      }catch(e){
        /* Reporting the real failure rather than a shrug: a refused write here almost always
           means the rules in the console predate this build (style/customStatusUntil is new). */
        if(err)err.textContent=/PERMISSION/i.test((e&&(e.code||e.message))||'')
          ?'The database refused that. Publish the current firebase-rules.json — v54.8 adds style/customStatusUntil.'
          :((e&&e.message)||'Could not save your status.');
      }finally{
        busy=false;
        if(sv)sv.disabled=false;if(cl)cl.disabled=false;
      }
    };
    const sv=q('#sxpSave');if(sv)sv.onclick=()=>save((ci&&ci.value)||'',csTermToMs(selU?selU.value:'0'));
    const cl=q('#sxpClear');if(cl)cl.onclick=()=>{if(ci)ci.value='';save('',0)};
    if(ci)ci.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();save(ci.value,csTermToMs(selU?selU.value:'0'))}
    });

    /* The two read-outs. Refreshed on a timer while the pane is open so "idle in 7 minutes"
       counts down rather than being a snapshot from when settings was opened; the interval is
       cleared when the panel goes, which is what reopen() hands us a hook for. */
    const idleEl=q('#sxpIdle'),quietEl=q('#sxpQuiet');
    const paintLive=()=>{
      if(!host.isConnected)return false;
      try{
        const st=(typeof AutoIdle!=='undefined')?AutoIdle._state():null;
        if(idleEl&&st){
          const mins=Math.floor(st.idleForMs/60000);
          const chosen=DB.chosenStatusOf(me.id);
          idleEl.textContent=chosen==='online'
            ?('No activity for '+mins+' minute'+(mins===1?'':'s')+'.'+
              (st.owned?' You are currently Idle automatically.':''))
            :(chosen==='idle'&&st.owned
                ?'You were set to Idle automatically; moving the mouse brings you back.'
                :STATUS_LABEL[chosen]+' is set by hand, so automatic idle will not change it.');
        }
        if(quietEl){
          const n=(typeof Notifier!=='undefined')?Notifier.state():null;
          quietEl.textContent=n
            ?(n.quietHours?'Quiet hours are active right now — notifications are silenced.'
                          :'Quiet hours are not active right now.')
            :'';
        }
      }catch(_){}
      return true;
    };
    paintLive();
    const t=setInterval(()=>{if(!paintLive())clearInterval(t)},15000);
  })();

  /* ---- 1. inject the blocks into the panes that already exist ---- */
  let blocks={};
  try{blocks=V54_BLOCKS(me,s)}catch(e){console.error('[settings] block build failed',e)}
  Object.keys(blocks).forEach(pane=>{
    const host=root.querySelector('[data-p="'+pane+'"]');
    if(!host){console.warn('[settings] no pane for',pane);return}
    const wrap=document.createElement('div');
    wrap.className='sx-block';
    wrap.innerHTML=blocks[pane];
    host.appendChild(wrap);
  });

  /* ---- 2. ONE loop that wires every declarative control ----
     This is the whole reason the controls are declarative: a new setting is a line of markup and
     it is wired, persisted and repainted without anyone having to remember to do it. */
  root.querySelectorAll('[data-pref]').forEach(el=>{
    const key=el.dataset.pref;
    if(!Prefs.SCHEMA[key]){console.warn('[settings] control for unknown preference',key);return}
    const kind=el.type==='checkbox'?'b':(el.type==='range'?'n':(el.tagName==='SELECT'?'e':'s'));
    const push=async()=>{
      const v=kind==='b'?el.checked:el.value;
      await Prefs.set(key,v);
      /* Any other control bound to the same preference (high contrast appears on two pages, and
         so does activity sharing) is brought into line immediately, so the two can never show
         different states. */
      root.querySelectorAll('[data-pref="'+key+'"]').forEach(o=>{
        if(o===el)return;
        if(o.type==='checkbox')o.checked=Prefs.get(key);else o.value=Prefs.get(key);
      });
      const out=root.querySelector('[data-prefval="'+key+'"]');
      if(out)out.textContent=String(Prefs.get(key))+(el.dataset.suffix||'');
      afterPrefChange(key,root,me);
    };
    if(kind==='n'){
      el.addEventListener('input',()=>{
        const out=root.querySelector('[data-prefval="'+key+'"]');
        if(out)out.textContent=el.value+(el.dataset.suffix||'');
        /* Repaint live while dragging; the write happens on release so a drag is one save. */
        try{Prefs.apply()}catch(_){}
        document.documentElement.style.setProperty('--pf-sat',(Number(el.value)/100).toFixed(3));
        document.documentElement.classList.toggle('pf-sat',Number(el.value)!==100);
      });
      el.addEventListener('change',push);
    }else{
      el.addEventListener('change',push);
    }
  });

  /* ---- 3. the pieces that are not a single scalar ---- */
  wireProfileLook(root,me,reopen);
  wireAccountExtras(root,me,reopen);
  wireIgnored(root,me);
  wireNotifications(root,me);
  wireConnections(root,me);
  wireSessions(root,me);
  wireAdvanced(root,me);
}

/* Things that have to happen when a particular preference changes. Kept in one place so the
   wiring loop stays generic. */
function afterPrefChange(key,root,me){
  try{
    if(key==='showOnline'){
      /* "Show when I'm online" is the same thing as the Invisible status, so it writes the status
         rather than inventing a second, parallel notion of being hidden. */
      const want=Prefs.get('showOnline')?'online':'invisible';
      const cur=normStatus(ME&&ME.style&&ME.style.status);
      if(want==='invisible'&&cur!=='invisible')DB.setStatus(ME.id,'invisible').catch(()=>{});
      if(want==='online'&&cur==='invisible')DB.setStatus(ME.id,'online').catch(()=>{});
    }
    if(key==='shareActivity'&&!Prefs.get('shareActivity'))PActivity.clear();
    if(key==='desktopNotif'&&Prefs.get('desktopNotif')){
      Notifier.request().then(p=>{
        if(p!=='granted'){
          /* v54.9: put the switch back. A toggle left reading "on" while the browser refuses to
             deliver anything is a control that lies about what it does — the behaviour the old
             #sPd handler in settings-page.js had and this one had lost. Sound is unaffected:
             it is a separate preference and needs no permission. */
          Prefs.set('desktopNotif',false);
          const box=root.querySelector('[data-pref="desktopNotif"]');
          if(box)box.checked=false;
          toast(p==='denied'
            ?'Your browser blocked notifications — allow them in the site settings next to the address bar. The ping sound still works.'
            :'Notifications were not allowed. The ping sound still works.','bad');
        }
        paintNotifState(root);
      });
    }
    if(key==='desktopNotif'||key==='dndOn'||key==='dndFrom'||key==='dndTo')paintNotifState(root);
    if(key==='devMode'||key==='expFeatures'){
      try{if(typeof DiscordShell!=='undefined')DiscordShell.refresh()}catch(_){}
    }
    if(key==='markdownOn'||key==='jumboEmoji'||key==='inlineAttach'||key==='spoilerClick'||
       key==='density'||key==='msgSpacing'||key==='showAvatars'||key==='time24'){
      try{renderedKey=null;renderChat()}catch(_){}
    }
  }catch(e){console.warn('[settings] afterPrefChange',key,e)}
}

/* ======================================================================
 *  Profiles: accent, theme, decoration
 * ====================================================================== */
function wireProfileLook(root,me,reopen){
  const hex=root.querySelector('#sxAccentHex'),col=root.querySelector('#sxAccent');
  const err=root.querySelector('#sxAccentErr');
  if(col&&hex){
    const save=async v=>{
      if(err)err.textContent='';
      if(!safeColor(v,'')){if(err)err.textContent='That is not a colour. Use a hex value like #5865f2.';return}
      try{
        await set(R('users/'+me.id+'/style/accent'),v);
        /* The local cache is the thing every card reads, so it is updated too rather than waiting
           for the listener to come back - otherwise the preview below lags the picker. */
        const u=DB.getUser(me.id);if(u&&u.style)u.style.accent=v;
        toast('Accent saved.');
        try{PCard.repaintAll()}catch(_){}
      }catch(e){
        if(err)err.textContent=rulesHint(e,'accent colour');
      }
    };
    col.addEventListener('input',()=>{hex.value=col.value});
    col.addEventListener('change',()=>save(col.value));
    hex.addEventListener('change',()=>{const v=hex.value.trim();if(safeColor(v,''))col.value=v;save(v)});
    const rst=root.querySelector('#sxAccentReset');
    if(rst)rst.onclick=async()=>{
      if(err)err.textContent='';
      try{
        await remove(R('users/'+me.id+'/style/accent'));
        const u=DB.getUser(me.id);if(u&&u.style)delete u.style.accent;
        toast('Back to your message colour.');
        if(reopen)reopen('profile');
      }catch(e){if(err)err.textContent=rulesHint(e,'accent colour')}
    };
  }

  root.querySelectorAll('[data-sxtheme]').forEach(b=>b.onclick=async()=>{
    const v=b.dataset.sxtheme;
    const err2=root.querySelector('#sxThemeErr');if(err2)err2.textContent='';
    root.querySelectorAll('[data-sxtheme]').forEach(o=>o.classList.toggle('on',o===b));
    try{
      if(v)await set(R('users/'+me.id+'/style/theme'),v);
      else await remove(R('users/'+me.id+'/style/theme'));
      const u=DB.getUser(me.id);if(u&&u.style){if(v)u.style.theme=v;else delete u.style.theme}
      try{PCard.repaintAll()}catch(_){}
    }catch(e){if(err2)err2.textContent=rulesHint(e,'profile theme')}
  });

  root.querySelectorAll('[data-sxdeco]').forEach(b=>b.onclick=async()=>{
    const v=b.dataset.sxdeco;
    const err3=root.querySelector('#sxDecoErr');if(err3)err3.textContent='';
    root.querySelectorAll('[data-sxdeco]').forEach(o=>o.classList.toggle('on',o===b));
    try{
      if(v)await set(R('users/'+me.id+'/style/deco'),v);
      else await remove(R('users/'+me.id+'/style/deco'));
      const u=DB.getUser(me.id);if(u&&u.style){if(v)u.style.deco=v;else delete u.style.deco}
      try{PCard.repaintAll();DiscordShell.refresh();renderedKey=null;renderChat()}catch(_){}
    }catch(e){if(err3)err3.textContent=rulesHint(e,'avatar decoration')}
  });
}

/* A refused write is almost always one thing: the published rules are older than this build.
   Saying so beats showing somebody PERMISSION_DENIED. */
function rulesHint(e,what){
  const code=(e&&(e.code||e.message))||'';
  if(/permission|denied/i.test(String(code))){
    return isOwner(ME.id)
      ? 'Saving the '+what+' was refused. The published database rules are older than this build — republish firebase-rules.json (see the deployment notes in package.json ("comments" -> "deploy")).'
      : 'Saving the '+what+' was refused. This is a setup problem on the site, not something you did — tell an owner.';
  }
  return 'Could not save the '+what+' ('+String(code).slice(0,80)+').';
}

/* ======================================================================
 *  My Account: password change and the deletion flow
 * ====================================================================== */
function wireAccountExtras(root,me,reopen){
  const pw=root.querySelector('#sxPwSave');
  if(pw)pw.onclick=async()=>{
    const cur=root.querySelector('#sxPwCur');
    const a=root.querySelector('#sxPwNew'),b=root.querySelector('#sxPwNew2');
    const err=root.querySelector('#sxPwErr');err.textContent='';
    const c=cur?cur.value:'',v=a.value,v2=b.value;
    if(!c){err.textContent='Enter your current password.';return}
    if(v.length<CFG.MIN_PW){err.textContent='Use at least '+CFG.MIN_PW+' characters.';return}
    if(v!==v2){err.textContent='The two new passwords are different.';return}
    pw.disabled=true;pw.textContent='Changing\u2026';
    try{
      /* changePassword, NOT setPassword. setPassword is linkWithCredential - it ADDS password
         sign-in to a Google account and throws 'already set up' for everybody else, which is
         exactly what the first version of this button did to every password account. */
      await DB.changePassword(c,v);
      if(cur)cur.value='';a.value='';b.value='';
      toast('Password changed.');
    }catch(e){
      err.textContent=(e&&e.message)||'Could not change the password.';
    }
    pw.disabled=false;pw.textContent='Change password';
  };

  /* Deletion. The button stays disabled until the username is typed exactly - the one guard that
     reliably stops an accidental click, which is why every app that does this uses it. */
  const nameIn=root.querySelector('#sxDelName'),go=root.querySelector('#sxDelGo');
  if(nameIn&&go){
    nameIn.addEventListener('input',()=>{
      go.disabled=nameIn.value.trim().toLowerCase()!==String(me.username).toLowerCase();
    });
    go.onclick=()=>{
      const err=root.querySelector('#sxDelErr');err.textContent='';
      dconfirm({
        title:'Delete your account?',
        sub:'This is permanent. Your username is released, your profile is wiped, your login is removed and your messages in the main channels and DMs are deleted. There is no undo and no way to sign back in.',
        confirm:'Delete it',danger:true,
        onConfirm:async()=>{
          try{await deleteMyAccount(me)}
          catch(e){err.textContent=(e&&e.message)||'Could not finish deleting the account.';throw e}
        }
      });
    };
  }
}

/* The deletion itself. Ordered so that each step leaves the account in a state the next step can
   still act from, and so the IRREVERSIBLE one (removing the login) happens last. Every step is
   something the database rules let an account do to itself - nothing here needs an owner.

   What cannot be done from a browser, stated plainly rather than pretended: users/$id cannot be
   REMOVED (its own .write rule requires newData.exists(), on purpose - it is what stops an
   account being wiped out from under its messages), and idToUid cannot be unset. So the row
   survives as a deleted shell. That is the same state a banned account is left in, which is why
   the rest of the site already renders it as "Deleted User". */
async function deleteMyAccount(me){
  const id=me.id;
  const steps=[];

  /* 1. messages first, while we still have every read permission. */
  try{const r=await DB.purgeUserMessages(id);steps.push('messages: '+(r&&r.ok||0)+' deleted')}
  catch(e){steps.push('messages: could not be deleted ('+((e&&e.code)||'failed')+')')}

  /* 2. release the username so somebody else can have it. */
  try{await remove(R('usernames/'+String(me.username).toLowerCase()));steps.push('username released')}
  catch(e){steps.push('username could not be released ('+((e&&e.code)||'failed')+')')}
  try{await remove(R('usernameLogin/'+String(me.username).toLowerCase()))}catch(_){}

  /* 3. wipe the public and private halves of the profile. */
  try{await remove(R('users/'+id+'/style'));steps.push('profile wiped')}catch(_){}
  try{await remove(R('users/'+id+'/settings'))}catch(_){}
  // v54.1: email and settings moved to userPrivate/$id. Deleting an account has to take the
  // private half with it, or a deleted person's address would outlive their account.
  try{await remove(R('userPrivate/'+id))}catch(_){}
  try{await remove(R('users/'+id+'/email'))}catch(_){}
  try{await remove(R('activity/'+id))}catch(_){}
  try{await remove(R('notes/'+id))}catch(_){}
  try{await remove(R('connections/'+id))}catch(_){}
  try{await remove(R('achievements/'+id))}catch(_){}
  try{await remove(R('saved/'+id))}catch(_){}
  try{await remove(R('notifPrefs/'+id))}catch(_){}
  try{await remove(R('userBoosts/'+id))}catch(_){}

  /* 4. mark it deleted, which is what every other client reads to show "Deleted User". */
  try{await set(R('users/'+id+'/deleted'),true);steps.push('marked deleted')}
  catch(e){steps.push('could not be marked deleted ('+((e&&e.code)||'failed')+')')}

  /* 5. last, and irreversible: the login itself. */
  console.info('[delete account]',steps.join(' | '));
  try{
    const u=auth.currentUser;
    if(u)await deleteUser(u);
  }catch(e){
    /* Firebase refuses to delete a user whose sign-in is not recent. Everything above has already
       happened, so say exactly where things stand rather than implying nothing was done. */
    if(/recent|requires-recent-login/i.test(String((e&&e.code)||e&&e.message))){
      try{await DB.signOut()}catch(_){}
      throw new Error('Your profile has been wiped and your username released, but the browser '+
        'would not remove the login without a fresh sign-in. Sign in once more and delete again '+
        'to finish it off.');
    }
    try{await DB.signOut()}catch(_){}
    throw new Error('Your profile has been wiped and your username released, but the login could '+
      'not be removed ('+((e&&e.code)||'failed')+'). Tell an owner so they can finish it.');
  }
  toast('Your account has been deleted.');
  try{location.reload()}catch(_){}
}

/* ======================================================================
 *  Ignored users (a lighter block, kept on this device)
 * ====================================================================== */
const Ignored=(function(){
  const K='ich.ignored';
  function load(){try{return JSON.parse(localStorage.getItem(K)||'[]').map(Number).filter(Boolean)}catch(_){return []}}
  function save(a){try{localStorage.setItem(K,JSON.stringify([...new Set(a)].slice(0,500)))}catch(_){}}
  function list(){return load()}
  function has(id){return load().indexOf(Number(id))>=0}
  function add(id){const a=load();a.push(Number(id));save(a);repaint()}
  function del(id){save(load().filter(x=>x!==Number(id)));repaint()}
  function toggle(id){has(id)?del(id):add(id)}
  function repaint(){try{renderedKey=null;renderChat()}catch(_){}}
  return{list,has,add,del,toggle};
})();

function wireIgnored(root,me){
  const host=root.querySelector('#sxIgnList');if(!host)return;
  const paint=()=>{
    const ids=Ignored.list();
    if(!ids.length){host.innerHTML='<div class="hint">You haven’t ignored anybody.</div>';return}
    host.innerHTML='';
    ids.forEach(id=>{
      const u=DB.getUser(id)||{id,username:'User '+id};
      const row=document.createElement('div');
      row.className='sx-ign';
      row.innerHTML='<span class="sx-ign-av">'+avatarHtml(u,dispName(u,'User '+id),'width:28px;height:28px;font-size:12px')+'</span>'+
        '<span class="sx-ign-n">'+esc(dispName(u,'User '+id))+'</span>'+
        '<button type="button" class="btn sec small" data-unign="'+id+'">Stop ignoring</button>';
      host.appendChild(row);
    });
    host.querySelectorAll('[data-unign]').forEach(b=>b.onclick=()=>{Ignored.del(Number(b.dataset.unign));paint()});
  };
  paint();
}

/* ======================================================================
 *  Notifications
 * ====================================================================== */
function paintNotifState(root){
  const el=root.querySelector('#sxNotifState');
  if(el){
    const p=Notifier.permission();
    el.textContent=
      p==='unsupported'?'This browser does not do desktop notifications.':
      p==='granted'?(Prefs.get('desktopNotif')?'Allowed by your browser. Notifications only appear while this tab is in the background.':'Allowed by your browser, but switched off above.'):
      p==='denied'?'Your browser is blocking notifications for this site. Allow them from the padlock or icon next to the address bar, then switch this back on.':
      'Your browser has not been asked yet — switching this on will ask.';
  }
  const dn=root.querySelector('#sxDndNow');
  if(dn){
    let txt='';
    try{
      if(Prefs.quietHours())txt='Quiet right now — nothing will make a sound.';
      else if(Prefs.get('dndOn'))txt='Not in the quiet window at the moment.';
    }catch(_){}
    dn.textContent=txt;
  }
}

function wireNotifications(root,me){
  paintNotifState(root);
  const t=root.querySelector('#sxNotifTest');
  if(t)t.onclick=async()=>{
    if(Notifier.permission()!=='granted'){
      const p=await Notifier.request();
      paintNotifState(root);
      if(p!=='granted'){toast('Your browser did not allow it.','bad');return}
    }
    Notifier.ping();
    /* show() deliberately does nothing while the tab is focused, which is exactly when somebody
       presses a test button - so the test says what would happen instead of silently no-opping. */
    const n=Notifier.show('Itsukis Chat Hub','This is what a notification looks like.','test');
    toast(n?'Sent.':'Sound played. A desktop notification only appears when this tab is in the background — switch away and a real message will show one.');
  };

  const host=root.querySelector('#sxNotifServers');
  if(!host)return;
  const paint=()=>{
    let servers=[];
    try{servers=DModel.myServers()}catch(_){}
    if(!servers.length){host.innerHTML='<div class="hint">No servers yet.</div>';return}
    host.innerHTML='';
    servers.forEach(srv=>{
      const lvl=NotifPrefs.serverLevel(srv.id);
      const row=document.createElement('div');
      row.className='sx-notif';
      const chans=(()=>{try{return DModel.channels(srv.id).filter(c=>c.type!=='voice')}catch(_){return []}})();
      /* v54.9: c.key, not c.id — the identifier overrides are stored under. With c.id this
         list was always empty and the ✕ cleared a path nothing was ever written to. */
      const overrides=chans.filter(c=>c.key&&NotifPrefs.channelLevel(c.key));
      row.innerHTML=
        '<div class="sx-notif-top">'+
          '<span class="sx-notif-n">'+esc(srv.name)+'</span>'+
          '<select data-sxsrv="'+esc(srv.id)+'">'+
            '<option value=""'+(lvl?'':' selected')+'>Default</option>'+
            NotifPrefs.LEVELS.map(l=>'<option value="'+l+'"'+(lvl===l?' selected':'')+'>'+esc(NotifPrefs.LABEL[l])+'</option>').join('')+
          '</select>'+
        '</div>'+
        (overrides.length
          ?'<div class="sx-notif-ch">'+overrides.map(c=>
              '<span class="sx-notif-chip">#'+esc(c.name)+' · '+esc(NotifPrefs.LABEL[NotifPrefs.channelLevel(c.key)])+
              ' <button type="button" data-sxchclear="'+esc(c.key)+'" title="Back to default" aria-label="Back to default">✕</button></span>').join('')+
            '</div>'
          :'');
      host.appendChild(row);
    });
    /* v54.9: DM overrides. A conversation has a message key and no server, so it could never
       appear under any server row — which meant a muted DM was invisible in Settings and could
       only be un-muted from the conversation's own menu. */
    const dmKeys=NotifPrefs.mutedChannels().concat(
      Object.keys((NotifPrefs.allChannels&&NotifPrefs.allChannels())||{}))
      .filter(k=>String(k).startsWith('dm_'));
    const dms=[...new Set(dmKeys)];
    if(dms.length){
      const row=document.createElement('div');
      row.className='sx-notif';
      row.innerHTML='<div class="sx-notif-top"><span class="sx-notif-n">Direct messages</span></div>'+
        '<div class="sx-notif-ch">'+dms.map(k=>{
          const other=String(k).replace(/^dm_/,'').split('_').map(Number).find(n=>n!==Number(ME.id));
          let nm='Conversation';
          try{const u=DB.getUser(other);if(u&&!u.deleted)nm=dispName(u)}catch(_){}
          return '<span class="sx-notif-chip">'+esc(nm)+' · '+esc(NotifPrefs.LABEL[NotifPrefs.channelLevel(k)]||'Default')+
            ' <button type="button" data-sxchclear="'+esc(k)+'" title="Back to default" aria-label="Back to default">✕</button></span>';
        }).join('')+'</div>';
      host.appendChild(row);
    }
    host.querySelectorAll('[data-sxsrv]').forEach(sel=>sel.onchange=async()=>{
      try{await NotifPrefs.setServer(sel.dataset.sxsrv,sel.value);paint()}
      catch(e){toast(rulesHint(e,'notification setting'),'bad')}
    });
    host.querySelectorAll('[data-sxchclear]').forEach(b=>b.onclick=async()=>{
      try{await NotifPrefs.setChannel(b.dataset.sxchclear,'');paint()}
      catch(e){toast(rulesHint(e,'notification setting'),'bad')}
    });
  };
  paint();
}

/* ======================================================================
 *  Connections
 * ====================================================================== */
function wireConnections(root,me){
  const host=root.querySelector('#sxConnList');if(!host)return;
  const err=root.querySelector('#sxConnErr');

  /* Draws from a FRESH read, not from the cache: this pane is where connections are added and
     removed, so it is the one place that must never show a stale list. */
  const paint=async()=>{
    let list=[];try{list=await PConn.load(me.id)}catch(_){}
    if(!list.length){host.innerHTML='<div class="hint">Nothing linked yet.</div>';return}
    host.innerHTML='';
    list.forEach(c=>{
      const k=PConn.BY_ID[c.kind]||PConn.BY_ID.other;
      const row=document.createElement('div');
      row.className='sx-conn';
      row.innerHTML=
        '<span class="pf-conn-ic" style="--cc:'+esc(k.col)+'">'+esc(k.ic)+'</span>'+
        '<span class="sx-conn-b"><b>'+esc(c.name)+'</b><small>'+esc(k.name)+(c.url?' · '+esc(c.url):'')+'</small></span>'+
        '<label class="sx-conn-hide"><input type="checkbox" data-sxchide="'+esc(c.cid)+'"'+(c.hide?' checked':'')+'> Hidden</label>'+
        '<button type="button" class="btn sec small" data-sxcdel="'+esc(c.cid)+'">Remove</button>';
      host.appendChild(row);
    });
    host.querySelectorAll('[data-sxcdel]').forEach(b=>b.onclick=async()=>{
      b.disabled=true;
      try{await PConn.del(b.dataset.sxcdel);paint();try{PCard.repaintAll()}catch(_){}}
      catch(e){if(err)err.textContent=rulesHint(e,'connection');b.disabled=false}
    });
    host.querySelectorAll('[data-sxchide]').forEach(cb=>cb.onchange=async()=>{
      const cid=cb.dataset.sxchide;
      const rec=(PConn.of(me.id)||[]).find(x=>x.cid===cid);
      if(!rec)return;
      try{await PConn.save(cid,{kind:rec.kind,name:rec.name,url:rec.url,hide:cb.checked});paint()}
      catch(e){if(err)err.textContent=rulesHint(e,'connection');cb.checked=!cb.checked}
    });
  };
  paint();

  const add=root.querySelector('#sxConnAdd');
  if(add)add.onclick=()=>{
    const m=dmodal({
      title:'Add a connection',
      body:'<div class="field"><label>Type</label><select id="cnKind">'+
             PConn.KINDS.map(k=>'<option value="'+esc(k.id)+'">'+esc(k.name)+'</option>').join('')+
           '</select></div>'+
           '<div class="field"><label>Name or handle</label><input id="cnName" maxlength="60" placeholder="e.g. suki#0001" autocomplete="off"></div>'+
           '<div class="field"><label>Link (optional, must start with https://)</label><input id="cnUrl" maxlength="200" placeholder="https://..." autocomplete="off" spellcheck="false"></div>'+
           '<div class="hint">Nothing is verified. This is a label you are putting on your own profile.</div>'+
           '<div class="err" id="cnErr"></div>',
      /* dmodal's option is `footer`, not `foot` - `foot` is the property it hands BACK on the
         returned api. Getting that wrong leaves an empty footer and no buttons at all. */
      footer:'<button class="btn sec" data-close>Cancel</button><button class="btn" data-go>Add</button>'
    });
    const go=m.foot.querySelector('[data-go]');
    m.foot.querySelector('[data-close]').onclick=m.close;
    go.onclick=async()=>{
      const e2=m.body.querySelector('#cnErr');e2.textContent='';
      go.disabled=true;
      try{
        await PConn.save(null,{
          kind:m.body.querySelector('#cnKind').value,
          name:m.body.querySelector('#cnName').value,
          url:m.body.querySelector('#cnUrl').value
        });
        m.close();paint();try{PCard.repaintAll()}catch(_){}
      }catch(err2){e2.textContent=(err2&&err2.message)||rulesHint(err2,'connection');go.disabled=false}
    };
  };
}

/* ======================================================================
 *  Devices & Sessions
 * ====================================================================== */
function wireSessions(root,me){
  const dev=root.querySelector('#sxThisDevice');
  if(dev){
    const rows=[];
    const add=(k,v)=>rows.push('<div class="sx-dev-r"><span>'+esc(k)+'</span><b>'+esc(String(v))+'</b></div>');
    add('Build',(typeof MY_BUILD!=='undefined'&&MY_BUILD)||'unknown');
    add('Screen',(window.innerWidth||0)+' × '+(window.innerHeight||0));
    try{add('Platform',navigator.platform||'unknown')}catch(_){}
    try{add('Browser',browserName())}catch(_){}
    try{add('Language',navigator.language||'unknown')}catch(_){}
    try{add('Time zone',Intl.DateTimeFormat().resolvedOptions().timeZone||'unknown')}catch(_){}
    try{add('Touch',('ontouchstart' in window)?'yes':'no')}catch(_){}
    try{add('Window',pageIsAddressable()?'normal tab':'launcher window (about:blank)')}catch(_){}
    dev.innerHTML=rows.join('');
  }

  const info=root.querySelector('#sxSessInfo');
  if(info){
    info.innerHTML='<div class="sx-dev-r"><span>Active session</span><b>checking…</b></div>';
    (async()=>{
      try{
        const sn=await get(R('sessions/'+me.id));
        const v=sn.val();
        const when=v&&Number(v.at)?new Date(Number(v.at)).toLocaleString():null;
        info.innerHTML='<div class="sx-dev-r"><span>Active session</span><b>'+
          (v?'this account is signed in somewhere':'none recorded')+'</b></div>'+
          (when?'<div class="sx-dev-r"><span>Claimed</span><b>'+esc(when)+'</b></div>':'');
      }catch(e){
        info.innerHTML='<div class="sx-dev-r"><span>Active session</span><b>could not be read</b></div>';
      }
    })();
  }

  const claim=root.querySelector('#sxSessClaim');
  if(claim)claim.onclick=()=>{
    claim.disabled=true;
    try{DB.reconnectSession();toast('This device is now the active session. Any other tab has been signed out of chat.')}
    catch(e){toast((e&&e.message)||'Could not claim the session.','bad')}
    setTimeout(()=>{claim.disabled=false},2500);
  };

  const so=root.querySelector('#sxSignOut2');
  if(so)so.onclick=()=>{DB.signOut()};
}

function browserName(){
  const u=navigator.userAgent||'';
  if(/Edg\//.test(u))return 'Edge';
  if(/OPR\//.test(u))return 'Opera';
  if(/Chrome\//.test(u))return 'Chrome';
  if(/Firefox\//.test(u))return 'Firefox';
  if(/Safari\//.test(u))return 'Safari';
  return 'unknown';
}

/* ======================================================================
 *  Advanced: diagnostics and cache
 * ====================================================================== */
function wireAdvanced(root,me){
  const diag=root.querySelector('#sxDiag');
  const paintDiag=()=>{
    if(!diag)return;
    const L=[];
    const add=(k,v)=>L.push([k,String(v)]);
    add('build',(typeof MY_BUILD!=='undefined'&&MY_BUILD)||'unknown');
    add('user id','#'+me.id);
    try{add('rank',isOwner(me.id)?'owner':isAdmin(me.id)?'admin':isMod(me.id)?'mod':'member')}catch(_){}
    try{add('tier',DB.isMvp(me.id)?'mvp':(DB.vipInfo(me.id)?'vip':'none'))}catch(_){}
    try{add('servers',DModel.myServers().length)}catch(_){}
    try{add('friends',(DB.friends(me.id)||[]).length)}catch(_){}
    try{add('online now',DB.onlineCount())}catch(_){}
    try{add('clock skew',SKEW+'ms')}catch(_){}
    /* The figure that decides whether this install stays inside the free plan. The whole users
       node is downloaded on every sign-in; most of it is avatars stored inline as base64. */
    try{
      const b=Number(DB._usersBytes)||0;
      if(b){
        const mb=b/1048576;
        add('user table download',mb.toFixed(2)+' MB for '+(DB._usersCount||0)+' accounts');
        const img=Number(DB._usersImageBytes)||0;
        add('…of which avatars/banners',(img/1048576).toFixed(2)+' MB ('+
          Math.round(100*img/Math.max(1,b))+'% of it, '+(DB._usersWithAvatar||0)+' accounts)');
        /* 10 GB/month is the Spark plan's download allowance. */
        add('sign-ins per month on Spark',Math.floor(10240/Math.max(0.01,mb))+' before the 10 GB cap');
      }
    }catch(_){}
    try{add('channel',view.roomKey||'none')}catch(_){}
    try{add('server',view.sid||'none')}catch(_){}
    try{add('notifications',Notifier.permission())}catch(_){}
    try{add('storage uploads',(typeof window.FBS!=='undefined'&&window.FBS)?'loaded':'unavailable')}catch(_){}
    try{add('addressable page',pageIsAddressable()?'yes':'no (launcher window)')}catch(_){}
    try{add('reduced motion',Prefs.get('reduceMotion')?'on':'off')}catch(_){}
    try{add('anti-lag',AntiLag.on()?'on':'off')}catch(_){}
    add('browser',browserName()+' · '+(navigator.platform||'?'));
    add('viewport',(window.innerWidth||0)+'×'+(window.innerHeight||0));
    diag.innerHTML=L.map(([k,v])=>'<div class="sx-dev-r"><span>'+esc(k)+'</span><b>'+esc(v)+'</b></div>').join('');
    diag.dataset.text=L.map(([k,v])=>k+': '+v).join('\n');
  };
  paintDiag();
  const rf=root.querySelector('#sxDiagRefresh');if(rf)rf.onclick=paintDiag;
  const cp=root.querySelector('#sxDiagCopy');
  if(cp)cp.onclick=()=>copyText((diag&&diag.dataset.text)||'').then(ok=>toast(ok?'Diagnostics copied':'Could not copy',ok?'':'bad'));

  const ci=root.querySelector('#sxCacheInfo');
  const paintCache=()=>{
    if(!ci)return;
    let n=0,bytes=0;
    try{
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);if(!k||k.indexOf('ich.')!==0)continue;
        n++;bytes+=(k.length+(localStorage.getItem(k)||'').length)*2;
      }
    }catch(_){}
    ci.textContent=n+' item'+(n===1?'':'s')+' kept in this browser, about '+Math.max(1,Math.round(bytes/1024))+' KB.';
  };
  paintCache();
  const cc=root.querySelector('#sxCacheClear');
  if(cc)cc.onclick=()=>{
    dconfirm({
      title:'Clear this device’s cache?',
      sub:'Removes what this browser keeps: appearance choices saved locally, drafts, the note cache, ignored users and dismissed banners. Your account is untouched — everything saved to it comes back when the page reloads.',
      confirm:'Clear it',
      onConfirm:async()=>{
        try{
          const kill=[];
          for(let i=0;i<localStorage.length;i++){
            const k=localStorage.key(i);
            if(k&&k.indexOf('ich.')===0&&k!=='ich.sid')kill.push(k);
          }
          kill.forEach(k=>{try{localStorage.removeItem(k)}catch(_){}});
          toast('Cleared '+kill.length+' item'+(kill.length===1?'':'s')+'. Reloading…');
          setTimeout(()=>location.reload(),700);
        }catch(e){toast('Could not clear it ('+((e&&e.message)||'failed')+')','bad')}
      }
    });
  };
  const cr=root.querySelector('#sxCacheReload');
  if(cr)cr.onclick=()=>location.reload();

  const rl=root.querySelector('#sxResetLook');
  if(rl)rl.onclick=()=>{
    dconfirm({
      title:'Reset appearance?',
      sub:'Puts the Appearance and Accessibility settings back to their defaults. Your colours, avatar, banner and profile are not touched.',
      confirm:'Reset',
      onConfirm:async()=>{
        await Prefs.reset();
        toast('Appearance reset.');
        try{renderedKey=null;renderChat()}catch(_){}
        openSettings(false,'ui');
      }
    });
  };
}
