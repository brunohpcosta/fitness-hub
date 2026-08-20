const fs=require('fs');
const O=JSON.parse(fs.readFileSync('/tmp/fh-rendered.json','utf8'));
let pass=0,fail=0;
function t(name,cond,detail){
  if(cond){console.log('  ok   '+name);pass++;}
  else{console.log('  FAIL '+name+(detail?' -> '+detail:''));fail++;}
}
const g=k=>O[k]||'';

// ── calendar: a full month, not "up to today" ──
const cells=(g('calgrid').match(/class="cd tap/g)||[]).length;
const empties=(g('calgrid').match(/class="cd empty"/g)||[]).length;
t('calendar renders a full month of day cells', cells>=28&&cells<=31, cells+' cells');
t('calendar pads the leading week', empties>=0&&empties<=6, empties+' pad cells');
t('calendar days are tappable', g('calgrid').includes('onclick="dayModal('));
t('calendar shades load', g('calgrid').includes('cheat'));
t('calendar has month stats', (g('calstats').match(/calstat/g)||[]).length===4);
t('calendar month label set', (O['calmonth:text']||'').length>0, O['calmonth:text']);

// ── chart alignment ──
const cg=g('loadcard');
const m=cg.match(/grid-template-columns:repeat\((\d+),minmax\(0,1fr\)\)/);
t('weekly chart uses a fixed grid', !!m, m?m[1]+' columns':'no grid');
if(m){
  const n=+m[1];
  t('chart value cells match column count', (cg.match(/class="cv"/g)||[]).length===n);
  t('chart bar cells match column count', (cg.match(/class="cb/g)||[]).length===n);
  t('chart label cells match column count', (cg.match(/class="cl/g)||[]).length===n);
}
t('chart marks the current week', cg.includes('cb now'));
t('chart labels are readable words', /this|last|\dw/.test(cg));

// ── diet ──
t('days-ahead shows fat', /\dF</.test(g('dietahead'))||/F<\/div>/.test(g('dietahead')), g('dietahead').slice(0,0));
t('days-ahead shows protein and carbs too', /P ·/.test(g('dietahead')));
t('days-ahead flags carb load', g('dietahead').includes('carb load'));
t('14-day history marks missing days', g('diethistory').includes('not logged'));
t('14-day history shows all 14 days', (g('diethistory').match(/class="row/g)||[]).length===14,
   (g('diethistory').match(/class="row/g)||[]).length+' rows');
t('balance tool states an ideal', /Ideal today/.test(g('dietratio')));

// ── run detail modal ──
t('run modal opens with stats', g('modalcard').length>200);
t('run modal is honest about splits', g('modalcard').includes('Not captured')||g('modalcard').includes('not captured'));

// ── fuel calculator ──
t('calculator computes 11 serves', O['vn:text']==='11', 'got '+O['vn:text']);
t('calculator interval is 20m', O['vint:text']==='20m', 'got '+O['vint:text']);
t('calculator total carbs 262 at the verified 23.8 g gel', O['vc:text']==='262', 'got '+O['vc:text']);
t('calculator warns on caffeine', g('fuelwarn').includes('mg caffeine'));
t('calculator flags the sodium shortfall', g('fuelwarn').includes('Sodium shortfall'));
t('sodium warning names a figure to make up', /\d+ mg from an electrolyte|mg from an electrolyte/.test(g('fuelwarn')));

// ── honesty checks: gaps must read as gaps ──
t('goals show tracked-only state', g('goalslist').includes('no target set'));
t('body chart states how many days had no weigh-in', /no weigh-in|readings across/.test(g('bodychart')));
t('photo comparison renders both slots', g('bodyphotos').includes('id="ph-l"')&&g('bodyphotos').includes('id="ph-r"'));
t('no NaN anywhere in output', !JSON.stringify(O).includes('NaN'));
t('no undefined anywhere in output', !JSON.stringify(O).includes('>undefined<'));
t('no [object Object] leaks', !JSON.stringify(O).includes('[object Object]'));

// ── added after the second round of phone feedback ──
t('photo dates carry the year', /20\d\d</.test(g('bodyphotos')));
t('photos use a two-column grid, not .cols', g('bodyphotos').includes('class="pview"'));
t('each photo shows measurements', (g('bodyphotos').match(/class="pmeta/g)||[]).length===2);
t('weight chart has period buttons', g('bodychart').includes('id="wseg"'));
t('weight chart has axis labels', g('bodychart').includes('axlab'));
t('weight chart plots a 7-day average', g('bodychart').includes('7-day average'));
t('check-in marks required fields', g('hublog').includes('needed')||g('hublog').includes('complete'));
t('running tab lists upcoming sessions', g('nextruns').length>100);
t('upcoming sessions carry the why', g('nextruns').includes('Why this session'));

// ── regression: the gate must never destroy tab markup ──
t('gate is a separate overlay, not tab innerHTML',
  !/\$\('p-'\+id\)\.innerHTML/.test(require('fs').readFileSync('/tmp/fh-app.js','utf8')));
t('check-in prefills saved values, not placeholders',
  !/placeholder="'\+\s*\(existing\.hours_slept/.test(require('fs').readFileSync('/tmp/fh-app.js','utf8')));

t('photos are not cropped to a fixed box',
  !/\.pcol img\{[^}]*object-fit:\s*cover/.test(require('fs').readFileSync('/sessions/sharp-jolly-lovelace/mnt/fitness-hub/fitness-hub-app/public/index.html','utf8')));
// The harness records elements flat rather than nesting, so this content is
// recorded under its own id even though it renders inside the composition card.
t('scale capture is one compact line, not a chart',
  /class="capline"/.test(g('bodycapture')) && !/class="cpb"/.test(g('bodycapture')));
t('capture line shows recent months', (g('bodycapture').match(/·/g)||[]).length>=3);

// ── photos: estimates must never masquerade as measurements ──
t('photo upload slots render', /class="slots"/.test(g('photoupload')));
t('upload states the automatic naming', /-view\.jpg/.test(g('photoupload')));
t('comparison uses week averages, not single weigh-ins',
  /7-day average either side/.test(g('bodyphotos')) || !/class="info"/.test(g('bodyphotos')));
t('photo notes field present', /id="pnote"/.test(g('bodyphotos')));
t('body fat is not compared across scales',
  !/Body fat .*%, same device only/.test(g('bodyphotos')));
t('converted figures are marked', !/Week avg fat/.test(g('bodyphotos')) || /converted to the/.test(g('bodyphotos')));

// These two used to fire on the mere presence of the words "Body fat" and
// "Lean mass", which meant they reported a same-device panel as an undeclared
// conversion. Keyed to the marker the app actually emits instead: a value
// carrying "*" is a converted one, and a converted one must have its footnote.
//
// The corresponding positive case — that a Zepp-era panel really does produce
// both the marker and the footnote — is proved in render-harness.js, because a
// check that can only pass proves nothing.
(function(){
  const p=g('bodyphotos');
  const marked=/\d\s*(?:kg|%)\s*~?\*/.test(p);
  const declared=/converted from .* to the .* scale/.test(p);
  t('a converted figure always carries its footnote', marked===declared,
    'marked='+marked+' declared='+declared);
  const fatCompared=/Body fat [\d.]+% to [\d.]+%/.test(p);
  t('cross-device fat comparison declares its basis',
    !fatCompared || /both |readings converted|no calibration/.test(p));
})();

// ── the three composition figures must always square with each other ──
// A panel showing an exact weight beside a week-averaged lean mass could not
// be reconciled by anyone reading it, and that is what prompted this check.
(function(){
  var panels=g('bodyphotos').split('class="pmeta').slice(1);
  var checked=0, bad=[];
  panels.forEach(function(p){
    var txt=p.split('</div>\n')[0].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
    var m=txt.match(/Weight ([\d.]+) kg [~*]*\s*Body fat ([\d.]+) % [~*]*\s*Lean mass ([\d.]+)/);
    if(!m)return;
    checked++;
    var w=+m[1], f=+m[2], l=+m[3];
    if(Math.abs(w*(1-f/100)-l) > 0.2) bad.push(w+'/'+f+'/'+l);
  });
  t('composition figures reconcile (lean = weight x (1-bf))',
    checked>0 && bad.length===0, checked?('checked '+checked+', bad: '+bad.join(' ')):'no panels parsed');
})();

// ── the fixture must describe the API the Worker actually serves ──
// The settings stub drifted out of date once already: the Worker gained four
// calibration keys, the fixture kept three unrelated ones, and a real test
// failed for a fabricated reason. Comparing the two lists directly means the
// next divergence is reported as itself.
(function(){
  const path=require('path');
  const root=path.resolve(__dirname,'..','..');
  let worker='',fx='';
  try{ worker=fs.readFileSync(path.join(root,'fitness-hub-api','src','index.js'),'utf8'); }catch(e){}
  try{ fx=fs.readFileSync(path.join(__dirname,'fixtures.py'),'utf8'); }catch(e){}
  if(!worker||!fx){ t('fixture settings match the Worker',false,'could not read both files'); return; }

  const block=worker.match(/settings:\s*\{([\s\S]*?)\n\s*\},/);
  const served=block?[...block[1].matchAll(/^\s*([a-z0-9_]+):/gm)].map(x=>x[1]):[];
  const listed=fx.match(/EXPOSED_SETTINGS\s*=\s*\[([\s\S]*?)\]/);
  const fixed=listed?[...listed[1].matchAll(/"([a-z0-9_]+)"/g)].map(x=>x[1]):[];

  const missing=served.filter(k=>fixed.indexOf(k)<0);
  const extra=fixed.filter(k=>served.indexOf(k)<0);
  t('fixture settings match the Worker', served.length>0&&!missing.length&&!extra.length,
    served.length?('missing ['+missing.join(',')+'] extra ['+extra.join(',')+']'):'no settings block found');
})();

// ── motion ──
// Animation is the one thing that can look finished while being wrong, because
// nothing about it throws. These check the properties that matter: that motion
// is defined once as tokens, that it can be turned off, and that entrance
// animations are keyed to a tab change rather than to rendering.
(function(){
  const path=require('path');
  const html=fs.readFileSync(path.resolve(__dirname,'..','public','index.html'),'utf8');
  const css=(html.match(/<style>([\s\S]*?)<\/style>/)||[])[1]||'';
  const js=(html.match(/<script>([\s\S]*?)<\/script>/)||[])[1]||'';

  t('motion tokens are defined', /--t-fast:/.test(css)&&/--e-out:/.test(css)&&/--e-spring:/.test(css));

  // Every duration should come from a token. A stray hardcoded value is how an
  // interface ends up moving at four different speeds.
  // The two infinite loops are exempt: shimmer and the gate pulse are ambient
  // rhythms, not UI response, and tying them to the interaction tokens would
  // mean changing a loop's tempo whenever a button's timing was adjusted.
  const strays=(css.match(/(?:transition|animation)(?:-duration)?:[^;}]*/g)||[])
    .filter(d=>/\b\d*\.?\d+m?s\b/.test(d))
    .filter(d=>!/shimmer|pulse/.test(d));
  t('durations come from tokens, not literals', strays.length===0, strays.slice(0,3).join(' | '));

  t('reduced motion disables transitions and animations',
    /prefers-reduced-motion:reduce\)\s*\{[\s\S]*?\*\s*\{[\s\S]*?transition:none!important[\s\S]*?animation:none!important/.test(css));
  t('reduced motion also clears delays',
    /prefers-reduced-motion:reduce\)[\s\S]*?animation-delay:0ms!important/.test(css));
  t('JS motion respects the same setting', /prefers-reduced-motion: reduce/.test(js));

  // The Hub refreshes on visibilitychange and after every save. If the
  // entrance were keyed to render it would replay on each of those.
  t('entrance is keyed to tab change, not render',
    /var changed=\(id!==CURRENT_TAB\)/.test(js)&&/if\(changed\)playOnce/.test(js));
  t('entering class is removed after it plays', /el\.classList\.remove\(cls\)/.test(js));
  t('gate is not rewritten when unchanged', /el\.dataset\.miss===key\)return/.test(js));

  // Exits have to be given time to be seen, and must not be startable twice.
  t('modal animates out before hiding',
    /#modal\.closing/.test(css)&&/classList\.add\('closing'\)/.test(js));
  t('closing twice is a no-op',
    (js.match(/classList\.contains\('closing'\)\)return/g)||[]).length>=2);
  // Hiding happens on a timer. Reopening within that window must cancel it, or
  // the dialog closes itself moments after opening.
  t('reopening cancels a pending close',
    /clearTimeout\(MODAL_CLOSE_T\)/.test(js)&&/clearTimeout\(SHEET_CLOSE_T\)/.test(js));
  t('sheet rises from the bottom edge',
    /@keyframes sheetIn\{from\{transform:translateY\(100%\)\}/.test(css));

  t('toast element exists and is announced',
    /id="toast"[^>]*aria-live="polite"/.test(html));
  t('toast confirms a saved check-in', /toast\(AMEND_WAS\?/.test(js));

  // Motion should be composited. Animating width/height/top forces layout on
  // every frame, which is what makes an animated page feel cheap on a phone.
  //
  // Keyframe bodies contain nested braces, so they cannot be pulled out with a
  // lazy regex — the first attempt matched from the first @keyframes to the end
  // of the stylesheet and reported every layout property in the file.
  function keyframeBodies(src){
    const out=[];
    let i=0;
    while((i=src.indexOf('@keyframes',i))>=0){
      let b=src.indexOf('{',i); if(b<0)break;
      let depth=0,j=b;
      for(;j<src.length;j++){
        if(src[j]==='{')depth++;
        else if(src[j]==='}'){ depth--; if(!depth){j++;break;} }
      }
      out.push(src.slice(b,j));
      i=j;
    }
    return out.join(' ');
  }
  const kf=keyframeBodies(css);
  const layoutProps=kf.match(/\b(?:width|height|top|left|right|bottom|margin|padding)\s*:/g)||[];
  t('keyframes animate only composited properties',
    kf.length>0&&layoutProps.length===0,
    kf.length?layoutProps.join(','):'no keyframes extracted');

  // Numbers must never count up. A rolling figure displays values that were
  // never measured, which this app does not do — not even for 300ms.
  t('no number count-up animation', !/countUp|rollNumber|animateValue/.test(js));

  // NOT CHECKED HERE: whether a compound selector like `.card.tap` describes a
  // pair of classes that ever land on the same element.
  //
  // I added a hover rule for `.card.tap` in this pass. No element in this app
  // has ever carried both, so the rule was dead on arrival, and every one of
  // the 155 checks passed. It was found by hand.
  //
  // An attempt at catching it automatically was removed rather than shipped.
  // Most class attributes in this file are assembled by concatenation —
  //     class="skel'+(i%3===1?' w60':'')+'"
  // — so parsing class="..." out of the source yields fragments, not class
  // lists, and the rendered output only covers the states the harness happens
  // to exercise. The check reported eleven live selectors as dead. Suppressing
  // those with an allowlist would have meant a passing test that proved
  // nothing, which is worse than an acknowledged gap.
  //
  // Doing it properly needs a real DOM plus render coverage of every state.
})();

console.log('\n  '+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0);
