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
t('calculator total carbs 259', O['vc:text']==='259', 'got '+O['vc:text']);
t('calculator warns on caffeine', g('fuelwarn').includes('mg caffeine'));
t('calculator flags unverified sodium', g('fuelwarn').includes('Sodium unverified'));

// ── honesty checks: gaps must read as gaps ──
t('goals show tracked-only state', g('goalslist').includes('no target set'));
t('body chart notes gaps are not interpolated', g('bodychart').includes('never interpolated'));
t('photos empty state names the upload script', g('bodyphotos').includes('upload-photos.sh'));
t('no NaN anywhere in output', !JSON.stringify(O).includes('NaN'));
t('no undefined anywhere in output', !JSON.stringify(O).includes('>undefined<'));
t('no [object Object] leaks', !JSON.stringify(O).includes('[object Object]'));

console.log('\n  '+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0);
