/* ==========================================================================
 * js/core/idle.js  (v54.8)
 *
 * AUTOMATIC IDLE, and the expiry of a timed custom status.
 *
 * WHAT THE BRIEF ASKED FOR, AND HOW EACH PART IS HANDLED
 *
 *   "Switch Online to Idle after a reasonable threshold"
 *       IDLE_AFTER_MS below. Ten minutes, which is Discord's own.
 *
 *   "Return to Online when active"
 *       Only when THIS code was what set Idle. See the ownership flag below.
 *
 *   "Do not override manually selected DND / Invisible"
 *       Nothing here writes a status unless the chosen status is exactly 'online' (to go idle)
 *       or exactly 'idle' AND we are the ones who set it (to come back). Do Not Disturb and
 *       Invisible are never touched, and neither is an Idle the person picked themselves.
 *
 *   "Handle browser tab visibility"
 *       Hiding a tab is not evidence of anything — the person may be reading something else on
 *       the same screen — so it does not start a countdown of its own. Becoming visible again
 *       IS activity, and is treated as such.
 *
 *   "Do not treat a hidden tab's background timer as reliable proof of inactivity"
 *       This is why the decision is made from a WALL-CLOCK comparison (now - lastActivity) that
 *       is re-evaluated on each tick, rather than by counting ticks. Browsers throttle timers in
 *       background tabs to once a minute or stop them entirely, so a tick count is not time.
 *       A throttled tab therefore reaches the same conclusion late rather than wrongly.
 *
 *   "Avoid status flickering"
 *       A write only happens when the status would actually change, and MIN_WRITE_GAP_MS puts a
 *       floor under how often this module may write at all. The activity listeners are
 *       throttled to one timestamp update per second, so a mouse moving across the window costs
 *       one assignment rather than hundreds.
 *
 *   "Avoid duplicate timers"
 *       One interval for the page, created once, guarded by _timer.
 *
 *   "Handle multiple tabs appropriately"
 *       Activity in ANY tab of this account counts for all of them. The last activity time is
 *       shared through localStorage (one key per account) and every tab reads the latest of its
 *       own and the shared value, so reading in one tab does not let another decide you are
 *       away. Only one write ever lands regardless, because the status is a single shared field
 *       and a tab that finds it already correct writes nothing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not touch onlineUsers/, presence, or any listener. Being idle is a STATUS, not a
 *   disconnection: messages keep arriving and unread counts keep moving, exactly as with DND.
 * ========================================================================== */
'use strict';

