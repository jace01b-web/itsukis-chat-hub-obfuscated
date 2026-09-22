const admin=require('firebase-admin');
admin.initializeApp({
  credential:admin.credential.cert(require('./serviceAccount.json')),
  databaseURL:'https://itsuki-chat-default-rtdb.firebaseio.com'
});

const id=process.argv[2];
const doBan=process.argv.includes('--ban');
const doUnban=process.argv.includes('--unban');
const muteIdx=process.argv.indexOf('--mute');
const doMute=muteIdx!==-1;
const muteSpec=doMute?process.argv[muteIdx+1]:null;
const doUnmute=process.argv.includes('--unmute');
if(!id){console.log('Usage: node ban-user.js <userId> [--ban|--unban|--mute <1d2h30m>|--unmute]');process.exit(1)}

function parseMuteDuration(spec){
  if(!spec)return 0;
  const re=/(\d+)\s*(d|h|m|s)/gi;
  let ms=0,m;
  while((m=re.exec(spec))){
    const n=Number(m[1]);
    ms+=({d:86400000,h:3600000,m:60000,s:1000})[m[2].toLowerCase()]*n;
  }
  return ms;
}

(async()=>{
  const db=admin.database();

  if(doUnban){
    await db.ref('banned/'+id).remove();
    console.log('User #'+id+' unbanned (write access restored; still shows as "Deleted User" until they set a new username).');
    process.exit(0);
  }

  if(doUnmute){
    await db.ref('muted/'+id).remove();
    console.log('User #'+id+' unmuted.');
    process.exit(0);
  }

  if(doMute){
    const ms=Math.min(parseMuteDuration(muteSpec),30*24*60*60*1000);
    if(!ms){console.log('Give a duration like 1d, 2h30m, 10m, 45s.');process.exit(1)}
    const until=Date.now()+ms;
    await db.ref('muted/'+id).set(until);
    console.log('User #'+id+' muted until '+new Date(until).toISOString()+' ('+muteSpec+').');
    process.exit(0);
  }

  const uSnap=await db.ref('users/'+id).get();
  if(!uSnap.exists()){console.log('No user with id '+id);process.exit(1)}
  const u=uSnap.val();
  const oldKey=(u.username||'').toLowerCase();

  console.log('About to ban #'+id+' ("'+u.username+'")');
  console.log('  - mark deleted:true, username -> "Deleted User"');
  console.log('  - release username "'+oldKey+'" for reuse by others');
  console.log('  - block all future writes via banned/'+id);
  console.log('  - keep their numeric ID retired forever (idToUid/uidToId untouched)');
  console.log('  - delete every message they sent (global + all rooms + all DMs)');

  if(!doBan){console.log('\\n(dry run — pass --ban to actually do this)');process.exit(0)}

  const upd={};
  upd['users/'+id+'/deleted']=true;
  upd['users/'+id+'/username']='Deleted User';
  upd['banned/'+id]=true;
  if(oldKey){
    upd['usernames/'+oldKey]=null;        // free the name for someone else to claim
    upd['usernameLogin/'+oldKey]=null;
  }
  upd['onlineUsers/'+id]=null;

  // cascade delete: global
  const gSnap=await db.ref('messages/global').get();
  let removed=0;
  (function scan(val,prefix){
    if(!val)return;
    Object.entries(val).forEach(([mid,msg])=>{
      if(Number(msg.senderId)===Number(id)){upd[prefix+mid]=null;removed++}
    });
  })(gSnap.val(),'messages/global/');

  // cascade delete: every room + every DM
  const allMsgs=await db.ref('messages').get();
  const msgsVal=allMsgs.val()||{};
  for(const key of Object.keys(msgsVal)){
    if(key==='global')continue;
    const bucket=msgsVal[key];
    Object.entries(bucket||{}).forEach(([mid,msg])=>{
      if(Number(msg.senderId)===Number(id)){upd['messages/'+key+'/'+mid]=null;removed++}
    });
  }

  await db.ref().update(upd);
  console.log('\\nDone. '+removed+' messages deleted, account frozen as "Deleted User".');

  try{
    const uidSnap=await db.ref('uidToId').orderByValue().equalTo(Number(id)).get();
    const uid=Object.keys(uidSnap.val()||{})[0];
    if(uid){
      await admin.auth().revokeRefreshTokens(uid);
      console.log('Revoked live session token for uid '+uid+'.');
    }else{
      console.log('Could not find a Firebase Auth uid for #'+id+' — skipping token revoke.');
    }
  }catch(e){console.log('Token revoke failed:',e.code||e.message)}
  process.exit(0);
})();
