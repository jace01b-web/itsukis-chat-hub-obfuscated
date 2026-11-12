/* build-single.js - merges the whole site back into ONE self-contained html file.
 *
 *   node build-single.js            ->  dist/index.single.html
 *
 * Use that file when the site is opened somewhere relative paths can't work (an about:blank / blob
 * launcher window, a host that only accepts a single file, ...). It is the same code, just inlined.
 * Needs only Node.js - no packages. Normal hosting should just upload the folder as-is.
 *
 * How it works: index.html loads everything from the raw repo inside one marked block
 * (<!-- RAW-BOOTSTRAP:START --> ... <!-- RAW-BOOTSTRAP:END -->). This script swaps that whole block
 * for the inlined stylesheets + scripts, and leaves the rest of index.html (loading screen,
 * markup, the boot-ui script) exactly as it is.
 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const rd=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const sandbox={window:{}};
vm.runInNewContext(rd('js/manifest.js'),sandbox);
const M=sandbox.window.APP_MANIFEST;
const safe=t=>t.replace(/<\/script/gi,'<\\/script');            // keep inline <script> from closing early

/* The same files, in the same order index.html's bootstrap actually RUNS them:
   anti-lag-boot before paint, then the "static late" extras (they are inserted and run while
   loader.js is still waiting on the Firebase SDK), then the manifest's js list. */
const EARLY=['js/early/anti-lag-boot.js'];
const LATE=[
  'js/ui/auth-card-motion.js','js/core/crash-catcher.js','js/ui/extras-download-launcher.js',
  'js/ui/mobile-sidebar.js','js/features/voice-channel.js'
];
const missing=[...EARLY,...LATE,...M.js.map(f=>'js/'+f),...M.css.map(f=>'css/'+f)]
  .filter(p=>!fs.existsSync(path.join(__dirname,p)));
if(missing.length)throw new Error('listed but not on disk:\n  '+missing.join('\n  '));

const css=M.css.map(f=>rd('css/'+f)).join('\n');
const base='https://www.gstatic.com/firebasejs/'+M.firebase.version+'/';
const appCode=
  M.firebase.modules.map((n,i)=>`import * as fb${i} from "${base}${n}.js";`).join('\n')+'\n'+
  `window.FB=Object.assign({},${M.firebase.modules.map((n,i)=>'fb'+i).join(',')});\n`+
  (M.firebase.storage
    ?`window.FBS=null;import("${base}${M.firebase.storage}.js").then(m=>{window.FBS=m}).catch(e=>console.warn('firebase-storage unavailable',e));\n`
    :'window.FBS=null;\n')+
  LATE.map(f=>rd(f)).join('\n')+'\n'+
  M.js.map(f=>rd('js/'+f)).join('\n');

let html=rd('index.html');
const START='<!-- RAW-BOOTSTRAP:START',END='<!-- RAW-BOOTSTRAP:END -->';
const a=html.indexOf(START),b=html.indexOf(END);
if(a<0||b<0)throw new Error('RAW-BOOTSTRAP markers not found in index.html');

const inlined=
  '<style>\n'+css+'\n</style>\n'+
  '<script>\n'+safe(EARLY.map(f=>rd(f)).join('\n'))+'\n'+
  'try{window.ICHBoot.step("js");window.ICHBoot.prog(60);window.ICHBoot.phase("Starting the app\u2026");window.ICHBoot.reveal()}'+
  'catch(e){document.documentElement.classList.remove("booting")}\n</script>\n'+
  '<script type="module">\n'+safe(appCode)+'\n</script>';

html=html.slice(0,a)+'<!-- single-file build: css + js inlined by build-single.js -->\n'+inlined+html.slice(b+END.length);
fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'dist/index.single.html'),html);
console.log('wrote dist/index.single.html ('+Math.round(html.length/1024)+' KB)');

/* v54.6. The build label in index.html is BOTH the cache-buster (js/loader.js appends it as
   ?v= to every file) and half of an HMAC pair the API checks - the other half is the
   build-token meta tag, which is HMAC(BUILD_SECRET, label). Editing the label by hand breaks
   the pair and api/_lib.js then answers 'forged' for every attestation call, so a release
   that forgets to re-stamp either serves stale JavaScript or loses TOS/IP checking. Neither
   failure is loud, which is why this prints every time. */
const stamped=(html.match(/name="build-version" content="([^"]+)"/)||[])[1]||'(none)';
console.log('');
console.log('  build label in this file : '+stamped);
console.log('  BEFORE DEPLOYING, re-stamp it so the cache-buster changes and the token still matches:');
console.log('      BUILD_SECRET=<the same value as in Vercel> node tools/stamp-build.js');
console.log('      node build-single.js          # rebuild this file with the new label');
console.log('  then set MIN_BUILD in Vercel to the label it printed.');
console.log('  Do NOT edit the label by hand: the token is an HMAC of it and the API will reject the pair.');
