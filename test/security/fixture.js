/* test/security/fixture.js
 *
 * The database snapshot every security test runs against. It mirrors the REAL v54 structure -
 * same node names, same shapes, same flattened permission cache - because a rules test against
 * an invented structure proves nothing about the rules that ship.
 *
 * THE CAST
 *   uidOwner  / id 1   site owner      (owners/1 = 1)
 *   uidMod    / id 2   site moderator  (mods/2 = 1)
 *   uidAlice  / id 3   owns server srvA
 *   uidBob    / id 4   member of srvA, holds the Mod role there (manageMsg + kick)
 *   uidEve    / id 5   member of srvA, no roles                 <- the attacker
 *   uidMal    / id 6   NOT in srvA; owns srvB                   <- the outsider
 *   uidVic    / id 7   friend of Bob, in a DM with him          <- the bystander
 *   (unauthenticated)                                           <- anon
 *
 * Nothing here is a real account and no password or token appears in it.
 */
'use strict';

const NOW = 1762800000000;      // fixed, so "too far in the future" tests are deterministic
const DAY = 86400000;

const UID = {
  owner:'uidOwner', mod:'uidMod', alice:'uidAlice',
  bob:'uidBob', eve:'uidEve', mal:'uidMal', vic:'uidVic'
};
const ID = { owner:1, mod:2, alice:3, bob:4, eve:5, mal:6, vic:7 };

/* Every permission the rules know about, as the client's syncPerms() would flatten it. */
const ALL_PERMS = ['admin','view','manageCh','manageRoles','manageSrv','invite','changeNick',
  'manageNick','kick','ban','timeout','send','files','react','history','mentionAll','manageMsg',
  'voiceJoin','voiceSpeak','voiceMute','manageEmoji','manageEvents','viewAudit'];

/* The rules accept ONLY data:image/jpeg for an avatar. Worth knowing before concluding that
   "set my own avatar" is broken. */
const JPEG = 'data:image/jpeg;base64,' + 'A'.repeat(2000);

const BASE_PERMS = {view:true, send:true, react:true, history:true, voiceJoin:true, voiceSpeak:true};
function perms(extra){ return Object.assign({}, BASE_PERMS, extra||{}); }
function allPerms(){ const o={}; ALL_PERMS.forEach(p=>o[p]=true); return o; }

function user(id, username, extra){
  return Object.assign({
    username, createdAt: NOW - 400*DAY, lastNameChange: 0, provider:'password',
    style:{ displayName:username[0].toUpperCase()+username.slice(1), status:'online' },
    settings:{ density:'cozy', meBubble:'#5865f2' }
  }, extra||{});
}

