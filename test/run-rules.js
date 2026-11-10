/* test/run-rules.js
 * Runs the database rules through targaryen (a real implementation of the Realtime Database
 * rules language) and asserts the staff ladder the v53 change introduced:
 *
 *     owner 4  >  admin 3  >  mod 2  >  everyone 1
 *
 * and you may delete someone else's message only if you are STRICTLY above them. Before v53 the
 * rule tested only the ranks above the actor, so admin-on-admin and mod-on-mod both passed.
 *
 *     npm i --no-save targaryen && node test/run-rules.js
 *
 * Development only - not referenced by the site.
 */
const targaryen=require('targaryen');
const path=require('path');
const rules=require(path.join(__dirname,'..','firebase-rules.json'));
const NOW=Date.now();
const data={
  uidToId:{uidO:1,uidA:2,uidA2:3,uidM:4,uidM2:5,uidU:6},
  idToUid:{1:'uidO',2:'uidA',3:'uidA2',4:'uidM',5:'uidM2',6:'uidU'},
  owners:{1:1}, admin:{2:1,3:1}, mods:{4:1,5:1}, banned:{},
  users:{1:{username:'o'},2:{username:'a'},3:{username:'a2'},4:{username:'m'},5:{username:'m2'},6:{username:'u'}},
  messages:{global:{
    mOwner:{senderId:1,text:'x',at:NOW}, mAdmin:{senderId:2,text:'x',at:NOW},
    mAdmin2:{senderId:3,text:'x',at:NOW}, mMod:{senderId:4,text:'x',at:NOW},
    mMod2:{senderId:5,text:'x',at:NOW}, mUser:{senderId:6,text:'x',at:NOW}
  }},
  roomMembers:{}, dmMembers:{}, muted:{}, rooms:{}
};
function del(uid,msg){
  const d=targaryen.database(rules,data,NOW).as({uid});
  const r=d.write('messages/global/'+msg,null,undefined,NOW);
  return r.allowed;
}
const cases=[
  ['owner deletes admin msg',   'uidO','mAdmin', true],
  ['owner deletes own msg',     'uidO','mOwner', true],
  ['admin deletes user msg',    'uidA','mUser',  true],
  ['admin deletes mod msg',     'uidA','mMod',   true],
  ['admin deletes OTHER admin', 'uidA','mAdmin2',false],
  ['admin deletes own msg',     'uidA','mAdmin', true],
  ['admin deletes owner msg',   'uidA','mOwner', false],
  ['mod deletes user msg',      'uidM','mUser',  true],
  ['mod deletes OTHER mod',     'uidM','mMod2',  false],
  ['mod deletes own msg',       'uidM','mMod',   true],
  ['mod deletes admin msg',     'uidM','mAdmin', false],
  ['user deletes own msg',      'uidU','mUser',  true],
  ['user deletes other msg',    'uidU','mMod',   false],
];
let bad=0;
for(const [name,uid,msg,want] of cases){
  const got=del(uid,msg);
  const ok=got===want;
  if(!ok)bad++;
  console.log((ok?'  PASS  ':'  FAIL  ')+name.padEnd(28)+' expected '+want+', got '+got);
}
console.log(bad?('\n'+bad+' FAILED'):'\nall '+cases.length+' delete-ladder cases pass');
process.exit(bad?1:0);
