/* ==========================================================================
 * test/fake-firebase.js
 * An in-memory stand-in for the Firebase SDK, so the REAL app code can be run and inspected
 * without touching the live database.
 *
 * This is a development/testing file. It is NOT in js/manifest.js and never ships to the site -
 * nothing in js/ or css/ references it. It exists so `node test/screenshots.js` can boot the whole
 * app, sign a fake account in, and check that the Discord shell renders and behaves.
 *
 * It implements just enough of the SDK surface that js/core/firebase-imports.js destructures:
 * a JSON tree with path listeners, the auth callbacks, and no-op App Check.
 *
 * It deliberately does NOT enforce the security rules. Rules are validated separately - this is
 * for checking the UI and the client logic.
 * ========================================================================== */
(function(){
  'use strict';

  /* ---------------- the tree ---------------- */
  let DATA={};
  const listeners=[];   // {path, cb, err}

  const split=p=>String(p).split('/').filter(s=>s!=='');
  function getAt(path){
    let n=DATA;
    for(const k of split(path)){
      if(n==null||typeof n!=='object')return null;
      n=n[k];
    }
    return n===undefined?null:n;
  }
  function setAt(path,val){
    const parts=split(path);
    if(!parts.length){DATA=val==null?{}:val;return}
    let n=DATA;
    for(let i=0;i<parts.length-1;i++){
      const k=parts[i];
      if(n[k]==null||typeof n[k]!=='object')n[k]={};
      n=n[k];
    }
    const last=parts[parts.length-1];
    if(val==null)delete n[last];else n[last]=val;
  }
  // Firebase removes empty objects; mirroring that keeps .exists() behaving the same way.
  function prune(path){
    const parts=split(path);
    for(let i=parts.length-1;i>0;i--){
      const p=parts.slice(0,i).join('/'),v=getAt(p);
      if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===0)setAt(p,null);
      else break;
    }
  }

  function snap(path){
    const v=getAt(path);
    return{
      val:()=>v,
      exists:()=>v!==null&&v!==undefined,
      key:split(path).pop()||null,
      child:k=>snap(path+'/'+k),
      forEach(fn){
        if(!v||typeof v!=='object')return false;
        for(const k of Object.keys(v)){if(fn(snap(path+'/'+k))===true)return true}
        return false;
      },
      get size(){return v&&typeof v==='object'?Object.keys(v).length:0}
    };
  }

  // A write to a/b/c must wake listeners on a, a/b and a/b/c.
  function fire(path){
    const p=split(path).join('/');
    listeners.slice().forEach(l=>{
      const lp=l.path;
      if(lp===''||p===lp||p.startsWith(lp+'/')||lp.startsWith(p+'/')||p===''){
        try{l.cb(snap(lp))}catch(e){console.error('[fake-fb] listener threw',lp,e)}
      }
    });
  }

  /* ---------------- refs ---------------- */
  function makeRef(path){
    path=split(path).join('/');
    return{_fake:true,_path:path,key:split(path).pop()||null,
           toString:()=>'fake://'+path,
           get ref(){return makeRef(path)}};
  }
  const pathOf=r=>(r&&r._query?r._ref._path:(r&&r._path!=null?r._path:String(r)));

  const api={};

  api.initializeApp=cfg=>({name:'[DEFAULT]',options:cfg});
  api.getDatabase=()=>({_fake:true});
  api.enableLogging=()=>{};

  api.ref=(db,p)=>makeRef(p===undefined?(typeof db==='string'?db:''):p);

  api.onValue=function(r,cb,errCb){
    const p=pathOf(r);
    const l={path:p,cb,err:errCb};
    listeners.push(l);
    // Firebase delivers the current value immediately; async, like the real one.
    Promise.resolve().then(()=>{try{cb(snap(p))}catch(e){console.error('[fake-fb] initial listener threw',p,e)}});
    return()=>{const i=listeners.indexOf(l);if(i>=0)listeners.splice(i,1)};
  };

  api.get=r=>Promise.resolve().then(()=>snap(pathOf(r)));

  api.set=(r,v)=>Promise.resolve().then(()=>{
    const p=pathOf(r);
    setAt(p,resolveSentinels(v));
    if(v==null)prune(p);
    fire(p);
  });

  api.remove=r=>Promise.resolve().then(()=>{
    const p=pathOf(r);setAt(p,null);prune(p);fire(p);
  });

  api.update=(r,patch)=>Promise.resolve().then(()=>{
    const base=pathOf(r);
    Object.keys(patch).forEach(k=>{
      const full=(base?base+'/':'')+k;
      setAt(full,resolveSentinels(patch[k]));
      if(patch[k]==null)prune(full);
    });
    // one fire per touched path so every listener in range sees the change
    Object.keys(patch).forEach(k=>fire((base?base+'/':'')+k));
    if(!Object.keys(patch).length)fire(base);
  });

  let pushN=0;
  api.push=(r,v)=>{
    const p=pathOf(r);
    // monotonic and sortable, like a real push id
    const key='-fake'+String(Date.now()).slice(-8)+String(pushN++).padStart(4,'0');
    const child=makeRef(p+'/'+key);
    if(v!==undefined)api.set(child,v);
    return child;
  };

  api.runTransaction=(r,fn)=>Promise.resolve().then(()=>{
    const p=pathOf(r),cur=getAt(p);
    const next=fn(cur);
    if(next===undefined)return{committed:false,snapshot:snap(p)};
    setAt(p,resolveSentinels(next));fire(p);
    return{committed:true,snapshot:snap(p)};
  });

  const SENTINEL={'.sv':'timestamp'};
  api.serverTimestamp=()=>SENTINEL;
  function resolveSentinels(v){
    if(v===SENTINEL)return Date.now();
    if(v&&typeof v==='object'&&v['.sv']==='timestamp')return Date.now();
    if(Array.isArray(v))return v.map(resolveSentinels);
    if(v&&typeof v==='object'){
      const o={};Object.keys(v).forEach(k=>{o[k]=resolveSentinels(v[k])});return o;
    }
    return v;
  }

  api.onDisconnect=()=>({remove:()=>Promise.resolve(),set:()=>Promise.resolve(),cancel:()=>Promise.resolve(),update:()=>Promise.resolve()});

  /* ---- queries: enough shape that the app's query() calls resolve ---- */
  const mkMod=(t,v)=>({_mod:t,_val:v});
  api.orderByChild=c=>mkMod('orderByChild',c);
  api.orderByValue=()=>mkMod('orderByValue');
  api.equalTo=v=>mkMod('equalTo',v);
  api.limitToLast=n=>mkMod('limitToLast',n);
  api.limitToFirst=n=>mkMod('limitToFirst',n);
  api.endAt=v=>mkMod('endAt',v);
  api.query=function(r){
    const mods=[].slice.call(arguments,1);
    return{_fake:true,_query:true,_ref:makeRef(pathOf(r)),_mods:mods,_path:pathOf(r)};
  };

  /* ---------------- auth ---------------- */
  const authCbs=[];
  let currentUser=null;
  const accounts={};   // email -> {uid, password}
  let uidN=0;

  const authObj={
    get currentUser(){return currentUser},
    _fake:true
  };
  api.initializeAuth=()=>authObj;
  api.getAuth=()=>authObj;
  api.indexedDBLocalPersistence={};
  api.browserLocalPersistence={};
  api.browserSessionPersistence={};
  api.inMemoryPersistence={};
  api.browserPopupRedirectResolver={};
  api.setPersistence=()=>Promise.resolve();
  api.initializeAppCheck=()=>({});
  api.ReCaptchaEnterpriseProvider=function(){};
  api.GoogleAuthProvider=function(){};
  api.EmailAuthProvider={credential:()=>({})};
  api.linkWithCredential=()=>Promise.resolve({user:currentUser});
  api.sendEmailVerification=()=>Promise.resolve();
  api.sendPasswordResetEmail=()=>Promise.resolve();

  function emitAuth(){authCbs.slice().forEach(cb=>{try{cb(currentUser)}catch(e){console.error('[fake-fb] auth cb threw',e)}})}

  api.onAuthStateChanged=(a,cb)=>{
    authCbs.push(cb);
    Promise.resolve().then(()=>{try{cb(currentUser)}catch(e){console.error(e)}});
    return()=>{const i=authCbs.indexOf(cb);if(i>=0)authCbs.splice(i,1)};
  };
  api.createUserWithEmailAndPassword=(a,email,password)=>Promise.resolve().then(()=>{
    email=String(email).toLowerCase();
    if(accounts[email]){const e=new Error('exists');e.code='auth/email-already-in-use';throw e}
    const uid='uid'+(++uidN);
    accounts[email]={uid,password};
    currentUser={uid,email,emailVerified:false,delete:()=>{delete accounts[email];currentUser=null;emitAuth();return Promise.resolve()}};
    emitAuth();
    return{user:currentUser};
  });
  api.signInWithEmailAndPassword=(a,email,password)=>Promise.resolve().then(()=>{
    email=String(email).toLowerCase();
    const rec=accounts[email];
    if(!rec||rec.password!==password){const e=new Error('bad');e.code='auth/invalid-credential';throw e}
    currentUser={uid:rec.uid,email,emailVerified:true,delete:()=>Promise.resolve()};
    emitAuth();
    return{user:currentUser};
  });
  api.signInWithPopup=()=>Promise.reject(Object.assign(new Error('no popup in tests'),{code:'auth/popup-blocked'}));
  api.signOut=()=>Promise.resolve().then(()=>{currentUser=null;emitAuth()});
  api.deleteUser=u=>u&&u.delete?u.delete():Promise.resolve();

  /* ---------------- test helpers ---------------- */
  window.__FAKE={
    seed(tree){DATA=JSON.parse(JSON.stringify(tree||{}));fire('')},
    dump(){return JSON.parse(JSON.stringify(DATA))},
    at(p){return getAt(p)},
    // register an account without going through the UI
    account(email,password,uid){accounts[String(email).toLowerCase()]={uid:uid||('uid'+(++uidN)),password};return accounts[String(email).toLowerCase()].uid},
    signIn(email){
      const rec=accounts[String(email).toLowerCase()];
      if(!rec)throw new Error('no such fake account: '+email);
      currentUser={uid:rec.uid,email:String(email).toLowerCase(),emailVerified:true,delete:()=>Promise.resolve()};
      emitAuth();
    },
    listenerCount(){return listeners.length}
  };

  // .info paths the app listens to
  setAt('.info/connected',true);
  setAt('.info/serverTimeOffset',0);

  window.FB=api;
  window.FBS=null;   // Firebase Storage is optional; uploads just stay off
})();
