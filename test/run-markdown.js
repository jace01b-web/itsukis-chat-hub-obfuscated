/* test/run-markdown.js
 * Renders every Discord formatting construct through the real app and asserts both that it
 * formats AND that none of the XSS shapes survive.
 *
 * The ordering inside js/discord/markdown.js (code lifted out first, everything escaped, finished
 * HTML parked behind a NUL token, hrefs written only by mdLink) is what keeps the output safe.
 * This file exists so that ordering cannot be changed without something going red.
 *
 *     node test/build-harness.js && node test/run-markdown.js
 *
 * Development only - not referenced by the site.
 */
const {chromium}=require('playwright');
const path=require('path');
const APP=path.join(__dirname,'..');
const SEED=JSON.parse(JSON.stringify(require('./seed.js')));
const NOW=Date.now();
const CASES=[
 ['spoiler','hey ||this is hidden|| ok'],
 ['bold/italic','**bold** *italic* ***both***'],
 ['underline/strike','__underline__ ~~strike~~ _em_'],
 ['inline code','use `npm install` now'],
 ['fence lang','```js\nconst x=1;\n```'],
 ['quote','> quoted\n> second\nnormal'],
 ['tripquote','>>> everything\nafter'],
 ['headings','# Big\n## Med\n### Small\nbody'],
 ['subtext','-# small print'],
 ['bullets','- one\n- two'],
 ['masked link','[click here](https://example.com/a?b=1&c=2)'],
 ['bare link','see https://example.com/x. ok'],
 ['XSS raw','<img src=x onerror=alert(1)>'],
 ['XSS masked js','[x](javascript:alert(1))'],
 ['XSS in code','`<script>alert(1)</script>`'],
 ['XSS spoiler','||<img src=x onerror=alert(1)>||'],
 ['XSS attr break','[a](https://x.com" onmouseover="alert(1))'],
 ['md inside code','`**not bold**`'],
 ['snake_case','my_var_name stays'],
 ['mention','@suki hello'],
 ['nested spoiler','||**bold spoiler**||'],
 ['quote+heading','> # quoted heading'],
 ['NUL forge','\u00000\u0000 fake'],
 ['plain newline','line one\nline two'],
];
SEED.messages.global={};
CASES.forEach(([n,txt],i)=>{SEED.messages.global['md'+String(i).padStart(2,'0')]={senderId:2,text:txt,at:NOW-100000+i*1000,pings:[],images:[]}});
(async()=>{
  const b=await chromium.launch();
  const page=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
  const errs=[],alerts=[];
  page.on('pageerror',e=>errs.push(e.message));
  page.on('dialog',async d=>{alerts.push(d.message());await d.dismiss()});
  await page.goto('file://'+APP+'/test/harness.html?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(seed=>{
    window.__FAKE.seed(seed);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');window.__APP_START();
  },SEED);
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await page.waitForTimeout(2500);
  const out=await page.evaluate(()=>{
    const res=[];
    document.querySelectorAll('#messages .msg .bubble').forEach(bb=>{
      const c=bb.cloneNode(true);
      c.querySelectorAll('.msg-hover-bar,.reactions-row').forEach(n=>n.remove());
      const danger=[...c.querySelectorAll('*')].filter(e=>[...e.attributes].some(a=>/^on/i.test(a.name)||/^javascript:/i.test((a.value||'').trim())));
      res.push([c.innerHTML.trim(),danger.map(e=>e.outerHTML).join(' | ')]);
    });
    return res;
  });
  console.log('page errors:',errs.length?errs:'none');
  console.log('alerts:',alerts.length?alerts:'none');
  let bad=0;
  out.forEach((r,i)=>{
    const nm=(CASES[i]&&CASES[i][0])||('#'+i);
    console.log('\n'+nm+'\n   '+r[0].replace(/\n/g,'\\n'));
    if(r[1]){bad++;console.log('   !!! DANGEROUS: '+r[1])}
  });
  console.log('\n'+(bad?bad+' DANGEROUS CASES':'OK: no event handlers or javascript: urls in any output'));

  /* The assertions that matter: every one of these is a thing that WOULD be a hole if the
     ordering in js/discord/markdown.js were changed. */
  const byName={};out.forEach((r,i)=>{if(CASES[i])byName[CASES[i][0]]=r[0]});
  const must=[
    ['spoiler','md-spoiler',true],
    ['bold/italic','<strong>bold</strong>',true],
    ['inline code','<code class="md-code">npm install</code>',true],
    ['fence lang','<pre class="md-pre">',true],
    ['quote','<blockquote',true],
    ['headings','md-h1',true],
    ['bullets','<ul class="md-ul">',true],
    ['masked link','href="https://example.com/a?b=1&amp;c=2"',true],
    ['XSS raw','<img',false],
    ['XSS masked js','<a ',false],
    ['XSS in code','<script',false],
    ['XSS spoiler','<img',false],
    ['md inside code','<strong>',false],
    ['snake_case','<em>',false],
    ['NUL forge','<',false]
  ];
  let fails=0;
  must.forEach(([name,needle,want])=>{
    const got=(byName[name]||'').includes(needle);
    const ok=got===want;
    if(!ok)fails++;
    console.log((ok?'  PASS  ':'  FAIL  ')+name.padEnd(16)+(want?'contains ':'must NOT contain ')+needle);
  });
  if(errs.length)fails++;
  if(alerts.length)fails++;
  if(bad)fails+=bad;
  console.log(fails?('\n'+fails+' MARKDOWN CHECKS FAILED'):'\nALL MARKDOWN CHECKS PASSED');
  await b.close();
  process.exit(fails?1:0);
})();
