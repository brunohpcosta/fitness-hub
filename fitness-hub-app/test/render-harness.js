// Headless DOM shim: enough for the app's render functions, and it RECORDS
// what each one produced so the output can be asserted on, not just "no throw".
const fs=require('fs');
const OUT={};
function el(id){
  return { id, _html:'', _text:'', _value:'', disabled:false, dataset:{},
    // A real input.value is ALWAYS a string — assigning a number coerces it.
    // The shim stored the raw number, so .trim() blew up here and nowhere else.
    set value(v){this._value = v==null ? '' : String(v);},
    get value(){return this._value;},
    style:{}, classList:{ _s:new Set(),
      add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
      toggle(c,f){f?this._s.add(c):this._s.delete(c)}, contains(c){return this._s.has(c)} },
    set innerHTML(v){this._html=String(v); OUT[this.id]=this._html;},
    get innerHTML(){return this._html;},
    set textContent(v){this._text=String(v); OUT[this.id+':text']=this._text;},
    get textContent(){return this._text;},
    addEventListener(){}, appendChild(){}, scrollIntoView(){} };
}
const NODES={};
global.document={
  getElementById(id){ return NODES[id]||(NODES[id]=el(id)); },
  querySelector(){return el('q');},
  querySelectorAll(){return [];},
  addEventListener(){},
  body:{classList:{add(){},remove(){}}},
  hidden:false
};
global.window={addEventListener(){},scrollTo(){},location:{origin:'https://bruno-fitness-hub.pages.dev'}};
global.location=global.window.location;
global.navigator={onLine:true,serviceWorker:{register(){return Promise.resolve()},
  getRegistration(){return Promise.resolve(null)},controller:null}};
global.localStorage={ _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v} };
global.caches={keys(){return Promise.resolve([])}};
global.fetch=()=>Promise.reject(new Error('no network in harness'));
global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.URL=require('url').URL;

// Strip 'use strict' and use indirect eval so declarations land in global
// scope — under strict mode eval keeps them to itself and nothing is callable.
let src=fs.readFileSync('/tmp/fh-app.js','utf8').replace(/^'use strict';\s*/,'');
(0,eval)(src);

const F=JSON.parse(fs.readFileSync('/tmp/fh-fixtures.json','utf8'));
CFG={url:'https://x',key:'y'};
DATA=F.today; DATA_AT=Date.now(); DATA_STALE=false;
PLAN=F.plan; RUNS=F.runs; RSPIKE=F.spike; SUMDAYS=F.days; DAYS14=F.days; BODYDAYS=F.days;
GOALS=F.goals; PHOTOS={count:123,unparsed:0,views:['back','front','side'],
  dates:['2026-07-11','2026-06-28','2025-02-16'],
  photos:['front','side','back'].reduce((a,v)=>a.concat(
    ['2026-07-11','2026-06-28','2025-02-16'].map(d=>({key:d+'-'+v+'.jpg',local_date:d,view:v}))),[])};
PHOTODAYS=F.days;
PVIEW='front'; PRIGHT='2026-07-11'; PLEFT='2025-02-16';

