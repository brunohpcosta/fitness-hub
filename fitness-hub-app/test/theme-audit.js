/**
 * Theme and accessibility audit.
 *
 * Two jobs:
 *   1. No colour may be hardcoded outside the token blocks. One stray hex is
 *      all it takes for a theme to look broken, and it will not be obvious in
 *      whichever theme you happen to be using.
 *   2. Every token carrying text must meet WCAG AA (4.5:1) against the surface
 *      it sits on, in BOTH themes. This caught --t3 at 2.91:1 in the shipped
 *      dark theme — the colour every explanatory note is written in.
 */
const fs=require('fs');
const html=fs.readFileSync(process.argv[2]||'fitness-hub-app/public/index.html','utf8');
// Comments are stripped first — the token-block documentation mentions the
// selectors by name, and indexOf happily matched the prose instead of the rule.
const css=html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g,'');
const js=html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

let pass=0,fail=0;
const t=(n,c,d)=>{ c?(console.log('  ok   '+n),pass++):(console.log('  FAIL '+n+(d?' -> '+d:'')),fail++); };

// ── token blocks ──
const darkBlock  = css.slice(css.indexOf(':root, [data-theme="dark"]'), css.indexOf('[data-theme="light"]'));
const lightStart = css.indexOf('[data-theme="light"]');
const lightBlock = css.slice(lightStart, css.indexOf('}', css.indexOf('--heat-run:22'))+1);
const body       = css.slice(css.indexOf('}', css.indexOf('--heat-run:22'))+1);

function tokens(block){
  const o={};
  for(const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) o[m[1]]=m[2].trim();
  return o;
}
const DARK=tokens(darkBlock), LIGHT=tokens(lightBlock);

t('dark token block found', Object.keys(DARK).length>20, Object.keys(DARK).length+' tokens');
t('light token block found', Object.keys(LIGHT).length>20, Object.keys(LIGHT).length+' tokens');

// every colour token in dark has a light counterpart
const colourish=k=>/^--(bg|s\d|t\d|line|accent|on-accent|blue|green|amber|violet|teal|chrome|overlay|gridline|axlab|warn|ok|info|pill|needed|heat)/.test(k);
const missing=Object.keys(DARK).filter(k=>colourish(k)&&!(k in LIGHT));
t('every colour token is defined in both themes', missing.length===0, missing.join(', '));

// ── no hardcoded colours outside the token blocks ──
const strayCss=[...body.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g)].map(m=>m[0]);
t('no hardcoded colours in the CSS body', strayCss.length===0, strayCss.join(' '));
const jsNoComments=js.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
const strayJs=[...jsNoComments.matchAll(/#[0-9a-fA-F]{3,6}\b|rgba?\(\s*\d/g)].map(m=>m[0]);
t('no hardcoded colours in generated markup', strayJs.length===0, strayJs.join(' '));

// ── contrast ──
const srgb=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
const lum=hex=>{let h=hex.replace('#','');if(h.length===3)h=[...h].map(c=>c+c).join('');
  const [r,g,b]=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
  return 0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b);};
const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)];const hi=Math.max(x,y),lo=Math.min(x,y);return (hi+0.05)/(lo+0.05);};
const hex=v=>/^#[0-9a-fA-F]{3,6}$/.test(v)?v:null;

// text tokens, and the surface each is read against
const CHECKS=[
  ['--t1','--s1',4.5],['--t2','--s1',4.5],['--t3','--s1',4.5],
  ['--t1','--bg',4.5],['--t2','--bg',4.5],['--t3','--bg',4.5],
  ['--accent','--s1',4.5],['--warn-text','--s1',4.5],
  ['--ok-text','--s1',4.5],['--info-text','--s1',4.5],
  ['--axlab','--s1',3.0],
];
for(const [themeName,T] of [['dark',DARK],['light',LIGHT]]){
  for(const [fg,bg,min] of CHECKS){
    const f=hex(T[fg]||DARK[fg]), b=hex(T[bg]||DARK[bg]);
    if(!f||!b){ t(`${themeName} ${fg} on ${bg}`, false, 'not a plain hex'); continue; }
    const r=ratio(f,b);
    t(`${themeName} ${fg} on ${bg} >= ${min}`, r>=min, r.toFixed(2)+':1');
  }
  const on=hex(T['--on-accent']||DARK['--on-accent']), ac=hex(T['--accent-fill']);
  if(on&&ac) t(`${themeName} button text on accent-fill >= 4.5`, ratio(on,ac)>=4.5, ratio(on,ac).toFixed(2)+':1');
  const acc=hex(T['--accent']);
  if(acc) t(`${themeName} accent as text on card >= 4.5`, ratio(acc,hex(T['--s1']))>=4.5, ratio(acc,hex(T['--s1'])).toFixed(2)+':1');
}

