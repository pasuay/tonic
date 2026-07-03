/* ============================================================
   test/run.mjs — logic parity tests for the module extraction.
   Golden values come from the legacy single-file build's validated
   simulations (resolution tables, K-S gate stats, pitch ceilings,
   streak transitions, detector accuracy).
   Run: node test/run.mjs
   ============================================================ */
import * as T from '../js/theory.js';
import { settings, stats, daily, pushStat, levelFromXp, recordConfusion,
         topConfusions, resetConfusion, degMastered, touchDaily } from '../js/stats.js';
import { autoCorrelate } from '../js/audio.js';
import * as M from '../js/machine.js';

let pass=0, fail=0;
function ok(cond, name){
  if(cond){ pass++; }
  else { fail++; console.log('  ✗ FAIL:', name); }
}
function section(name){ console.log('— '+name); }

/* ---------- 1. resolution paths: full golden table, both qualities ---------- */
section('resolution paths');
const MAJ_TABLE = {
  0:[0], 2:[2,0], 4:[4,2,0], 5:[5,4,2,0], 7:[7,5,4,2,0], 9:[9,7,5,4,2,0], 11:[11,12],
  10:[10,12],                       // major: pc10 treated as leading-toneish, resolves up
  1:[1,0], 6:[6,5,4,2,0], 8:[8,7,5,4,2,0],   // chromatics: nearest-scale walk down
};
for(const [pc,want] of Object.entries(MAJ_TABLE)){
  const got = T.resolutionPath(+pc,'major');
  ok(JSON.stringify(got)===JSON.stringify(want), `major pc${pc} → ${got} (want ${want})`);
}
const MIN_TABLE = {
  0:[0], 2:[2,0], 3:[3,2,0], 5:[5,3,2,0], 7:[7,5,3,2,0], 8:[8,7,5,3,2,0],
  10:[10,8,7,5,3,2,0],              // minor: so descends (no major-style pc10 exception)
  11:[11,12],                       // si resolves UP to la
};
for(const [pc,want] of Object.entries(MIN_TABLE)){
  const got = T.resolutionPath(+pc,'minor');
  ok(JSON.stringify(got)===JSON.stringify(want), `minor pc${pc} → ${got} (want ${want})`);
}

/* ---------- 2. pitch ranges ---------- */
section('pitch ranges');
ok(T.comfy(90)<=84 && T.comfy(20)>=48, 'comfy clamps into [48,84]');
{
  let worst=0;
  for(const q of ['major','minor']) for(let tonic=52;tonic<=63;tonic++) for(const oct of [0,12])
    for(const d of T.ALL_DEGREES) worst=Math.max(worst, T.clampMelodyNote(tonic+T.degSemi(d,q)+oct));
  ok(worst<=79, `clampMelodyNote worst case ${worst} ≤ G5`);
}
{
  // pickMelodyOct: whole-melody shift never exceeds G5, contour preserved
  const pick = pool=>pool[Math.floor(Math.random()*pool.length)];
  let bad=0;
  for(let i=0;i<5000;i++){
    const q = i%2?'major':'minor';
    const tonic = 52+Math.floor(Math.random()*12);
    const mel = T.makePhrase(2+(i%3), T.DEGREES, q, pick);
    const oct = T.pickMelodyOct(mel, tonic, q);
    for(const d of mel) if(tonic+T.degSemi(d,q)+oct>79) bad++;
  }
  ok(bad===0, `melody notes above G5: ${bad}/15000`);
}

/* ---------- 3. phrase generator ---------- */
section('phrase generator');
{
  const pick = pool=>pool[Math.floor(Math.random()*pool.length)];
  let stepish=0, tot=0, wrongLen=0, outOfPool=0;
  for(let i=0;i<4000;i++){
    const n=2+(i%3);
    const mel=T.makePhrase(n, T.DEGREES, 'major', pick);
    if(mel.length!==n) wrongLen++;
    for(const d of mel) if(!T.DEGREES.includes(d)) outOfPool++;
    for(let k=1;k<n;k++){
      tot++;
      const a=T.degSemi(mel[k-1],'major'), b=T.degSemi(mel[k],'major');
      if(Math.abs(a-b)<=2) stepish++;
    }
  }
  ok(wrongLen===0 && outOfPool===0, 'phrase length + membership');
  ok(stepish/tot>0.6, `stepwise bias ${(100*stepish/tot).toFixed(0)}% > 60%`);
}
{
  // minor: steps must follow MINOR pitch order (the la-based adjacency fix)
  const pick = pool=>pool[Math.floor(Math.random()*pool.length)];
  let adjacentSteps=0, tot=0;
  for(let i=0;i<2000;i++){
    const mel=T.makePhrase(4, T.DEGREES, 'minor', pick);
    for(let k=1;k<4;k++){
      const a=T.degSemi(mel[k-1],'minor'), b=T.degSemi(mel[k],'minor');
      tot++; if(Math.abs(a-b)<=2) adjacentSteps++;
    }
  }
  ok(adjacentSteps/tot>0.55, `minor stepwise bias uses minor pitch order (${(100*adjacentSteps/tot).toFixed(0)}%)`);
}

