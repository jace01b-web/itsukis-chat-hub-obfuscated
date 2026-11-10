/* ==========================================================================
 * js/discord/markdown.js - Discord's message formatting
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 *
 * What is supported, and what it looks like typed:
 *
 *   ||spoiler||          hidden until clicked
 *   **bold**             *italic*          ***bold italic***
 *   __underline__        _italic_          ___underline italic___
 *   ~~strikethrough~~
 *   `inline code`        ```fenced blocks```   (with an optional language on the first line)
 *   > quote              >>> everything after this is quoted
 *   # Heading   ## Heading   ### Heading   -# small text
 *   - bullet             * bullet
 *   [label](https://…)   a link with its own text
 *
 * SAFETY - the one thing to get right in this file.
 *
 * Everything here runs on text somebody else typed, and the output goes straight into innerHTML.
 * So the order is fixed and deliberate:
 *
 *   1. Code is lifted out FIRST, before anything else looks at the text. Markdown inside a code
 *      block is not markdown, which is the whole point of a code block.
 *   2. Every piece of text that survives to the output is passed through esc() before any tag is
 *      put around it. There is no path where raw input reaches the output.
 *   3. Finished HTML (code, links, mentions) is parked behind a placeholder token and put back at
 *      the very end, so the formatting passes can never see - or mangle - a tag they produced.
 *      The token uses NUL, which is stripped from the input on the first line, so a message
 *      cannot forge one.
 *   4. Link hrefs are only ever written by mdLink(), which accepts http(s) and nothing else. A
 *      [click me](javascript:…) is rendered as plain text, not as a link.
 * ========================================================================== */
'use strict';

const MD_MAX_CODE=4000;          // a fenced block longer than this is shown as plain text

