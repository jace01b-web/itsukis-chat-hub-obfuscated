/* ==========================================================================
 * js/early/anti-lag-boot.js
 * Runs in <head> before first paint (so there is no flash of the heavy visuals).
 * ========================================================================== */
/* Anti-lag: per-device choice, OFF unless explicitly switched on. Runs before first paint so there is no flash of the heavy visuals. */
try{if(localStorage.getItem('ich.antiLag')==='1')document.documentElement.classList.add('anti-lag')}catch(_){}

/* Discord look: per-device cache of the account setting, OFF unless switched on. Applied before first paint. */
try{if(localStorage.getItem('ich.discordLook')==='1')document.documentElement.classList.add('discord-look')}catch(_){}

/* Discord look themes. Single source of truth: this table builds the CSS (below) AND the swatches in Settings.
   Each theme only sets the --dl-* palette variables used by css/22-discord-look.css. Nothing here applies unless html.discord-look is on. */
(function(){
  function dark(o){return Object.assign({text:'#dbdee1',muted:'#949ba4',head:'#f2f3f5',scroll:'#1a1b1e'},o)}
  // translucent panels over a gradient: tone = 'dark' | 'light'
  function grad(id,name,g,tone,pop){
    var d=tone!=='light';
    return{id:id,name:name,group:'color',sw:g,body:g,
      vars:d?{bg:'rgba(0,0,0,.22)',bg2:'rgba(0,0,0,.34)',bg3:'rgba(0,0,0,.46)',input:'rgba(0,0,0,.34)',hover:'rgba(255,255,255,.08)',active:'rgba(255,255,255,.15)',
        text:'#f2f3f5',muted:'#c4c8d0',head:'#fff',line:'rgba(255,255,255,.14)',scroll:'rgba(0,0,0,.4)',pop:pop||'#25262b'}
        :{bg:'rgba(255,255,255,.34)',bg2:'rgba(255,255,255,.5)',bg3:'rgba(255,255,255,.62)',input:'rgba(255,255,255,.6)',hover:'rgba(0,0,0,.06)',active:'rgba(0,0,0,.12)',
        text:'#23242a',muted:'#4f525b',head:'#0b0b0d',mention:'#3c45a5',line:'rgba(0,0,0,.14)',scroll:'rgba(0,0,0,.25)',pop:pop||'#f2f3f5'}};
  }
  var T=[
    {id:'light',name:'Light',group:'default',sw:'#e3e5e8',body:'#ffffff',vars:{bg:'#ffffff',bg2:'#f2f3f5',bg3:'#e3e5e8',input:'#ebedef',hover:'#e3e5e8',active:'#d7d9dd',text:'#313338',muted:'#5c5e66',head:'#060607',mention:'#3c45a5',line:'#e3e5e8',scroll:'#c1c3c8',pop:'#ffffff'}},
    {id:'ash',name:'Ash',group:'default',sw:'#383a40',body:'#313338',vars:dark({bg:'#313338',bg2:'#2b2d31',bg3:'#1e1f22',input:'#383a40',hover:'#35373c',active:'#404249',line:'#3f4147',pop:'#313338'})},
    {id:'dark',name:'Dark',group:'default',sw:'#2b2d31',body:'#1a1a1e',vars:dark({bg:'#1a1a1e',bg2:'#121214',bg3:'#0b0b0c',input:'#222327',hover:'#25262a',active:'#2e2f34',line:'#2a2b30',scroll:'#0b0b0c',pop:'#1a1a1e'})},
    {id:'onyx',name:'Onyx',group:'default',sw:'#000000',body:'#000000',vars:dark({bg:'#000000',bg2:'#050505',bg3:'#000000',input:'#121212',hover:'#141414',active:'#1e1e1e',line:'#1c1c1c',scroll:'#1c1c1c',pop:'#0a0a0a'})},
    grad('mint','Mint','linear-gradient(135deg,#a8e6cf,#dcedc1)','light'),
    grad('peach','Peach','linear-gradient(135deg,#ffd3a5,#fd9d97)','light'),
    grad('periwinkle','Periwinkle','linear-gradient(135deg,#a6c0fe,#f68084)','light'),
    grad('citrus','Citrus','linear-gradient(135deg,#d4fc79,#96e6a1)','light'),
    grad('cotton','Cotton Candy','linear-gradient(135deg,#fbc2eb,#a6c1ee)','light'),
    grad('sky','Sky','linear-gradient(135deg,#a1c4fd,#c2e9fb)','light'),
    grad('sand','Sand','linear-gradient(135deg,#e6dccb,#f1ede0)','light'),
    grad('twilight','Twilight','linear-gradient(135deg,#2b1055,#d1743a)','dark'),
    grad('neon','Neon','linear-gradient(135deg,#7f00ff,#1fa2ff)','dark'),
    grad('forest','Forest','linear-gradient(135deg,#1b2a22,#4a6b50)','dark'),
    grad('crimson','Crimson Night','linear-gradient(135deg,#1a0a0d,#7a1424)','dark'),
    grad('midnight','Midnight','linear-gradient(135deg,#0f0c29,#302b63,#24243e)','dark'),
    grad('terracotta','Terracotta','linear-gradient(135deg,#5b2f2a,#a65a48)','dark'),
    grad('dusk','Dusk','linear-gradient(135deg,#3a3d5c,#9a8fa8)','dark'),
    grad('lagoon','Lagoon','linear-gradient(135deg,#1d3b6e,#2a9d8f)','dark'),
    grad('sunset','Sunset','linear-gradient(135deg,#d31c7c,#f9a03f)','dark'),
    grad('aurora','Aurora','linear-gradient(135deg,#0f2027,#2c7a6e,#5b3b8c)','dark'),
    grad('coffee','Coffee','linear-gradient(135deg,#3b2a20,#7d5f43)','dark'),
    grad('royal','Royal','linear-gradient(135deg,#1c2a78,#3a1c71)','dark')
  ];
  var css='';
  T.forEach(function(t){
    var v=t.vars,o='';for(var k in v)o+='--dl-'+k+':'+v[k]+';';
    css+='html.discord-look[data-dl-theme="'+t.id+'"]{'+o+'--dl-body:'+t.body+';}\n';
  });
  window.DL_THEMES=T;
  try{var st=document.createElement('style');st.id='dl-themes';st.textContent=css;document.head.appendChild(st)}catch(_){}
  try{var id=localStorage.getItem('ich.discordTheme');if(id&&T.some(function(t){return t.id===id}))document.documentElement.setAttribute('data-dl-theme',id)}catch(_){}
})();