const tests=[
  ['buildNav',            ()=>buildNav()],
  ['renderHubState',      ()=>renderHubState()],
  ['renderWidgets',       ()=>renderWidgets()],
  ['renderSession',       ()=>renderSession()],
  ['renderMacros',        ()=>renderMacros()],
  ['renderLog',           ()=>renderLog()],
  ['renderRail',          ()=>renderRail()],
  ['renderRunning',       ()=>renderRunning()],
  ['renderDiet',          ()=>renderDiet()],
  ['renderDietAhead',     ()=>renderDietAhead()],
  ['renderDietHistory',   ()=>renderDietHistory()],
  ['renderDietRatio',     ()=>renderDietRatio()],
  ['renderTraining',      ()=>renderTraining()],
  ['renderBody',          ()=>renderBody()],
  ['renderPhotos',        ()=>renderPhotos()],
  ['renderUpload',        ()=>renderUpload()],
  ['renderGoals',         ()=>renderGoals()],
  ['renderSummary',       ()=>renderSummary()],
  ['renderCal',           ()=>renderCal()],
  ['dayModal today',      ()=>dayModal('2026-08-12')],
  ['dayModal empty day',  ()=>dayModal('2019-06-06')],
  ['shiftMonth back',     ()=>{shiftMonth(-1);shiftMonth(-1);}],
  ['setSumPeriod 90',     ()=>setSumPeriod(90)],
  ['fillProducts',        ()=>fillProducts()],
  ['fuel calculator',     ()=>{const g=id=>document.getElementById(id);
                               g('skm').value='42.195'; g('space').value='5.6833';
                               g('srate').value='65';   g('swt').value='79';
                               g('fp').value='1';
                               pickProd();}],
  ['idealEnergy',         ()=>idealEnergy()],
  ['barChart empty',      ()=>barChart([],{})],
  ['barChart zeros',      ()=>barChart([{value:0,label:'a'},{value:0,label:'b'}],{})],
  ['runModal(0)',         ()=>runModal(0)],
  // Switching view must not move the chosen dates.
  // Lean must be RECOMPUTED from the converted body fat, not separately
  // offset — otherwise lean + fat stops summing to weight.
  ['lean derives from converted fat', ()=>{
      const row={weight_kg:80.5, body_fat_pct:24.4, body_fat_source:'Zepp Life', lean_mass_kg:60.9};
      const L=normLean(row);
      if(!L||!L.converted) throw new Error('not converted');
      const f=bfFactor();
      const expect=80.5*(1-(24.4*f)/100);
      if(Math.abs(L.v-expect)>0.001) throw new Error('got '+L.v+' expected '+expect);
      // the identity that a separate calibration would break
      const fatMass=80.5*(24.4*f)/100;
      if(Math.abs((L.v+fatMass)-80.5)>0.001)
        throw new Error('lean + fat does not sum to weight: '+(L.v+fatMass));
    }],
  ['native lean passes through', ()=>{
      const row={weight_kg:80.8, body_fat_pct:18.6, body_fat_source:'Withings', lean_mass_kg:65.78};
      const L=normLean(row);
      if(!L||L.converted) throw new Error('should not convert Withings');
      if(L.v!==65.78) throw new Error('altered a native reading: '+L.v);
    }],
  // The POSITIVE case for the conversion labelling. render-assert.js can only
  // check that a marker and its footnote agree; with a Withings-era photo on
  // screen neither appears and the check passes without proving anything. This
  // forces a Zepp-era day into the panel and demands both.
  ['converted panel is labelled as converted', ()=>{
      const keep=BODYDAYS, keepP=PHOTODAYS;
      try{
        const day={local_date:'2026-01-15', weight_kg:82.0, body_fat_pct:24.4,
                   lean_mass_kg:61.99, body_fat_source:'Zepp Life'};
        BODYDAYS=[day]; PHOTODAYS=[day];
        const out=statLine('2026-01-15');
        if(!/\*/.test(out)) throw new Error('converted value carries no marker: '+out);
        if(!/converted from Zepp Life to the Withings scale/.test(out))
          throw new Error('no conversion footnote: '+out);
        // and the figure shown must be the converted one, not the raw 24.4
        const f=(out.match(/Body fat<\/span><span[^>]*>([\d.]+)/)||[])[1];
        const want=(24.4*bfFactor()).toFixed(1);
        if(!f||Math.abs(+f-+want)>0.05)
          throw new Error('showed '+f+'%, expected the converted '+want+'%');
      } finally { BODYDAYS=keep; PHOTODAYS=keepP; }
    }],
  ['view switch keeps dates', ()=>{
      PLEFT='2025-02-16'; PRIGHT='2026-07-11';
      setPView('side');
      if(PLEFT!=='2025-02-16'||PRIGHT!=='2026-07-11')
        throw new Error('dates moved: '+PLEFT+' / '+PRIGHT);
      setPView('back');
      if(PLEFT!=='2025-02-16'||PRIGHT!=='2026-07-11')
        throw new Error('dates moved on second switch');
    }]
];

let pass=0,fail=0;
for(const [name,fn] of tests){
  try{ fn(); console.log('  ok   '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' -> '+e.message); fail++; }
}
console.log('\n  '+pass+' passed, '+fail+' failed\n');
fs.writeFileSync('/tmp/fh-rendered.json',JSON.stringify(OUT));
process.exit(fail?1:0);