// ── interaction and motion ──
t('reduced motion is honoured', /prefers-reduced-motion[\s\S]*animation:\s*none/.test(css));
t('tappable elements have an active state', /:active\{transform:scale/.test(css));
t('theme follows the system by default', js.includes("prefers-color-scheme"));
t('theme choice is remembered', js.includes("fh_theme"));
t('status bar colour tracks the theme', js.includes('meta[name="theme-color"]'));
t('content loading states use skeletons',
  (js.match(/innerHTML\s*=\s*'<div class="note">Loading/g)||[]).length===0);

// ── touch targets ──
const small=[];
for(const m of body.matchAll(/([.#][\w-]+(?:\s+\w+)?)\{([^}]*)\}/g)){
  const sel=m[1], b=m[2];
  if(!/button|\.btn|\.rate|\.rd/.test(sel)) continue;
  const hm=b.match(/height:\s*(\d+)px/);
  if(hm && +hm[1] < 36) small.push(`${sel} ${hm[1]}px`);
}
t('no tap target under 36px', small.length===0, small.join(', '));

// ── iOS will zoom the viewport on any form control under 16px ──
const formRules=[...body.matchAll(/([^{}]*(?:input|select|textarea)[^{}]*)\{([^}]*)\}/g)];
const tooSmall=formRules.filter(m=>{const f=m[2].match(/font-size:\s*([\d.]+)px/);return f&&+f[1]<16;})
  .map(m=>m[1].trim()+' '+m[2].match(/font-size:\s*([\d.]+)px/)[1]+'px');
t('no form control under 16px (iOS focus zoom)', tooSmall.length===0, tooSmall.join(', '));
t('base form font-size is 16px', /button,input,select,textarea\{[^}]*font-size:16px/.test(css));
// pan-x pan-y removes double-tap zoom as well as pinch, and the touchend
// handler is the fallback for iOS versions that ignore it.
t('double-tap zoom suppressed', /touch-action:pan-x pan-y/.test(css) && /lastTap/.test(js));
t('Safari gesture events blocked', /gesturestart/.test(js) && /preventDefault/.test(js));
const vp=(html.match(/<meta name="viewport"[^>]*>/)||[''])[0];
// Pinch is disabled via touch-action, not the viewport meta — iOS ignores the
// meta, so putting it there would look like it worked while doing nothing.
t('viewport meta not used to block zoom', !/user-scalable\s*=\s*no|maximum-scale/.test(vp), vp);
t('pinch zoom disabled via touch-action', /html,body\{touch-action:pan-x pan-y\}/.test(css));
t('no element re-enables pinch with manipulation',
  !/touch-action:\s*manipulation/.test(css));

// ── structure ──
const ids=[...html.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]);
const dupIds=[...new Set(ids.filter(i=>ids.filter(x=>x===i).length>1))].filter(i=>i!=='modaltitle');
t('no duplicate element ids', dupIds.length===0, dupIds.join(', '));

const rest=html.replace(css,'');
// The trailing character class includes "." so the leading class of a compound
// selector is checked too; without it `.card.tap` never tested `card` at all.
//
// This only proves each NAME is used somewhere. It cannot prove a compound is
// real: `.card.tap` passes here because both words appear in the markup, just
// never on the same element. Pairs are checked in render-assert.js, against
// the rendered output, where the elements actually exist.
const declared=[...new Set([...body.matchAll(/\.([a-zA-Z][\w-]*)\s*[,{:. ]/g)].map(m=>m[1]))];
const unused=declared.filter(c=>!new RegExp('[\\s"\'+]'+c+'[\\s"\'+]').test(rest));
t('no dead CSS rules', unused.length===0, unused.join(', '));

// ── the page must never render wider than the screen ──
// iOS answers horizontal overflow by shrinking the whole page to fit, which is
// indistinguishable from a zoom-out that will not come back. A single 46-char
// URL in a message was enough to do it.
t('horizontal overflow is clamped', /html,body\{[^}]*overflow-x:hidden/.test(css));
t('long unbroken strings can wrap', /overflow-wrap:\s*anywhere/.test(css));
t('scale floor set to 1', /minimum-scale=1/.test(html));
const nowrap=[...body.matchAll(/([^{}]+)\{([^}]*white-space:\s*nowrap[^}]*)\}/g)]
  .filter(m=>!/overflow/.test(m[2])).map(m=>m[1].trim());
t('no nowrap without an overflow guard', nowrap.length===0, nowrap.join(', '));

console.log('\n  '+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0);
