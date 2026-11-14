/* ==========================================================================
 * js/core/perf.js  (v54.8)
 *
 * Counters for the work the app actually does, so "it feels laggy" can be turned into a number
 * and the number can be compared before and after a change.
 *
 * WHY THIS EXISTS
 *   v54.7 shipped an "anti-lag mode" that suppressed CSS animations. That is a real thing to
 *   offer, and it is not a fix for lag caused by JavaScript doing too much work: you cannot
 *   tell whether a render loop got cheaper by looking at whether transitions are disabled. The
 *   brief asked for measurements rather than claims, and this is what produces them.
 *
 * WHAT IT COSTS
 *   An integer increment per counted event, and one performance.now() pair per timed block.
 *   Nothing is allocated per event, nothing is stored per event, and there is no array that
 *   grows. The timing calls are deliberately only on the handful of blocks that matter
 *   (renderChat, the member list, the notification scan) rather than sprinkled everywhere.
 *
 * WHAT IT DOES NOT DO
 *   It does not sample, it does not send anything anywhere, and it keeps no history: it is a
 *   set of running totals since the page loaded or since the last reset(). Reading it is free.
 *
 * HOW TO USE IT
 *   In the browser console, or from the owner control center's Diagnostics section:
 *
 *       Perf.report()          every counter, plus derived rates
 *       Perf.reset()           zero them (does not touch listeners/caches)
 *       Perf.table()           the same thing as a printable string
 *
 *   From code:
 *       Perf.hit('emits')                       count one event
 *       Perf.add('pingMsgsScanned', n)          add n
 *       Perf.time('renderChat', () => {...})    count one call AND accumulate its duration
 * ========================================================================== */
'use strict';

const Perf=(function(){
  /* Every counter is declared here rather than created on first use, so report() has a stable
     shape and a typo in a hit() call shows up as a zero that never moves instead of silently
     inventing a new field. */
  const COUNTERS=[
    'emits',              // DB.emit() calls (BEFORE coalescing)
    'flushes',            // coalesced onChange flushes that actually ran listeners
    'onChangeCbs',        // individual subscriber callbacks run
    'renderChat',         // full chat rebuilds
    'renderChatSkipped',  // rebuilds avoided because nothing relevant changed (v54.8)
    'presenceOnly',       // cheap presence-only refreshes taken instead of a rebuild (v54.8)
    'msgRows',            // message rows written to the DOM
    'memberRenders',      // member-list rebuilds
    'memberRows',         // member rows written to the DOM
    'pingScans',          // checkPingNotifications() runs that did work
    'pingScansSkipped',   // runs that returned early (v54.8)
    'pingMsgsScanned',    // messages examined by those runs — the number that was unbounded
    'pingMsgsInScope',    // messages the PRE-v54.8 scan would have walked, same run (v54.8)
    'profileOpens',
    'channelSwitches',
    'ctxMenus'
  ];
  const TIMERS=['renderChat','memberRenders','pingScans'];

  const c={},t={};
  COUNTERS.forEach(k=>c[k]=0);
  TIMERS.forEach(k=>t[k]=0);
  let startedAt=Date.now();

  const now=()=>{try{return performance.now()}catch(_){return Date.now()}};

  function hit(k){if(c[k]!==undefined)c[k]++}
  function add(k,n){if(c[k]!==undefined)c[k]+=(Number(n)||0)}
  /* Counts the call and accumulates its wall time. Rethrows: a timer must never change whether
     the thing it is measuring succeeded. */
  function time(k,fn){
    const a=now();
    hit(k);
    try{return fn()}
    finally{if(t[k]!==undefined)t[k]+=now()-a}
  }

  /* How many Firebase listeners are live. Asked of the DB layer rather than counted here, so
     this cannot drift from the truth. */
  function listeners(){
    try{if(typeof DB!=='undefined'&&DB.listenerCount)return DB.listenerCount()}catch(_){}
    try{if(window.__FAKE&&window.__FAKE.listenerCount)return window.__FAKE.listenerCount()}catch(_){}
    return null;
  }

  function report(){
    const secs=Math.max(0.001,(Date.now()-startedAt)/1000);
    const out={sinceSeconds:Math.round(secs*10)/10,listeners:listeners()};
    COUNTERS.forEach(k=>out[k]=c[k]);
    TIMERS.forEach(k=>{
      out[k+'Ms']=Math.round(t[k]*10)/10;
      out[k+'AvgMs']=c[k]?Math.round(t[k]/c[k]*100)/100:0;
    });
    out.rendersPerSecond=Math.round(c.renderChat/secs*100)/100;
    out.emitsPerSecond=Math.round(c.emits/secs*100)/100;
    /* The two ratios the brief is really asking about: how much of the work was avoidable. */
    out.renderAvoidedPct=(c.renderChat+c.renderChatSkipped+c.presenceOnly)
      ? Math.round((c.renderChatSkipped+c.presenceOnly)/(c.renderChat+c.renderChatSkipped+c.presenceOnly)*1000)/10 : 0;
    out.pingScanAvoidedPct=(c.pingScans+c.pingScansSkipped)
      ? Math.round(c.pingScansSkipped/(c.pingScans+c.pingScansSkipped)*1000)/10 : 0;
    /* Measured in the SAME run rather than compared against a remembered figure: in-scope is
       what the old whole-array walk would have examined, scanned is what the incremental walk
       actually examined. */
    out.pingMsgsAvoidedPct=c.pingMsgsInScope
      ? Math.round((1-c.pingMsgsScanned/c.pingMsgsInScope)*1000)/10 : 0;
    return out;
  }
  function reset(){COUNTERS.forEach(k=>c[k]=0);TIMERS.forEach(k=>t[k]=0);startedAt=Date.now();return true}
  function table(){
    const r=report();
    return Object.keys(r).map(k=>String(k).padEnd(22)+' '+String(r[k])).join('\n');
  }

  /* Where the Firebase listeners actually are. Asked of the DB layer at call time — DB is
     declared later in the same module scope, so this works without a load-order dependency. */
  function breakdown(){
    try{if(typeof DB!=='undefined'&&DB.listenerBreakdown)return DB.listenerBreakdown()}catch(_){}
    return null;
  }

  return{hit,add,time,report,reset,table,listeners,breakdown,COUNTERS,TIMERS};
})();

/* The site is served as ONE module (see index.html / build-single.js), so a top-level const is
   module-scoped and not reachable from the console. Perf is documented as a console tool and is
   read by test/run-perf.js, both of which need it on window — so it is exported, the same way
   js/features/voice-channel.js and js/features/halloween.js export theirs.
   It is read-only in effect: nothing outside this file writes a counter except through hit/add,
   and nothing anywhere branches on a counter's value, so a page that tampered with it would be
   lying to its own diagnostics and nothing more. */
try{window.Perf=Perf}catch(_){}
