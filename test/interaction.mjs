/* ============================================================
   test/interaction.mjs — interaction smoke tests. Boots the real
   index.html in jsdom with a stubbed AudioContext, imports the real
   modules, and drives user scenarios end-to-end: the bug class
   (halt, stale-round hijack, wiring breaks) that logic tests can't see.
   Run: node test/interaction.mjs   (~30s: real timers, real round flows)
   ============================================================ */
import { JSDOM } from 'jsdom';
import fs from 'fs';

/* ---------- environment stubs (must precede module imports) ---------- */
const dom = new JSDOM(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
  { url: 'https://tonic.test/' });   // non-opaque origin → jsdom provides real localStorage
globalThis.document = dom.window.document;
globalThis.window = dom.window;

class FakeNode {
  connect(){ return this; }
  start(){} stop(){}
  get gain(){ return this._p||(this._p=fakeParam()); }
  get frequency(){ return this._f||(this._f=fakeParam()); }
  set type(v){} set fftSize(v){}
  getFloatTimeDomainData(buf){ buf.fill(0); }
}
function fakeParam(){ return { value:0, setValueAtTime(){}, exponentialRampToValueAtTime(){} }; }
class FakeAudioContext {
  constructor(){ this._t0 = Date.now(); this.state='running'; this.destination={}; this.sampleRate=44100; }
  get currentTime(){ return (Date.now()-this._t0)/1000; }
  resume(){}
  createGain(){ return new FakeNode(); }
  createOscillator(){ return new FakeNode(); }
  createAnalyser(){ return new FakeNode(); }
  createMediaStreamSource(){ return new FakeNode(); }
}
dom.window.AudioContext = FakeAudioContext;

globalThis.localStorage = dom.window.localStorage;

