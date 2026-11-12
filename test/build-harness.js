/* test/build-harness.js
 * Generates test/harness.html: the real site, inlined exactly the way build-single.js does it,
 * except window.FB comes from test/fake-firebase.js instead of the live Firebase SDK.
 *
 * Development only - not referenced by the site.
 *     node test/build-harness.js
 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.join(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

const sandbox={window:{}};
vm.runInNewContext(rd('js/manifest.js'),sandbox);
const M=sandbox.window.APP_MANIFEST;
const safe=t=>t.replace(/<\/script/gi,'<\\/script');

// same two extra groups build-single.js uses
const EARLY=['js/early/anti-lag-boot.js'];
const LATE=[
  'js/ui/auth-card-motion.js','js/core/crash-catcher.js','js/ui/extras-download-launcher.js',
  'js/ui/mobile-sidebar.js','js/features/voice-channel.js'
];

const missing=[...EARLY,...LATE,...M.js.map(f=>'js/'+f),...M.css.map(f=>'css/'+f)]
  .filter(p=>!fs.existsSync(path.join(ROOT,p)));
if(missing.length)throw new Error('listed but missing:\n  '+missing.join('\n  '));

const css=M.css.map(f=>rd('css/'+f)).join('\n');
const appCode=LATE.map(f=>rd(f)).join('\n')+'\n'+M.js.map(f=>rd('js/'+f)).join('\n');

let html=rd('index.html');
const START='<!-- RAW-BOOTSTRAP:START',END='<!-- RAW-BOOTSTRAP:END -->';
const a=html.indexOf(START),b=html.indexOf(END);
if(a<0||b<0)throw new Error('RAW-BOOTSTRAP markers not found');

const inlined=
  '<style>\n'+css+'\n</style>\n'+
  '<script>\n'+safe(rd('test/fake-firebase.js'))+'\n</script>\n'+
  '<script>\n'+safe(EARLY.map(f=>rd(f)).join('\n'))+'\n'+
  'try{window.ICHBoot.step("js");window.ICHBoot.prog(60);window.ICHBoot.reveal()}'+
  'catch(e){document.documentElement.classList.remove("booting")}\n</script>\n'+
  /* A <script type="module">, exactly like dist/index.single.html. Modules are deferred by
     spec, so this runs AFTER the document is parsed and <body> always exists. An inline
     non-module script would run inside <head> instead (defer is ignored on inline scripts) and
     would give the harness failure modes production does not have.
     The app's top-level `const`s are scoped to this module, same as in the real build, so the
     driver is handed explicit references. */
  '<script type="module">\n'+
  /* Guard: starting the app twice builds a SECOND set of module closures over the same fake
     database, and the two then fight over sessions/$myId and kick each other off with the
     "signed in somewhere else" overlay. A page that is written into about:blank auto-starts
     (no ?manual in the query) and the test then calls __APP_START again, which is exactly how
     that happened. One boot per page, always. */
  'window.__APP_START=function(){\n'+
  'if(window.__APP_STARTED)return;window.__APP_STARTED=true;\n'+safe(appCode)+'\n'+
  'window.__T={DModel,DB,CFG,openShop,openServerSettings,openAddServer,openCreateServer,'+
  'openJoinServer,openInvite,openCreateChannel,openChannelSettings,openMemberManager,'+
  'openNav,closeNav,openMembersDrawer,closeMembersDrawer,toggleNav,dmodal,openCtx,'+
  /* v54.6: the server menu, so a suite can check that the entries a site owner is
     entitled to are actually OFFERED. A permission the model grants and no button
     reaches is the bug this export exists to catch. */
  'openServerMenu,closeCtx,'+
  'isOwner,isMod,isAdmin,isMvp,selectRoom,renderChat,openChat,goHome,refreshBadge,'+
  'openSettings,modalGameHubs,openSpin,openUserProfile,openAccount,'+
  'serverLockReason,openDiscover,inviteUrl,readInviteFromUrl,clearInviteFromUrl,'+
  'serverIconFromFile,serverIconPicker,openBanDialog,openTimeoutDialog,handleInviteLink,'+
  'DiscordShell,show,modalTos,pageIsAddressable,'+
  'DBoost,openBoostDialog,boostersGrouped,mdRender,dispName,outranks,siteRank,'+
  /* v54 */
  'Prefs,PCard,PData,PBadges,PMutual,PActivity,PNotes,PConn,PAch,ACHIEVEMENTS,'+
  'NotifPrefs,Notifier,Ignored,PROFILE_DECOS,PROFILE_THEMES,'+
  'DAudit,SEmoji,SEvents,SWelcome,SRV_EXTRA,emojiizeHTML,closeServerSettings,'+
  'DPins,DSaved,DPolls,QuickSwitch,openPinsPanel,openSavedPanel,openSearchPanel,openPollComposer,'+
  'chipifyHTML,push,R,set,get,remove,update,updateMentionPop,extractPings,'+
  /* v54.1 security patch */
  'NSFW,'+
  /* v54.4: the profile-status suite needs the status resolver. dispName is already exported
     above, for the member-list-at-scale suite. */
  'pfStatus,'+
  /* v54.5: message requests. The suite drives the real entry points rather than the model,
     because the point of the feature is what the UI does with a non-friend. */
  'openDmWith,send,renderDmRequests,dmSortedFriends,dmPartnerOf,'+
  /* v54.5: the filter defaults. These are plain predicates and the only way to assert what
     a fresh account actually sees. */
  'myFilterOn,filterMsgEnabled,filterNamesOn,displayMsgText,'+
  'get view(){return view},get ME(){return ME}};\n};\n'+
  /* about:blank has no query string, so ?manual cannot be expressed there. A page written into
     about:blank is always driven by the test (seed -> sign in -> start), so it must not boot
     itself first against an empty database. */
  "if(!location.search.includes('manual')&&location.href.indexOf('about:blank')!==0)window.__APP_START();\n"+
  '</script>';

html=html.slice(0,a)+'<!-- TEST HARNESS: fake Firebase + inlined app -->\n'+inlined+html.slice(b+END.length);
fs.mkdirSync(path.join(ROOT,'test'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'test/harness.html'),html);
console.log('wrote test/harness.html ('+Math.round(html.length/1024)+' KB)');
