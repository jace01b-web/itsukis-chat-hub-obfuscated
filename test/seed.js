/* test/seed.js - the fake database used by the test driver. Development only. */
const NOW=Date.now();
const user=(id,username,extra)=>Object.assign({username,createdAt:NOW-86400000*id,lastNameChange:0,provider:'password'},extra||{});

const SEED={
  '.info':{connected:true,serverTimeOffset:0},
  counters:{userId:5},
  idToUid:{1:'uid1',2:'uid2',3:'uid3',4:'uid4',5:'uid5'},
  uidToId:{uid1:1,uid2:2,uid3:3,uid4:4,uid5:5},
  usernames:{suki:1,vlad:2,jace:3,mina:4,ghost:5},
  usernameLogin:{
    suki:{email:'suki@itsuki.local'},vlad:{email:'vlad@itsuki.local'},
    jace:{email:'jace@itsuki.local'},mina:{email:'mina@itsuki.local'},ghost:{email:'ghost@itsuki.local'}
  },
  users:{
    1:user(1,'suki',{settings:{}}),
    2:user(2,'vlad'),
    3:user(3,'jace'),
    4:user(4,'mina'),
    5:user(5,'ghost')
  },
  owners:{1:1},
  mods:{2:1},
  admin:{},
  mvp:{3:NOW-1000},
  vip:{4:{perm:true}},
  customroles:{developer:{name:'Developer',color:'#00d4ff',rank:50,members:{2:1}}},
  onlineUsers:{1:true,2:true,3:true,4:true},
  modSettings:{filterEnabled:true,filterNames:true,customNames:true,voiceEnabled:true},
  tosAccepted:{1:{v:5,at:NOW},2:{v:5,at:NOW},3:{v:5,at:NOW},4:{v:5,at:NOW},5:{v:5,at:NOW}},
  rulesAgreed:{1:{v:99,at:NOW},2:{v:99,at:NOW}},
  security:{enforce:false},
  messages:{
    global:{
      m1:{senderId:2,text:'yo is the new look done yet',at:NOW-1000*60*62,pings:[],images:[]},
      m2:{senderId:1,text:'just finished it. servers, roles, the whole thing',at:NOW-1000*60*61,pings:[],images:[]},
      m3:{senderId:1,text:'try right-clicking a channel',at:NOW-1000*60*60,pings:[],images:[]},
      m4:{senderId:3,text:'the role manager actually has permission toggles??',at:NOW-1000*60*12,pings:[],images:[]},
      m5:{senderId:1,text:'all 20 of them, with channel overrides',at:NOW-1000*60*11,pings:[],images:[]},
      m6:{senderId:4,text:'and it works on my phone which is the main thing',at:NOW-1000*60*4,pings:[],images:[]},
      m7:{senderId:2,text:'@suki ship it',at:NOW-1000*60*2,pings:[1],images:[]}
    },
    announcements:{a1:{senderId:1,text:'ICH is now a full Discord-style client. Rooms are gone, servers are in.',at:NOW-1000*60*300,pings:[],images:[]}},
    shitpost:{s1:{senderId:2,text:'first',at:NOW-1000*60*200,pings:[],images:[]}}
  },
  reactions:{global:{m2:{'🔥':{2:true,3:true},'🎉':{4:true}},m5:{'👀':{2:true}}}},
  serverRoles:{},serverChannels:{},serverCats:{},serverMembers:{},
  servers:{},userServers:{},channelServer:{},invites:{}
};

module.exports=SEED;
