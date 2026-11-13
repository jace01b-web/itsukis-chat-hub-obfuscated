/* test/run-dist.js — v54.7
 *
 * The single-file build, opened as a browser would open it.
 *
 *     node build-single.js && node -r ./test/_pwbrowser.js test/run-dist.js
 *
 * WHY THIS EXISTS
 *   dist/index.single.html is produced by build-single.js and is easy to get wrong in a way no
 *   other suite would notice: it is built from js/manifest.js, so a file added to index.html
 *   and forgotten in the manifest (or the reverse) yields a single-file build that is missing
 *   code while the multi-file site works perfectly. Equally, a stale dist that was never
 *   rebuilt looks fine until somebody opens it and finds last release's app.
 *
 *   So this checks the two things that can only be checked by loading the actual artifact:
 *   that it boots with no errors, and that it is genuinely SELF-CONTAINED — no <script src>,
 *   no <link rel=stylesheet>, nothing to fetch but Firebase itself.
 *
 * WHAT IT CANNOT CHECK
 *   Signing in. The build loads the real Firebase SDK from gstatic and talks to a real
 *   database, neither of which is reachable from a test sandbox, so it gets as far as the auth
 *   screen and stops. That is the correct place to stop: everything past it is already covered
 *   by the harness suites, which run the same source with a fake database. What is NOT covered
 *   anywhere is the single-file build against a real Firebase project; that needs a browser,
 *   the file, and an account.
 */
const {chromium}=require('playwright');
const fs=require('fs');
const path=require('path');

let fails=0;
const ok=(name,cond,extra)=>{
  if(!cond)fails++;
  console.log((cond?'  PASS  ':'  FAIL  ')+name+(cond?'':'   <- '+JSON.stringify(extra)));
};
const group=t=>console.log('\n--- '+t+' ---');

const ROOT=path.join(__dirname,'..');
const DIST=path.join(ROOT,'dist','index.single.html');

