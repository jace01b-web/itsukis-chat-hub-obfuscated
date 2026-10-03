/* ==========================================================================
 * js/early/load-styles.js
 * Writes the <link> tags for every file in APP_MANIFEST.css (see js/manifest.js), in order.
 * The build-version from the <meta> tag is added as ?v= so a new build never serves stale CSS.
 * ========================================================================== */
(function(){
  var m=document.querySelector('meta[name="build-version"]');
  var q=m&&m.content?'?v='+encodeURIComponent(m.content):'';
  APP_MANIFEST.css.forEach(function(f){
    document.write('<link rel="stylesheet" href="css/'+f+q+'">');
  });
})();