globalThis.requestAnimationFrame = cb=>setTimeout(()=>cb(performance.now()), 16);
globalThis.cancelAnimationFrame = id=>clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.confirm = ()=>true;
globalThis.location = { reload(){} };
// mic: denied by default (tests the denial path; grant not needed for these scenarios)
Object.defineProperty(dom.window.navigator, 'mediaDevices', {
  value: { getUserMedia: ()=>Promise.reject(new Error('denied')) }, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

/* ---------- import the real app ---------- */
const M = await import('../js/machine.js');
const { settings, stats } = await import('../js/stats.js');
await import('../js/main.js');   // document.readyState==='complete' in jsdom → init runs now

/* ---------- helpers ---------- */
const el = id=>document.getElementById(id);
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
async function until(cond, timeoutMs, what){
  const t0=Date.now();
  while(Date.now()-t0<timeoutMs){ if(cond()) return true; await sleep(40); }
  throw new Error('timeout waiting for: '+what);
}
let pass=0, fail=0;
function ok(cond, name){ if(cond){pass++;} else {fail++; console.log('  ✗ FAIL:', name);} }
function section(s){ console.log('— '+s); }

/* ============================================================ scenarios */

section('boot');
await until(()=>document.querySelectorAll('.pad').length>0, 3000, 'init (DOMContentLoaded)');
ok(document.querySelectorAll('.pad').length===3, 'boot stage is Anchors → three pads (do/mi/so)');
ok(document.querySelectorAll('.stage-btn').length===7, 'seven stage buttons');
ok(el('prompt').textContent.includes('Play'), 'welcome prompt shown');
ok(!el('play').disabled, 'Play enabled at boot');

section('halt regression: stage switch mid-cadence');
{
  el('play').click();                       // round starts: Play → Listen (disabled)
  await sleep(250);                          // mid-cadence
  ok(el('play').disabled, 'Play disabled during listen');
  const oldGen = M.token();
  document.querySelectorAll('.stage-btn')[1].click();   // switch stage mid-cadence
  ok(!el('play').disabled, 'Play re-enabled immediately after switch (halt bug)');
  ok(M.token()>oldGen, 'gen token advanced (old callbacks orphaned)');
  await sleep(4200);                         // let the ORPHANED callback's timer expire
  ok(!M.S.awaiting, 'stale round never armed awaiting (hijack)');
  ok(document.querySelectorAll('.pad:not([disabled])').length===0, 'stale round never re-enabled pads');
}

section('full recognize round: correct answer');
{
  el('play').click();
  await until(()=>M.S.awaiting, 6000, 'question armed');
  ok([...document.querySelectorAll('.pad')].some(p=>!p.disabled), 'pads enabled at question');
  const target = M.S.degree.sol;
  const before = stats.count;
  document.querySelector(`.pad[data-sol="${target}"]`).click();
  ok(stats.count===before+1 && stats.streak>=1, 'stat recorded');
  ok(el('feedback').textContent.includes('✓'), 'positive feedback');
  ok(el('feedback').innerHTML.includes('XP'), 'XP gain shown (pushStat return wiring)');
  ok(!el('play').disabled && el('playLabel').textContent==='Next', 'transport → Next');
}

section('wrong answer: reveal + confusion');
{
  M.resetRound(); el('play').click();
  await until(()=>M.S.awaiting, 6000, 'question armed');
  const target = M.S.degree.sol;
  const wrong = ['do','re','mi','fa','so','la','ti'].find(s=>s!==target);
  document.querySelector(`.pad[data-sol="${wrong}"]`).click();
  ok(el('feedback').textContent.includes('✗'), 'negative feedback');
  ok(document.querySelector(`.pad[data-sol="${target}"]`).classList.contains('reveal'), 'correct pad revealed');
  ok(stats.streak===0, 'streak reset');
  ok(Object.keys(stats.confusion).length>0, 'confusion recorded');
}

section('mic denial keeps recognize mode');
{
  M.resetRound();
  document.querySelector('#practiceMode button[data-pm="sing"]').click();
  await sleep(80);
  ok(settings.practiceMode==='recognize', 'mode unchanged on denial');
  ok(el('prompt').textContent.toLowerCase().includes('denied') || el('prompt').textContent.toLowerCase().includes('mic'),
     'denial message shown');
  ok(!el('singpanel')||el('singpanel').classList.contains('hidden'), 'sing panel stays hidden');
}

section('phrase round: 2-note flow end to end');
{
  document.querySelectorAll('.stage-btn')[3].click();   // 2-note stage
  el('play').click();
  await until(()=>M.S.awaiting, 8000, 'phrase question armed');
  ok(M.S.phrase && M.S.phrase.length===2, 'two-note phrase generated');
  ok(el('prompt').textContent.includes('1'), 'prompt asks note 1');
  // answer note 1 correctly
  document.querySelector(`.pad[data-sol="${M.S.phrase[0].sol}"]`).click();
  ok(!M.S.awaiting, 'beat pause after note 1');
  await until(()=>M.S.awaiting, 2000, 'note 2 armed after beat');
  ok(el('prompt').textContent.includes('2'), 'prompt advanced to note 2');
  document.querySelector(`.pad[data-sol="${M.S.phrase[1].sol}"]`).click();
  ok(el('feedback').textContent.includes('full phrase'), 'perfect-phrase feedback');
}

section('find-do round: no cadence, breath before advance');
{
  document.querySelectorAll('.stage-btn')[6].click();   // Find do
  el('play').click();
  ok(el('prompt').textContent.includes('no key'), 'find-do listen prompt');
  await until(()=>M.S.awaiting, 8000, 'find-do question armed');
  ok(el('replayCadence').disabled, 'no cadence to replay');
  ok(el('replayNote').textContent==='Replay melody', 'replay button labeled for melody');
  const last = M.S.phrase[M.S.phrase.length-1].sol;
  const t0=Date.now();
  document.querySelector(`.pad[data-sol="${last}"]`).click();
  ok(el('feedback').textContent.includes('✓'), 'find-do correct');
  // findDoBreath: next round must NOT arm before ~2s
  await sleep(1400);
  ok(!M.S.awaiting && el('prompt').textContent.includes('✓')===false, 'breath: not yet advanced at 1.4s');
}

section('persistence roundtrip');
{
  await sleep(500);                          // saveSoon debounce
  const raw = localStorage.getItem('tonic-trainer-v1');
  ok(!!raw, 'save written');
  const blob = JSON.parse(raw);
  ok(blob.stats.count===stats.count, 'saved stats match live');
  ok(typeof blob.stageId==='number' && Array.isArray(blob.stageUnlocked), 'stage snapshot present');
  ok(blob.settings.practiceMode==='recognize', 'settings serialized');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