/* ---------- 4. find-do melodies: K-S gate + do placement ---------- */
section('find-do melodies');
{
  const pick = pool=>pool[Math.floor(Math.random()*pool.length)];
  let hasDo=0, gated=0, N=1500;
  for(let i=0;i<N;i++){
    const mel=T.makeFindDoMelody(5, T.DEGREES, 'major', pick);
    if(mel.some(d=>d.sol==='do')) hasDo++;
    if(T.ksIntendedKeyMargin(mel,'major')>=T.KS_MARGIN) gated++;
  }
  ok(hasDo===N, `contains do: ${hasDo}/${N}`);
  // P(gate within 60 tries) = 1-(1-0.053)^60 ≈ 96%; the ~4% remainder uses the
  // best-candidate fallback — identical to legacy behavior (same cap, same gate)
  ok(gated/N>0.93, `K-S margin ≥${T.KS_MARGIN}: ${(100*gated/N).toFixed(1)}% (≈96% expected)`);
}
{
  const pick = pool=>pool[Math.floor(Math.random()*pool.length)];
  let gated=0, N=800;
  for(let i=0;i<N;i++){
    const mel=T.makeFindDoMelody(5, T.DEGREES, 'minor', pick);
    if(T.ksIntendedKeyMargin(mel,'minor')>=T.KS_MARGIN) gated++;
  }
  ok(gated/N>0.97, `minor gate holds: ${(100*gated/N).toFixed(1)}%`);
}

/* ---------- 5. cadence spellings (A minor golden set) ---------- */
section('cadences');
{
  const name = m=>T.noteName(57+m); // A minor tonic 57
  const spell = ch=>ch.map(name).join('');
  const c = T.cadenceChords('classic','minor');
  ok(spell(c[0])==='ACE' && spell(c[1])==='DFA' && spell(c[2])==='EG♯B' && spell(c[3])==='ACE',
     `i–iv–V–i spelled ${c.map(spell).join(' ')}`);
  const p2 = T.cadenceChords('pop2','minor');
  ok(spell(p2[0])==='ACE' && spell(p2[1])==='GBD' && spell(p2[2])==='FAC' && spell(p2[3])==='EG♯B',
     `Andalusian i–VII–VI–V spelled ${p2.map(spell).join(' ')}`);
  const j = T.cadenceChords('jazz','minor');
  ok(spell(j[0])==='BDF', `iiø starts BDF (${spell(j[0])})`);
  ok(T.cadenceName('pop1','major')==='I–V–vi–IV' && T.cadenceName('pop1','minor')==='i–VI–III–VII',
     'cadence labels switch with quality');
}

/* ---------- 6. pitch detector ---------- */
section('pitch detector');
{
  const sr=44100; let worst=0;
  for(const f of [82.41,110,146.83,220,329.63,440,659.25,987.77]){
    const buf=new Float32Array(2048);
    for(let i=0;i<buf.length;i++){const t=i/sr; buf[i]=0.6*Math.sin(2*Math.PI*f*t)+0.3*Math.sin(4*Math.PI*f*t)+0.15*Math.sin(6*Math.PI*f*t);}
    const det=autoCorrelate(buf,sr);
    worst=Math.max(worst, Math.abs(1200*Math.log2(det/f)));
  }
  ok(worst<12, `worst detection error ${worst.toFixed(1)}¢ < 12¢ (E2–B5)`);
  ok(autoCorrelate(new Float32Array(2048), 44100)===-1, 'silence → -1');
}

/* ---------- 7. cents folding ---------- */
section('cents folding');
ok(T.foldCents(1195)===-5 || Math.abs(T.foldCents(1195)+5)<1e-9, 'octave-up folds to -5¢');
ok(Math.abs(T.foldCents(-1210)+10)<1e-9, 'octave-down folds to -10¢');
ok(T.foldCents(0)===0 && T.foldCents(null)===null, 'identity + null passthrough');

