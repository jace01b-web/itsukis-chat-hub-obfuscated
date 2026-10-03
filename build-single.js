/* build-single.js - merges the whole site back into ONE self-contained html file.
 *
 *   node build-single.js            ->  dist/index.single.html
 *
 * Use that file when the site is opened somewhere relative paths can't work (an about:blank / blob
 * launcher window, a host that only accepts a single file, ...). It is the same code, just inlined.
 * Needs only Node.js - no packages. Normal hosting should just upload the folder as-is.
 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const rd=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const sandbox={window:{}};
vm.runInNewContext(rd('js/manifest.js'),sandbox);
const M=sandbox.window.APP_MANIFEST;
const safe=t=>t.replace(/<\/script/gi,'<\\/script');            // keep inline <script> from closing early
const css=M.css.map(f=>rd('css/'+f)).join('\n');
const js=M.js.map(f=>rd('js/'+f)).join('\n');
const base='https://www.gstatic.com/firebasejs/'+M.firebase.version+'/';
const moduleCode=
  M.firebase.modules.map((n,i)=>`import * as fb${i} from "${base}${n}.js";`).join('\n')+'\n'+
  `window.FB=Object.assign({},${M.firebase.modules.map((n,i)=>'fb'+i).join(',')});\n`+js;
let html=rd('index.html');
const swap=(tag,replacement)=>{ if(!html.includes(tag))throw new Error('tag not found in index.html: '+tag); html=html.replace(tag,()=>replacement); };
swap('<script src="js/manifest.js"></script>','<style>\n'+css+'\n</style>');
swap('<script src="js/early/load-styles.js"></script>','');
swap('<script src="js/loader.js"></script>','<script type="module">\n'+safe(moduleCode)+'\n</script>');
// every remaining local <script src="..."></script> becomes an inline script, in place
html=html.replace(/<script src="(js\/[^"]+)"><\/script>/g,(m,p)=>'<script>\n'+safe(rd(p))+'\n</script>');
fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'dist/index.single.html'),html);
console.log('wrote dist/index.single.html ('+Math.round(html.length/1024)+' KB)');
