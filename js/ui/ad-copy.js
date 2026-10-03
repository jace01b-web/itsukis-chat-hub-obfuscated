/* ==========================================================================
 * js/ui/ad-copy.js
 * "Copy" button on the ad-space promo
 * Plain (non-module) script that runs in place while the page is parsed - see its <script> tag in index.html.
 * ========================================================================== */
  (function(){
    var b=document.getElementById('adCopy');if(!b)return;
    b.addEventListener('click',function(){
      var t='AniItsuki',tag=b.querySelector('.ad-copy'),done=function(){
        b.classList.add('ok');if(tag)tag.textContent='copied!';
        setTimeout(function(){b.classList.remove('ok');if(tag)tag.textContent='copy'},1600);
      };
      try{navigator.clipboard.writeText(t).then(done,done)}catch(e){done()}
    });
  })();