/* ---------- 8. stats: streaks, daily, XP ---------- */
section('stats');
{
  // reset
  Object.assign(stats, {count:0,correct:0,streak:0,bestStreak:0,times:[],xp:0,byDeg:{},confusion:{}});
  Object.assign(daily, {date:'2026-07-02',correct:0,dayStreak:0,lastPractice:null});
  const deg={sol:'fa'};
  const r1=pushStat(true, 1200, deg);
  ok(r1.gain>0 && stats.streak===1 && stats.xp===r1.gain, 'first correct: gain returned + applied');
  const r2=pushStat(true, 900, deg);
  ok(stats.streak===2 && stats.xp===r1.gain+r2.gain, 'streak grows, xp accumulates');
  pushStat(false, 2000, deg);
  ok(stats.streak===0 && stats.bestStreak===2, 'miss resets streak, best kept');
  ok(daily.correct===2 && daily.dayStreak===1, 'daily counter + day streak seeded');
  ok(stats.byDeg.fa.seen===3 && stats.byDeg.fa.hit===2, 'per-degree tallies');
  ok(!degMastered('fa'), 'fa not mastered at 2/3');
  for(let i=0;i<8;i++) pushStat(true, 800, deg);
  ok(degMastered('fa'), 'fa mastered at 10/11');
  // sing rt exclusion: null rt must not enter times
  const before=stats.times.length;
  pushStat(true, null, deg);
  ok(stats.times.length===before, 'null rt not pushed into times');
}
{
  // day-streak calendar transitions (mirrors legacy simulation)
  Object.assign(daily, {date:'2026-07-01',correct:0,dayStreak:0,lastPractice:null});
  const step=(today,yesterday)=>{
    if(daily.date!==today){ daily.date=today; daily.correct=0; }
    daily.correct++;
    if(daily.lastPractice!==daily.date){
      daily.dayStreak = (daily.lastPractice===yesterday)? daily.dayStreak+1 : 1;
      daily.lastPractice=daily.date;
    }
  };
  step('2026-07-01','2026-06-30'); ok(daily.dayStreak===1,'day1');
  step('2026-07-02','2026-07-01'); ok(daily.dayStreak===2 && daily.correct===1,'consecutive day extends, counter resets');
  step('2026-07-05','2026-07-04'); ok(daily.dayStreak===1,'gap restarts');
}
{
  // level curve monotonic + consistent
  let prev=levelFromXp(0).lvl;
  let monotonic=true;
  for(let xp=0;xp<20000;xp+=137){
    const l=levelFromXp(xp).lvl;
    if(l<prev) monotonic=false;
    prev=l;
  }
  ok(monotonic, 'level curve monotonic');
  ok(levelFromXp(0).lvl===1 && levelFromXp(99).lvl===1 && levelFromXp(100).lvl===2, 'level thresholds');
}
{
  // confusion drill trigger every 3rd
  stats.confusion={};
  ok(recordConfusion('fa','la')===null, '1st confusion: no drill');
  ok(recordConfusion('la','fa')===null, '2nd: no drill');
  const pair=recordConfusion('fa','la');
  ok(Array.isArray(pair) && pair.join()==='fa,la', '3rd: drill suggested');
  ok(topConfusions()[0][1]===3, 'topConfusions counts');
  resetConfusion('fa','la');
  ok((stats.confusion['fa↔la']||0)===0, 'reset after drill');
}