function data(){
  return {
    /* ---- identity core ---- */
    counters:{ userId: 7 },
    uidToId:{ uidOwner:1, uidMod:2, uidAlice:3, uidBob:4, uidEve:5, uidMal:6, uidVic:7 },
    idToUid:{ 1:'uidOwner', 2:'uidMod', 3:'uidAlice', 4:'uidBob', 5:'uidEve', 6:'uidMal', 7:'uidVic' },
    usernames:{ owner:1, mod:2, alice:3, bob:4, eve:5, mal:6, vic:7 },
    usernameLogin:{
      owner:{email:'owner@itsuki.local'}, mod:{email:'mod@itsuki.local'},
      /* alice signed up with a REAL email - this is what makes the usernameLogin read matter */
      alice:{email:'alice.real.address@gmail.com'},
      bob:{email:'bob@itsuki.local'}, eve:{email:'eve@itsuki.local'},
      mal:{email:'mal@itsuki.local'}, vic:{email:'vic@itsuki.local'}
    },

    /* ---- site ranks ---- */
    owners:{ 1:1 }, secretowner:{}, admin:{}, mods:{ 2:1 },
    banned:{}, muted:{}, ipBans:{},
    vip:{}, mvp:{}, flair:{}, customroles:{},
    userBoosts:{}, serverBoosts:{},

    users:{
      1:user(1,'owner'), 2:user(2,'mod'), 3:user(3,'alice',{email:'alice.real.address@gmail.com'}),
      4:user(4,'bob'), 5:user(5,'eve'), 6:user(6,'mal'), 7:user(7,'vic')
    },

    /* v54.1: where email and settings live after the privacy split. Alice is the interesting
       one - she signed up with a real address, so she is what the exposure was about. The
       `users` records above still carry the legacy copies on purpose, because that is the
       state of a database that has not been migrated yet. */
    userPrivate:{
      3:{ email:'alice.real.address@gmail.com', settings:{ density:'cozy', bgImage:'' } },
      5:{ email:'eve@itsuki.local',             settings:{ density:'compact' } }
    },

    /* ---- servers ---- */
    servers:{
      srvA:{ name:'Alice Guild', ownerId:3, createdAt:NOW-100*DAY, icon:'AG', sys:false },
      srvB:{ name:'Mal Guild',   ownerId:6, createdAt:NOW-50*DAY,  icon:'MG', sys:false }
    },
    serverDiscovery:{ srvB:{ name:'Mal Guild', at:NOW-50*DAY } },   /* srvB is public, srvA is not */
    serverOrder:{},
    userServers:{ 3:{srvA:true}, 4:{srvA:true}, 5:{srvA:true}, 6:{srvB:true} },

    serverRoles:{
      srvA:{
        everyone:{ name:'everyone', pos:0, perms:BASE_PERMS },
        rMod:{ name:'Mod', pos:5, color:'#5865f2', perms:{manageMsg:true, kick:true} }
      },
      srvB:{ everyone:{ name:'everyone', pos:0, perms:BASE_PERMS } }
    },
    serverMembers:{
      srvA:{
        3:{ at:NOW-100*DAY, p:allPerms() },
        4:{ at:NOW-40*DAY, roles:{rMod:true}, p:perms({manageMsg:true, kick:true}) },
        5:{ at:NOW-10*DAY, p:perms() }
      },
      srvB:{ 6:{ at:NOW-50*DAY, p:allPerms() } }
    },
    serverChannels:{
      srvA:{ chGen:{ name:'general', key:'chGen', type:'text', pos:0 },
             chVoice:{ name:'Voice', key:'chVoice', type:'voice', pos:1 } },
      srvB:{ chB:{ name:'general', key:'chB', type:'text', pos:0 } }
    },
    channelServer:{ chGen:'srvA', chVoice:'srvA', chB:'srvB' },
    serverCats:{}, serverBans:{}, serverMutes:{}, serverIpBans:{},
    invites:{}, inviteCodes:{},

    /* ---- channels and messages ---- */
    rooms:{},
    /* Server channels gate sending on roomMembers/<channelKey>/<id>, which the client writes
       through DModel.grantAccess(sid) when you open the server. Without it a legitimate member
       cannot post - which looks like a broken rule and is not one. */
    roomMembers:{ chGen:{3:true,4:true,5:true}, chVoice:{3:true,4:true,5:true}, chB:{6:true} },
    messages:{
      global:{
        mOwner:{ senderId:1, text:'hello from the owner', at:NOW-5000 },
        mBob:  { senderId:4, text:'bob was here',          at:NOW-4000 },
        mEve:  { senderId:5, text:'eve was here',          at:NOW-3000 }
      },
      chGen:{
        cBob:{ senderId:4, text:'bob in general', at:NOW-2000 },
        cEve:{ senderId:5, text:'eve in general', at:NOW-1000 }
      },
      dm_4_7:{
        d1:{ senderId:4, text:'private to vic', at:NOW-900 },
        d2:{ senderId:7, text:'private to bob', at:NOW-800 }
      }
    },
    reactions:{ global:{ mBob:{ '❤':{ 5:true } } } },
    pins:{}, lastRead:{}, typing:{},
    dmMembers:{ dm_4_7:{ 4:true, 7:true } },
    friends:{ 4:{7:true}, 7:{4:true} },
    friendRequests:{}, blocked:{}, blockedBy:{},

    /* The TOS gate. messages/$key/$msg/.write requires tosAccepted/<sender>/v >= 1, so a
       fixture without this cannot send a single message - which looks like a broken rule and
       is not one. */
    tosAccepted:{
      1:{v:3,at:NOW-10*DAY,h:'h1'}, 2:{v:3,at:NOW-10*DAY,h:'h2'}, 3:{v:3,at:NOW-10*DAY,h:'h3'},
      4:{v:3,at:NOW-10*DAY,h:'h4'}, 5:{v:3,at:NOW-10*DAY,h:'h5'}, 6:{v:3,at:NOW-10*DAY,h:'h6'},
      7:{v:3,at:NOW-10*DAY,h:'h7'}
    },

    /* ---- presence / sessions ---- */
    presence:{ global:{} }, onlineUsers:{}, sessions:{}, voice:{members:{}}, rate:{}, attest:{},
    modSettings:{}, roles:{}, appVersion:{ min:'2026-01-01.01' },

    /* ---- v54 nodes ---- */
    activity:{ 4:{kind:'listening', name:'a song', at:NOW-1000} },
    notes:{ 3:{ 4:'alice keeps a note about bob' }, 4:{} },
    auditLog:{ srvA:{ a1:{ by:3, at:NOW-3000, act:'ch.create', name:'general' } } },
    serverEvents:{ srvA:{ e1:{ name:'Movie night', at:NOW+2*DAY, by:3 } } },
    serverEmoji:{ srvA:{ em1:{ name:'wave', img:'data:image/png;base64,AAAA', by:3, at:NOW } } },
    memberScreen:{ srvA:{ 4:NOW-DAY } },
    polls:{ global:{ mEve:{ q:{ text:'pizza?', opts:{0:'yes',1:'no'}, at:NOW-3000 }, v:{} } } },
    saved:{ 3:{ s1:{key:'global', msg:'mOwner', at:NOW} } },
    connections:{ 3:{ c1:{kind:'github', name:'alice-codes', at:NOW} } },
    notifPrefs:{ 3:{ srv:{ srvA:'mentions' } } },
    achievements:{ 3:{ first_message: NOW-DAY } }
  };
}

module.exports = { NOW, DAY, UID, ID, data, perms, allPerms, ALL_PERMS, BASE_PERMS, JPEG };