const AutoIdle=(function(){
  const IDLE_AFTER_MS=10*60*1000;    // inactive this long -> Idle
  const TICK_MS=30*1000;             // how often the decision is re-evaluated
  const MIN_WRITE_GAP_MS=20*1000;    // floor under this module's own writes
  const SHARE_KEY=id=>'ich.lastActivity.'+id;
  const OWNED_KEY=id=>'ich.autoIdle.'+id;   // "the Idle currently set is ours, not theirs"

  let _timer=null,_wired=false,_lastTouch=0,_lastWrite=0,_busy=false;
  let _local=Date.now();

  /* ---- activity ---------------------------------------------------- */
  function touch(){
    const t=Date.now();
    if(t-_lastTouch<1000)return;              // throttle: one timestamp per second at most
    _lastTouch=t;_local=t;
    const me=myIdOrNull();
    if(me==null)return;
    try{localStorage.setItem(SHARE_KEY(me),String(t))}catch(_){}
    /* Coming back from an automatic Idle is the one case where waiting up to TICK_MS would be
       noticeable to the person themselves, so it is handled immediately rather than on the next
       tick. Going idle can afford to wait; coming back cannot. */
    if(owned(me)&&DB.chosenStatusOf(me)==='idle')wake();
  }
  function lastActivity(){
    const me=myIdOrNull();
    let shared=0;
    if(me!=null){try{shared=Number(localStorage.getItem(SHARE_KEY(me)))||0}catch(_){}}
    return Math.max(_local,shared);           // any tab's activity counts for all of them
  }

  function myIdOrNull(){
    try{return(typeof ME!=='undefined'&&ME&&Number.isFinite(Number(ME.id)))?Number(ME.id):null}
    catch(_){return null}
  }
  function owned(id){try{return localStorage.getItem(OWNED_KEY(id))==='1'}catch(_){return false}}
  function setOwned(id,on){
    try{if(on)localStorage.setItem(OWNED_KEY(id),'1');else localStorage.removeItem(OWNED_KEY(id))}catch(_){}
  }

  /* ---- the two transitions ----------------------------------------- */
  async function sleepToIdle(){
    const me=myIdOrNull();if(me==null||_busy)return;
    if(DB.chosenStatusOf(me)!=='online')return;        // DND / Invisible / already Idle: not ours
    if(Date.now()-_lastWrite<MIN_WRITE_GAP_MS)return;
    _busy=true;
    try{
      setOwned(me,true);                               // claim BEFORE the write, so a reload mid-flight still knows
      await DB.setStatus(me,'idle');
      _lastWrite=Date.now();
    }catch(e){setOwned(me,false);console.warn('[AutoIdle] could not go idle',e&&(e.code||e.message))}
    finally{_busy=false}
  }
  async function wake(){
    const me=myIdOrNull();if(me==null||_busy)return;
    if(!owned(me))return;                              // they chose Idle themselves — leave it
    if(DB.chosenStatusOf(me)!=='idle'){setOwned(me,false);return}   // they changed it; drop the claim
    if(Date.now()-_lastWrite<MIN_WRITE_GAP_MS)return;
    _busy=true;
    try{
      await DB.setStatus(me,'online');
      setOwned(me,false);
      _lastWrite=Date.now();
    }catch(e){console.warn('[AutoIdle] could not return to online',e&&(e.code||e.message))}
    finally{_busy=false}
  }

  /* ---- timed custom status (section 5.3) ---------------------------
     style/customStatusUntil is a millisecond timestamp, 0 or absent meaning "never". The
     client that owns the status is what clears it — there is no server-side scheduler here and
     inventing one would mean a Cloud Function this project deliberately does not have. So an
     expired status stops being DISPLAYED by every client the moment they look at it (see
     DB.customStatusOf) and is actually DELETED by its owner's next tick. That ordering matters:
     the display rule is what makes expiry correct for everybody, and the delete is what stops
     the record accumulating. */
  async function sweepCustomStatus(){
    const me=myIdOrNull();if(me==null)return;
    try{
      const u=DB.getUser(me);
      const st=u&&u.style;if(!st)return;
      const until=Number(st.customStatusUntil||0);
      if(!until||until>Date.now())return;
      if(!st.customStatus&&!st.customStatusUntil)return;
      await DB.setCustomStatus(me,'');                 // clears text and term together
    }catch(e){console.warn('[AutoIdle] custom status sweep failed',e&&(e.code||e.message))}
  }

  /* ---- the loop ---------------------------------------------------- */
  function tick(){
    const me=myIdOrNull();if(me==null)return;
    sweepCustomStatus();
    const idleFor=Date.now()-lastActivity();
    if(idleFor>=IDLE_AFTER_MS)sleepToIdle();
    else if(owned(me)&&DB.chosenStatusOf(me)==='idle')wake();
  }

  function start(){
    if(_wired)return;
    _wired=true;
    /* Passive and capturing, so a click on anything counts without any of these handlers being
       able to interfere with it. */
    const opts={passive:true,capture:true};
    ['pointerdown','pointermove','keydown','wheel','touchstart','focus'].forEach(ev=>{
      try{window.addEventListener(ev,touch,opts)}catch(_){}
    });
    try{
      document.addEventListener('visibilitychange',()=>{
        /* Becoming visible is activity. Becoming hidden is not evidence of absence and starts
           no countdown of its own — the wall-clock comparison in tick() is what eventually
           notices, whenever this tab's timer is next allowed to run. */
        if(document.visibilityState==='visible')touch();
      });
    }catch(_){}
    if(!_timer)_timer=setInterval(()=>{try{tick()}catch(_){}},TICK_MS);
    _local=Date.now();
  }
  /* Called from DB's account-cache reset: the next account must not inherit this one's
     activity time or its "the Idle on screen is ours" claim. */
  function reset(){
    _local=Date.now();_lastTouch=0;_lastWrite=0;
  }

  return{start,reset,touch,tick,IDLE_AFTER_MS,
         /* for the tests and the diagnostics */
         _state:()=>({lastActivity:lastActivity(),idleForMs:Date.now()-lastActivity(),
                      owned:(function(){const m=myIdOrNull();return m==null?null:owned(m)})()})};
})();
function idleStateReset(){try{AutoIdle.reset()}catch(_){}}
try{window.AutoIdle=AutoIdle}catch(_){}