/* Only ever called with a URL that has already been validated as http(s). */
function mdLink(url,label){
  return '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer nofollow">'+esc(label)+'</a>';
}
function mdIsHttp(u){return /^https?:\/\/[^\s<>"']+$/i.test(String(u||''))}

function mdRender(raw){
  if(raw==null)return '';
  // NUL is the parking token's delimiter, so it must not survive from the input.
  let t=String(raw).replace(/\u0000/g,'');

  const parked=[];
  const park=html=>{parked.push(html);return '\u0000'+(parked.length-1)+'\u0000'};

  /* ---- 1. code, before anything else ---- */
  // ```lang\ncode``` or ```code```
  t=t.replace(/```(?:([a-zA-Z0-9+#_-]{1,20})\n)?([\s\S]*?)```/g,(m,lang,code)=>{
    if(code.length>MD_MAX_CODE)return m;
    return park('<pre class="md-pre"><code>'+esc(code.replace(/^\n+|\n+$/g,''))+'</code></pre>');
  });
  // ``code`` then `code` - the double form lets a backtick appear inside
  t=t.replace(/``([^`\n]+)``/g,(m,code)=>park('<code class="md-code">'+esc(code)+'</code>'));
  t=t.replace(/`([^`\n]+)`/g,(m,code)=>park('<code class="md-code">'+esc(code)+'</code>'));

  /* ---- 2. escape everything that is left ---- */
  t=esc(t);

  /* ---- 3. links and mentions, parked as finished HTML ---- */
  // [label](url) - the label may itself be formatted later, so it is NOT parked with the anchor;
  // instead the anchor is built now and the label escaped, which is the safe half of the trade.
  t=t.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/gi,(m,label,url)=>{
    // `url` came out of already-escaped text, so &amp; is back to & before it is used as an href
    const real=url.replace(/&amp;/g,'&');
    if(!mdIsHttp(real))return m;
    return park(mdLink(real,label.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")));
  });
  t=mdLinkifyBare(t,park);
  t=mdMentions(t,park);

  /* ---- 4. block level, line by line ---- */
  t=mdBlocks(t);

  /* ---- 5. inline formatting ---- */
  t=mdInline(t);

  /* ---- 6. put the finished HTML back ---- */
  // Repeated until stable: a parked anchor's label can itself contain a parked mention.
  for(let i=0;i<4&&t.indexOf('\u0000')>=0;i++)
    t=t.replace(/\u0000(\d+)\u0000/g,(m,n)=>parked[Number(n)]!==undefined?parked[Number(n)]:m);
  return t;
}

/* Bare https:// URLs, same peeling of trailing punctuation the old linkify() did so a URL at the
   end of a sentence does not swallow the full stop or a closing quote. */
function mdLinkifyBare(escapedText,park){
  return escapedText.replace(/\bhttps?:\/\/[^\s<\u0000]+/gi,raw=>{
    let url=raw,trail='';
    for(;;){
      let m=url.match(/(&quot;|&#39;|&amp;)$/);
      if(m){url=url.slice(0,-m[0].length);trail=m[0]+trail;continue}
      m=url.match(/[.,!?:;'"]$/);
      if(m){url=url.slice(0,-1);trail=m[0]+trail;continue}
      if(/\)$/.test(url)&&!url.includes('(')){url=url.slice(0,-1);trail=')'+trail;continue}
      if(/\]$/.test(url)&&!url.includes('[')){url=url.slice(0,-1);trail=']'+trail;continue}
      break;
    }
    if(!url)return raw;
    const real=url.replace(/&amp;/g,'&');
    if(!mdIsHttp(real))return raw;
    return park(mdLink(real,real))+trail;
  });
}

/* @everyone / @here and @username, exactly as they worked before - this is a move, not a change. */
function mdMentions(s,park){
  s=s.replace(/@(everyone|here)\b/g,(m,w)=>park('<span class="mention everyone">@'+w+'</span>'));
  return s.replace(/@([0-9a-zA-Z._-]{1,20})/g,(full,n)=>{
    if(n==='everyone'||n==='here')return full;
    let id;
    try{id=DB.get().usernameIndex[n.toLowerCase()]}catch(_){id=undefined}
    if(id===undefined)return full;
    let u=null;try{u=DB.getUser(id)}catch(_){}
    if(!u)return full;
    const me=(typeof ME!=='undefined'&&ME&&id===ME.id)?' me':'';
    // The mention shows the DISPLAY name, like Discord, but still matches on the username -
    // that is what people type and what identifies the account.
    return park('<span class="mention'+me+'" data-open-profile="'+id+'" title="View profile">@'+esc(dispName(u))+'</span>');
  });
}

/* Block constructs are line-based. Each one that becomes a block element consumes its own
   newline, because .bubble is white-space:pre-wrap - leaving the newline in would put a blank
   line under every heading and every quote. */
function mdBlocks(s,depth){
  depth=depth||0;
  // >>> turns the rest of the message into one quote
  const tri=s.match(/(^|\n)&gt;&gt;&gt; ?([\s\S]*)$/);
  if(tri&&depth===0){
    const before=s.slice(0,tri.index+(tri[1]?tri[1].length:0));
    return mdBlocks(before,1)+'<blockquote class="md-quote">'+mdBlocks(tri[2],1)+'</blockquote>';
  }
  const lines=s.split('\n');
  const out=[];
  let i=0;
  while(i<lines.length){
    const ln=lines[i];
    // > quote, merging consecutive quoted lines into one block
    if(/^&gt; ?/.test(ln)){
      const buf=[];
      while(i<lines.length&&/^&gt; ?/.test(lines[i])){buf.push(lines[i].replace(/^&gt; ?/,''));i++}
      // Headings and bullets still format inside a quote, like Discord. depth stops a quote
      // inside a quote from recursing - Discord does not nest them either.
      const inner=depth?buf.join('\n'):mdBlocks(buf.join('\n'),1);
      out.push({block:true,html:'<blockquote class="md-quote">'+inner+'</blockquote>'});
      continue;
    }
    // -# small text
    let m=ln.match(/^-# (.*)$/);
    if(m){out.push({block:true,html:'<small class="md-sub">'+m[1]+'</small>'});i++;continue}
    // # / ## / ### headings
    m=ln.match(/^(#{1,3}) (.*)$/);
    if(m){
      const lv=m[1].length;
      out.push({block:true,html:'<div class="md-h md-h'+lv+'">'+m[2]+'</div>'});
      i++;continue;
    }
    // - / * bullets, merged into one list
    if(/^ *[-*] +\S/.test(ln)){
      const buf=[];
      while(i<lines.length&&/^ *[-*] +\S/.test(lines[i])){buf.push(lines[i].replace(/^ *[-*] +/,''));i++}
      out.push({block:true,html:'<ul class="md-ul">'+buf.map(x=>'<li>'+x+'</li>').join('')+'</ul>'});
      continue;
    }
    out.push({block:false,html:ln});i++;
  }
  // Join plain lines with newlines (pre-wrap renders them), but never put a newline next to a
  // block element - the element already breaks the line.
  let res='';
  out.forEach((p,idx)=>{
    if(idx>0){
      const prev=out[idx-1];
      if(!prev.block&&!p.block)res+='\n';
    }
    res+=p.html;
  });
  return res;
}

/* Inline formatting. Runs on escaped text whose finished HTML is parked, so there are no tags
   here to collide with - only the NUL tokens, which none of these patterns can match across
   because they all reject newlines and NUL inside the delimiters. */
function mdInline(s){
  // spoilers first, so ||**x**|| formats the inside too
  s=s.replace(/\|\|([\s\S]+?)\|\|/g,(m,x)=>'<span class="md-spoiler" role="button" tabindex="0">'+x+'</span>');
  s=s.replace(/~~([^\n]+?)~~/g,'<s>$1</s>');
  // longest delimiters first, or **x** would be eaten by *x*
  s=s.replace(/\*\*\*([^\n]+?)\*\*\*/g,'<strong><em>$1</em></strong>');
  s=s.replace(/___([^\n]+?)___/g,'<u><em>$1</em></u>');
  s=s.replace(/\*\*([^\n]+?)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/__([^\n]+?)__/g,'<u>$1</u>');
  s=s.replace(/\*([^\s*][^\n*]*?)\*/g,'<em>$1</em>');
  // _italic_ only between word boundaries, so snake_case_names are left alone
  s=s.replace(/(^|[^\w])_([^\s_][^\n_]*?)_(?![\w])/g,'$1<em>$2</em>');
  return s;
}

/* Reveal a spoiler. Delegated once, here, rather than per message. */
document.addEventListener('click',e=>{
  const sp=e.target.closest&&e.target.closest('.md-spoiler:not(.shown)');
  if(!sp)return;
  e.preventDefault();e.stopPropagation();
  sp.classList.add('shown');
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ')return;
  const sp=document.activeElement;
  if(sp&&sp.classList&&sp.classList.contains('md-spoiler')&&!sp.classList.contains('shown')){
    e.preventDefault();sp.classList.add('shown');
  }
});

/* ======================================================================
 *  PLAIN PREVIEWS
 *  Reply quotes, the composer's "Replying to" bar and anywhere else a message is shown as one
 *  short line. Discord strips the formatting there rather than rendering it, for two reasons:
 *
 *    1. Raw markup reads as noise - a reply to a code block showed up as
 *       "# Heading ```js const a=1; ``` **bold**" across the quote line.
 *    2. A SPOILER MUST NOT BE REVEALED BY SOMEBODY REPLYING TO IT. Rendering the raw text put
 *       the hidden words straight into the quote, in plain sight, above everyone's reply. That
 *       is the whole point of a spoiler, defeated by someone else's action rather than your own.
 *
 *  So this returns readable plain text with the markers removed, and spoiler CONTENT replaced
 *  rather than unwrapped.
 * ====================================================================== */
function mdPlain(raw){
  if(raw==null)return '';
  let t=String(raw);
  // spoilers first, and their content never survives
  t=t.replace(/\|\|[\s\S]+?\|\|/g,'████');
  // fenced blocks collapse to a label; a preview is not the place for code
  t=t.replace(/```(?:[a-zA-Z0-9+#_-]{1,20}\n)?[\s\S]*?```/g,'[code]');
  t=t.replace(/``([^`\n]+)``/g,'$1').replace(/`([^`\n]+)`/g,'$1');
  // masked links read as their label
  t=t.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/gi,'$1');
  // block markers at the start of a line
  t=t.replace(/^\s*&gt;&gt;&gt;\s?/gm,'').replace(/^\s*>>>\s?/gm,'');
  t=t.replace(/^\s*>\s?/gm,'');
  t=t.replace(/^\s*-#\s/gm,'');
  t=t.replace(/^\s*#{1,3}\s/gm,'');
  t=t.replace(/^\s*[-*]\s+/gm,'• ');
  // inline emphasis markers, longest first
  t=t.replace(/\*\*\*([^\n]+?)\*\*\*/g,'$1')
     .replace(/___([^\n]+?)___/g,'$1')
     .replace(/\*\*([^\n]+?)\*\*/g,'$1')
     .replace(/__([^\n]+?)__/g,'$1')
     .replace(/~~([^\n]+?)~~/g,'$1')
     .replace(/\*([^\s*][^\n*]*?)\*/g,'$1');
  return t.replace(/\s+/g,' ').trim();
}