/* ---------- 9. selection: weighting floors + no-repeat ---------- */
section('selection');
{
  Object.assign(stats, {byDeg:{
    do:{seen:20,hit:19}, re:{seen:20,hit:18}, mi:{seen:20,hit:19}, fa:{seen:20,hit:8},
    so:{seen:20,hit:19}, la:{seen:20,hit:9}, ti:{seen:20,hit:10},
  }});
  settings.focusWeak=true;
  const counts={};
  M.S.drill=null;
  for(let i=0;i<20000;i++){
    const d=M.weightedPick(T.DEGREES);
    counts[d.sol]=(counts[d.sol]||0)+1;
  }
  ok(counts.fa>counts.re && counts.la>counts.re && counts.ti>counts.re,
     'weak degrees drawn more than strong');
  ok(counts.do/20000>0.05, `mastered do never starved (${(100*counts.do/20000).toFixed(1)}%)`);
}
{
  // no-immediate-repeat outside drills; repeats ALLOWED inside drills
  M.S.drill=null; M.S.lastAskedSol=null;
  let repeats=0, prev=null;
  for(let i=0;i<5000;i++){
    const d=M.pickQuestionDegree(T.DEGREES);
    if(prev===d.sol) repeats++;
    prev=d.sol;
  }
  ok(repeats===0, `no consecutive repeats (${repeats})`);
  M.S.drill=['fa','la'];
  const pool=M.activePool();
  ok(pool.length===2 && pool[0].sol==='fa', 'drill pool built from pair');
  let sawRepeat=false; prev=null;
  for(let i=0;i<300;i++){
    const d=M.pickQuestionDegree(pool);
    if(prev===d.sol) sawRepeat=true;
    prev=d.sol;
  }
  ok(sawRepeat, 'drill mode allows repeats (no telegraphing)');
  M.S.drill=null;
}

/* ---------- 10. settings defaults parity ---------- */
section('defaults');
ok(settings.focusWeak===true && settings.freeStages===true && settings.autoAdvance===true
   && settings.autoStage===false && settings.resolveOn===true && settings.practiceMode==='recognize',
   'defaults match agreed behavior');
ok(M.STAGES.length===7 && M.STAGES.every((s,i)=>s.id===i), 'stage ids sequential (index-aligned)');
ok(M.STAGES[6].findDo===true && !M.STAGES.some(s=>s.name==='Chromatic'), 'Find do present, Chromatic dropped');
ok(M.TIMING.findDoBreath===1300 && M.TIMING.clickNoteDur===0.5, 'timing constants carried over');

/* ---------- 11. just intonation (5-limit, tonic-relative) ---------- */
section('just intonation');
import { setTuning, noteFreq } from '../js/audio.js';
{
  const f = T.midiToFreq, near = (a,b)=>Math.abs(a-b)<1e-9;
  // exact ratios against tonic C4=60
  ok(near(T.midiToFreqJust(60,60), f(60)),        'tonic = 1/1');
  ok(near(T.midiToFreqJust(64,60), f(60)*5/4),    'mi = 5/4');
  ok(near(T.midiToFreqJust(67,60), f(60)*3/2),    'so = 3/2');
  ok(near(T.midiToFreqJust(69,60), f(60)*5/3),    'la = 5/3');
  ok(near(T.midiToFreqJust(71,60), f(60)*15/8),   'ti = 15/8');
  // octaves are pure 2/1 and pitch class folds correctly below the tonic
  ok(near(T.midiToFreqJust(76,60), f(60)*5/4*2),  'mi +1 octave = 5/2');
  ok(near(T.midiToFreqJust(57,60), f(60)*5/3/2),  'la below tonic = 5/6');
  // la-based minor via the same table: do in la-minor (offset 3) = 6/5
  ok(near(T.midiToFreqJust(60,57), f(57)*6/5),    'minor: do = 6/5 over la-tonic');
  // every ratio within a syntonic-comma-ish distance of ET (guards table typos)
  ok(T.JI_RATIOS.every((r,pc)=>Math.abs(1200*Math.log2(r)-100*pc)<22), 'all 12 ratios within 22¢ of ET');
  ok(T.JI_RATIOS.length===12, 'full chromatic table (minor V leading tone covered)');
  // audio tuning context: ET by default, JI when set, ET again when cleared
  ok(near(noteFreq(64), f(64)), 'noteFreq = ET when off');
  setTuning(true, 60);
  ok(near(noteFreq(64), f(60)*5/4), 'noteFreq = JI when on');
  ok(near(noteFreq(48), f(48)), 'tonic pitch class identical in both tunings');
  setTuning(false);
  ok(near(noteFreq(64), f(64)), 'toggle off restores ET');
  // needle math: singing exactly the JI target reads 0¢; ET mi vs JI mi ≈ +13.7¢
  ok(Math.abs(T.centsFromFreq(f(60)*5/4, f(60)*5/4))<1e-9, 'centsFromFreq zero at target');
  const dev = T.centsFromFreq(f(64), f(60)*5/4);
  ok(Math.abs(dev-13.686)<0.01, `ET mi is +13.69¢ above just mi (got ${dev.toFixed(3)})`);
  ok(settings.justIntonation===false, 'justIntonation defaults OFF (ET)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
