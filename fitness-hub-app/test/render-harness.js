// Headless DOM shim: enough for the app's render functions, and it RECORDS
// what each one produced so the output can be asserted on, not just "no throw".
const fs=require('fs');
const OUT={};
function el(id){
  return { id, _html:'', _text:'', value:'', disabled:false, dataset:{},
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
GOALS=F.goals; PHOTOS={count:0,dates:[],views:[],photos:[],unparsed:0};

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
                               g('fc').value='23.5';    g('fk').value='50'; g('fn').value='';
                               fuel();}],
  ['idealEnergy',         ()=>idealEnergy()],
  ['barChart empty',      ()=>barChart([],{})],
  ['barChart zeros',      ()=>barChart([{value:0,label:'a'},{value:0,label:'b'}],{})],
  ['runModal(0)',         ()=>runModal(0)]
];

let pass=0,fail=0;
for(const [name,fn] of tests){
  try{ fn(); console.log('  ok   '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' -> '+e.message); fail++; }
}
console.log('\n  '+pass+' passed, '+fail+' failed\n');
fs.writeFileSync('/tmp/fh-rendered.json',JSON.stringify(OUT));
process.exit(fail?1:0);
