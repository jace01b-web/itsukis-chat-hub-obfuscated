/* test/_pwbrowser.js - preload shim for the browser suites. Development only.
 *
 *     node -r ./test/_pwbrowser.js test/run-chat.js
 *
 * Why this exists: package.json asks for playwright ^1.40.0, npm resolved that to 1.65.0, and
 * 1.65 looks for its own pinned Chromium revision (1254). This machine has 1243 installed and
 * cannot download another one, so chromium.launch() fails with "Executable doesn't exist" before
 * a single check runs. Rather than hard-code a path into thirteen suites, this shim fills in
 * executablePath ONLY when the revision Playwright wants is missing and a sibling revision is
 * present.
 *
 * It changes nothing else: same flags, same API, and if the expected browser IS installed the
 * shim stands aside completely. Nothing in js/ or the shipped site refers to it.
 */
const fs=require('fs');
const path=require('path');

const ROOT=process.env.PLAYWRIGHT_BROWSERS_PATH||'';
function findChromium(){
  if(!ROOT||!fs.existsSync(ROOT))return null;
  const cands=[];
  for(const d of fs.readdirSync(ROOT)){
    const m=/^chromium(?:_headless_shell)?-(\d+)$/.exec(d);
    if(!m)continue;
    for(const rel of ['chrome-linux64/chrome','chrome-linux/chrome',
                      'chrome-headless-shell-linux64/chrome-headless-shell']){
      const p=path.join(ROOT,d,rel);
      if(fs.existsSync(p))cands.push({rev:Number(m[1]),full:!d.includes('headless_shell'),p});
    }
  }
  if(!cands.length)return null;
  // Prefer a full Chromium over the headless shell: some suites take screenshots and the shell
  // renders a few things differently. Then prefer the newest revision available.
  cands.sort((a,b)=>(b.full-a.full)||(b.rev-a.rev));
  return cands[0].p;
}

/* Last resort: a Chrome installed by the system rather than by Playwright. Same reasoning as
   above - without it the suites cannot run at all on a machine that has Chrome but no
   Playwright-managed revision. Only consulted when findChromium() comes up empty. */
function findSystemChrome(){
  for(const p of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
                  '/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome']){
    try{if(fs.existsSync(p))return p}catch(_){}
  }
  return null;
}

try{
  const pw=require('playwright');
  const orig=pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch=function(opts){
    opts=Object.assign({},opts||{});
    if(!opts.executablePath){
      let wanted=null;
      try{wanted=pw.chromium.executablePath()}catch(_){}
      if(!wanted||!fs.existsSync(wanted)){
        const found=findChromium()||findSystemChrome();
        if(found){
          opts.executablePath=found;
          if(!global.__PW_SHIM_SAID){
            global.__PW_SHIM_SAID=true;
            console.log('[pw-shim] using '+found+' (the pinned revision is not installed)');
          }
        }
      }
    }
    return orig(opts);
  };
}catch(e){
  console.error('[pw-shim] playwright not loadable: '+e.message);
}