(async()=>{
  group('the file itself');
  ok('dist/index.single.html exists',fs.existsSync(DIST));
  if(!fs.existsSync(DIST)){
    console.log('\nRun `node build-single.js` first.');
    process.exit(1);
  }
  const html=fs.readFileSync(DIST,'utf8');
  ok('it is a complete document',/^<!DOCTYPE html>/i.test(html.trim()),html.slice(0,40));
  ok('it is substantial',html.length>1000000,Math.round(html.length/1024)+' KB');

  group('every source file is represented');
  /* Read the manifest and require a recognisable fragment of each listed file to be present.
     A name-only check would pass on a build that inlined an empty file. */
  const manifestSrc=fs.readFileSync(path.join(ROOT,'js','manifest.js'),'utf8');
  const cssList=(manifestSrc.match(/"([0-9][^"]*\.css)"/g)||[]).map(x=>x.slice(1,-1));
  const jsList=(manifestSrc.match(/"([a-z0-9/_-]+\.js)"/g)||[]).map(x=>x.slice(1,-1))
    .filter(x=>x!=='manifest.js'&&x!=='loader.js');
  ok('the manifest lists stylesheets',cssList.length>20,cssList.length);
  ok('the manifest lists modules',jsList.length>50,jsList.length);

  const missingCss=cssList.filter(f=>{
    const p=path.join(ROOT,'css',f);
    if(!fs.existsSync(p))return false;            // not on disk is build-single.js's problem
    const body=fs.readFileSync(p,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').trim();
    const probe=(body.match(/[.#][A-Za-z][\w-]{3,}/)||[])[0];
    return probe?html.indexOf(probe)<0:false;
  });
  ok('every stylesheet is inlined',missingCss.length===0,missingCss);

  const missingJs=jsList.filter(f=>{
    const p=path.join(ROOT,'js',f);
    if(!fs.existsSync(p))return false;
    const body=fs.readFileSync(p,'utf8');
    /* A function or const declaration from each file - specific enough that it only appears
       because that file's text is in there. */
    const probe=(body.match(/^(?:function|const|let|async function)\s+([A-Za-z_$][\w$]{4,})/m)||[])[1];
    return probe?html.indexOf(probe)<0:false;
  });
  ok('every module is inlined',missingJs.length===0,missingJs);

  group('it is self-contained');
  /* <script src> and <link rel=stylesheet> both mean the build depends on files that are not
     in it, which defeats the whole point of a single file. The Firebase SDK is the one
     exception and arrives via a bare import inside the module, not a tag. */
  const scriptSrcs=(html.match(/<script[^>]+src=/gi)||[]).length;
  /* A LOCAL stylesheet link would mean the build still depends on css/ and is not
     self-contained. The Google Fonts link is a different thing and is deliberately left as a
     link in both index.html and the build: a webfont cannot be inlined usefully, and the page
     renders in the fallback face if it never arrives. So this forbids local links and allows
     remote ones, rather than forbidding the tag. */
  const links=html.match(/<link[^>]*rel=["']?stylesheet[^>]*>/gi)||[];
  const localLinks=links.filter(t=>!/https?:\/\//.test(t));
  const remoteLinks=links.filter(t=>/https?:\/\//.test(t));
  ok('no <script src> tags',scriptSrcs===0,scriptSrcs);
  ok('no LOCAL stylesheet links',localLinks.length===0,localLinks);
  ok('(a remote webfont link is fine and expected)',remoteLinks.length<=2,remoteLinks.length);
  ok('the raw-bootstrap block was replaced',html.indexOf('RAW-BOOTSTRAP:START')<0);
  ok('and the marker comment is there instead',/single-file build: css \+ js inlined/.test(html));

  group('nothing is inlined twice');
  /* build-single.js writes the EARLY files, then the manifest's js list. A file in both lists
     would be evaluated twice, which for anything with module-level state is a real bug. */
  /* Probe on the module's OPENING EXPRESSION, not on its path. An earlier version of this
     check used the path from the file header, which also appears in prose comments elsewhere in
     the codebase - so it reported model.js three times purely because other files mention it. */
  const dupes=[];
  ['js/discord/model.js','js/discord/owner-center.js','js/discord/audit.js',
   'js/core/database.js','js/discord/ui.js'].forEach(f=>{
    const fp=path.join(ROOT,f);
    if(!fs.existsSync(fp))return;
    /* Take the probe FROM THE FILE rather than hard-coding it, so a module that is renamed or
       changes its IIFE style does not quietly stop being checked. The first top-level
       `const X=` is unique to the module that declares it. */
    const body=fs.readFileSync(fp,'utf8');
    const m=body.match(/^const [A-Za-z_$][\w$]*=\(/m);
    if(!m)return;
    const n=html.split(m[0]).length-1;
    if(n!==1)dupes.push(f+' ('+m[0]+') appears '+n+' time(s)');
  });
  ok('each module is inlined exactly once',dupes.length===0,dupes);

  group('the cache-busting label');
  const srcHtml=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const meta=(h,n)=>(h.match(new RegExp('name="'+n+'" content="([^"]+)"'))||[])[1]||'';
  const label=meta(html,'build-version'),srcLabel=meta(srcHtml,'build-version');
  const token=meta(html,'build-token'),srcToken=meta(srcHtml,'build-token');
  ok('a build label is present',!!label,label);
  ok('and it matches the source\u2019s',label===srcLabel,{dist:label,src:srcLabel});
  /* The repository ships UNSTAMPED on purpose: the build-token meta is HMAC(BUILD_SECRET,
     label), and the secret is not in the repository, so only tools/stamp-build.js can add it
     at release time. What has to hold is that the two files AGREE - a dist carrying a token
     the source does not have, or a different one, means the build is out of step with its
     source and api/_lib.js will answer "forged" for every attestation call. Whether a token
     exists at all is the deployer's business, and build-single.js prints that reminder on
     every run. */
  ok('the token state matches the source',token===srcToken,
     {dist:token?'present':'absent',src:srcToken?'present':'absent'});
  if(!token)console.log('         note: this tree is UNSTAMPED. Run tools/stamp-build.js with '+
    'BUILD_SECRET, then rebuild, before deploying.');

  group('it boots in a browser');
  const browser=await chromium.launch();
  const page=await (await browser.newContext({viewport:{width:1300,height:860}})).newPage();
  const errs=[],consoleErrs=[];
  page.on('pageerror',e=>errs.push(String(e.message)));
  page.on('console',m=>{
    /* Network failures are expected and not the build's fault: this sandbox cannot reach
       gstatic for the Firebase SDK or the database itself. Anything else is. */
    if(m.type()==='error'&&!/ERR_TUNNEL|net::|ERR_INTERNET|Failed to load resource/.test(m.text()))
      consoleErrs.push(m.text().slice(0,200));
  });
  await page.goto('file://'+DIST,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(6000);
  const st=await page.evaluate(()=>{
    const styles=[...document.querySelectorAll('style')];
    const scripts=[...document.querySelectorAll('script')];
    return{
      stillBooting:document.documentElement.classList.contains('booting'),
      reachedUi:!!document.querySelector('#authPage:not(.hidden)')||
                !!document.querySelector('#loadingPage:not(.hidden)')||
                !!document.querySelector('#chatPage:not(.hidden)'),
      inlineCssChars:styles.reduce((n,s)=>n+s.textContent.length,0),
      externalScripts:scripts.filter(s=>s.src).length,
      moduleScripts:scripts.filter(s=>s.type==='module').length,
      failedToStart:/Failed to start/.test((document.querySelector('#loadingHint')||{}).textContent||''),
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    };
  });
  ok('the boot screen released',       st.stillBooting===false,st);
  ok('it reached a real screen',       st.reachedUi===true,st);
  ok('it did not report a crash',      st.failedToStart===false,st);
  ok('the CSS really is inline',       st.inlineCssChars>300000,st.inlineCssChars);
  ok('no script is fetched',           st.externalScripts===0,st);
  ok('the app is one module',          st.moduleScripts===1,st);
  ok('nothing overflows sideways',     st.overflow<=0,st);
  ok('no page errors',                 errs.length===0,errs.slice(0,4));
  ok('no unexpected console errors',   consoleErrs.length===0,consoleErrs.slice(0,4));

  try{
    fs.mkdirSync(path.join(ROOT,'test','shots'),{recursive:true});
    await page.screenshot({path:path.join(ROOT,'test','shots','30-dist-single.png')});
  }catch(_){}
  await browser.close();

  console.log(fails?('\n'+fails+' dist check(s) FAILED'):'\nthe single-file build is complete and boots cleanly');
  console.log('Not covered here: signing in from the single file against a real Firebase project.');
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
