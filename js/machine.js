/* ============================================================
   machine.js — the round lifecycle. Owns: stages/unlocks, all round state,
   generation tokens (its spine: EVERY deferred callback checks its token),
   timers, the four mode flows (recognize / phrase / sing / find-do), pair
   drills, and question selection. Talks to the DOM only through ui.js.
   ============================================================ */
import * as T from './theory.js';
import * as A from './audio.js';
import { settings, stats, pushStat, recordConfusion, resetConfusion, topConfusions,
         degMastered, saveSoon } from './stats.js';
import * as ui from './ui.js';

export const TIMING = {
  advanceBreath: 550,
  advanceNoResolve: 700,
  phraseNoteDur: 0.62,
  phraseGap: 0.16,
  phraseBeat: 480,
  clickNoteDur: 0.5,
  singTimeLimit: 12000,
  findDoBreath: 1300,   // no cadence buffer + old key must decay before a fair inference
};

export const STAGES = [
  { id:0, name:'Anchors',    sub:'do · mi · so',        degrees:['do','mi','so'],                     randomKey:false, scaffold:1.0 },
  { id:1, name:'Major scale',sub:'all 7 degrees',       degrees:['do','re','mi','fa','so','la','ti'], randomKey:false, scaffold:0.6 },
  { id:2, name:'Any key',    sub:'randomised tonic',    degrees:['do','re','mi','fa','so','la','ti'], randomKey:true,  scaffold:0.25 },
  { id:3, name:'2-note',     sub:'two-note phrases',    degrees:['do','re','mi','fa','so','la','ti'], randomKey:true,  scaffold:0.25, phrase:2 },
  { id:4, name:'3-note',     sub:'three-note phrases',  degrees:['do','re','mi','fa','so','la','ti'], randomKey:true,  scaffold:0.15, phrase:3 },
  { id:5, name:'4-note',     sub:'four-note phrases',   degrees:['do','re','mi','fa','so','la','ti'], randomKey:true,  scaffold:0,    phrase:4 },
  { id:6, name:'Find do',    sub:'no cadence — infer the key yourself', degrees:['do','re','mi','fa','so','la','ti'], randomKey:true, scaffold:0, findDo:true, melodyLen:5 },
];
const FIXED_TONIC = 60;
function fixedTonicForQuality(){ return S.quality==='minor' ? 57 : 60; }

/* ---------- round state (single object, never stashed on shared constants) ---------- */
export const S = {
  stage: STAGES[0],
  unlocked: STAGES.map(()=>true),   // all open by default (relockable)
  tonic: FIXED_TONIC,
  quality: 'major',                 // resolved per round from settings.keyQuality
  cadence: 'classic',               // resolved per round (Replay key stays faithful)
  degree: null, noteMidi: null,     // single-note round
  phrase: null, phraseMidis: [], phraseOct: 12,
  phraseIdx: 0, phraseResults: [], phraseXp: 0,
  sing: { targetDeg:null, targetMidi:null, inTuneSince:0 },
  drill: null, drillLeft:0, drillHits:0,
  awaiting: false, promptedAt: 0,
  gen: 0,
  lastAskedSol: null,
};
const SING_TOLERANCE = 50, SING_HOLD_MS = 700;
const DRILL_LENGTH = 10;
let advTimer=null, singTimer=null, rtRAF=null, singRAF=null;

export function token(){ return S.gen; }
export function isCurrent(g){ return g===S.gen; }

/* ---------- selection ---------- */
const TRIAD = new Set(['do','mi','so']);
function degWeight(sol){
  if(!settings.focusWeak) return 1;
  const r = stats.byDeg[sol];
  const floor = TRIAD.has(sol) ? 0.6 : 0.15;
  if(!r || r.seen<2) return 1.2;
  const acc = r.hit/r.seen;
  return floor + (1-acc)*2.2;
}
export function weightedPick(pool){
  if(!settings.focusWeak) return pool[Math.floor(Math.random()*pool.length)];
  const w = pool.map(d=>degWeight(d.sol));
  const total = w.reduce((a,b)=>a+b,0);
  let r = Math.random()*total;
  for(let i=0;i<pool.length;i++){ r-=w[i]; if(r<=0) return pool[i]; }
  return pool[pool.length-1];
}
export function pickQuestionDegree(pool){
  // pair drills MUST allow repeats: with 2 degrees, no-repeat = predictable alternation
  if(S.drill) return pool[Math.floor(Math.random()*pool.length)];
  const candidates = pool.length>1 ? pool.filter(d=>d.sol!==S.lastAskedSol) : pool;
  const picked = weightedPick(candidates);
  S.lastAskedSol = picked.sol;
  return picked;
}
export function activePool(){
  if(S.drill) return S.drill.map(s=>T.ALL_DEGREES.find(d=>d.sol===s));
  return S.stage.degrees.map(s=>T.ALL_DEGREES.find(d=>d.sol===s));
}

/* ---------- stage rail / progression ---------- */
export function stageMastered(s){ return s.degrees.every(degMastered); }
export function gotoStage(s, announce){
  clearTimeout(advTimer);
  S.drill=null;
  S.stage=s;
  saveSoon();
  refreshAll();
  resetRound();
  if(announce) ui.prompt(`<b>Stage ${s.id+1}: ${s.name}</b> — ${s.sub}. Press Play.`);
}
function checkProgression(){
  const nextIdx = S.stage.id+1;
  if(nextIdx>=STAGES.length) return;
  if(!stageMastered(S.stage)) return;
  if(S.unlocked[nextIdx]) return;
  S.unlocked[nextIdx]=true;
  ui.refreshStageRail(railSpec());
  if(settings.autoStage){
    setTimeout(()=>gotoStage(STAGES[nextIdx], true), settings.autoAdvance?1600:400);
  } else {
    ui.showUnlock(`Stage ${nextIdx+1}: ${STAGES[nextIdx].name}`,
      ()=>{ clearTimeout(advTimer); gotoStage(STAGES[nextIdx], true); });
  }
}
export function railSpec(){
  return STAGES.map(s=>({
    id:s.id, name:s.name, sub:s.sub,
    locked:!S.unlocked[s.id], mastered:stageMastered(s),
    active:s.id===S.stage.id,
    onClick:()=>{ if(S.unlocked[s.id]) gotoStage(s,false); },
  }));
}

/* ---------- UI data feeds ---------- */
export function padsSpec(){
  const pool = activePool();
  return pool.map(d=>({
    deg:d, sol:d.sol,
    cls:T.degClass(d, S.quality),
    sub: settings.doMode==='fixed'
      ? T.noteName(fixedTonicForQuality() + T.degSemi(d, S.quality))
      : T.degNum(d, S.quality),
    scaffold:S.stage.scaffold,
  }));
}
export function refreshAll(){
  ui.refreshStageRail(railSpec());
  ui.buildPads(padsSpec(), answer);
  ui.renderMastery(masterySpec());
}
export function masterySpec(){
  return activePool().map(d=>{
    const rec=stats.byDeg[d.sol];
    const seen=rec?rec.seen:0;
    const acc=rec&&rec.seen? rec.hit/rec.seen : 0;
    return { sol:d.sol, cls:T.degClass(d,S.quality), seen, pct:seen?Math.round(acc*100):0,
             mastered: degMastered(d.sol) };
  });
}

/* ---------- round lifecycle ---------- */
export function resetRound(){
  S.gen++;                       // orphan any pending round callbacks
  ui.playBtn('Play', false);     // orphaned callbacks were the only other re-enabler
  S.awaiting=false;
  cancelAnimationFrame(rtRAF);
  stopSingLoop();
  clearTimeout(advTimer);
  S.phrase=null; S.degree=null; S.noteMidi=null; S.phraseMidis=[];
  ui.padsEnabled(false); ui.clearPadStates();
  ui.feedback('','');
  ui.replayCadence(true);
  ui.replayNote(settings.practiceMode==='sing' ? 'Reveal'
    : (S.stage.findDo? 'Replay melody' : (S.stage.phrase? 'Replay phrase':'Replay note')), true);
  ui.rt('—', {});
  if(settings.practiceMode==='sing'){
    ui.singReset();
    ui.prompt('Press <b>Play</b> to hear the key, then sing.');
  } else {
    ui.prompt(S.stage.findDo ? 'Press <b>Play</b> to hear a melody.'
      : S.stage.phrase ? 'Press <b>Play</b> to hear a phrase.'
      : 'Press <b>Play</b> for the next note.');
  }
}

function pickTonic(){
  if(settings.doMode==='fixed') return fixedTonicForQuality();
  if(!S.stage.randomKey) return fixedTonicForQuality();
  return 52 + Math.floor(Math.random()*12);
}
function testNoteDur(){ return settings.currentInstrument==='piano' ? 1.6 : 1.3; }
function qtag(){ return settings.keyQuality!=='major' ? ` · <span class="qtag">${S.quality} key</span>` : ''; }

export function newRound(){
  const gen = ++S.gen;
  A.ensureAudio();
  ui.clearPadStates(); ui.padsEnabled(false);
  ui.feedback('','');
  ui.rt('…', {});
  ui.playBtn('Listen', true);
  ui.prompt(S.stage.findDo ? 'Listen — no key is given…' : 'Establishing the key…');

  S.quality = settings.keyQuality==='both'
    ? (settings.doMode==='fixed' ? 'major' : (Math.random()<0.5?'major':'minor'))
    : settings.keyQuality;
  const styleKeys = Object.keys(T.CADENCES);
  S.cadence = settings.cadenceStyle==='shuffle'
    ? styleKeys[Math.floor(Math.random()*styleKeys.length)] : settings.cadenceStyle;
  ui.restylePads(padsSpec());

  S.tonic = pickTonic();
  const pool = activePool();

  if(!S.drill){
    if(S.stage.findDo){
      return settings.practiceMode==='sing' ? newFindDoSingRound(pool, gen) : newFindDoRound(pool, gen);
    }
    if(settings.practiceMode==='sing'){ return newSingRound(pool, gen); }
    if(S.stage.phrase){ return newPhraseRound(pool, gen); }
  }
  newSingleRound(pool, gen);
}

/* ---- single-note (also drills) ---- */
function newSingleRound(pool, gen){
  S.phrase=null;
  S.degree = pickQuestionDegree(pool);
  const t = A.now() + 0.08;
  const cadLen = A.playCadence(settings.currentInstrument, S.tonic, t, S.cadence, S.quality);
  const noteAt = t + cadLen + 0.35;
  const octaveChoices = [0, 12, 12];
  const octShift = octaveChoices[Math.floor(Math.random()*octaveChoices.length)];
  S.noteMidi = T.comfy(S.tonic + T.degSemi(S.degree, S.quality) + octShift);
  A.playNote(settings.currentInstrument, S.noteMidi, noteAt, testNoteDur(), 1.15);

  const totalMs = (noteAt + Math.min(testNoteDur(),1.0) - A.now())*1000;
  setTimeout(()=>{
    if(!isCurrent(gen)) return;
    ui.prompt(S.drill
      ? `<b>Drill ${DRILL_LENGTH-S.drillLeft+1}/${DRILL_LENGTH}</b> — which degree?${qtag()}`
      : `Which degree was that?${qtag()}`);
    ui.playBtn('Skip', false);
    ui.replayCadence(false); ui.replayNote(null, false);
    ui.padsEnabled(true);
    S.awaiting=true;
    S.promptedAt=performance.now();
    startLiveClock();
  }, totalMs);
}

/* ---- phrase ---- */
function newPhraseRound(pool, gen){
  S.degree=null;
  S.phrase = T.makePhrase(S.stage.phrase, pool, S.quality, weightedPick);
  S.phraseIdx = 0; S.phraseResults = []; S.phraseXp = 0;
  const t = A.now() + 0.08;
  const cadLen = A.playCadence(settings.currentInstrument, S.tonic, t, S.cadence, S.quality);
  let at = t + cadLen + 0.4;
  S.phraseOct = T.pickMelodyOct(S.phrase, S.tonic, S.quality);
  S.phraseMidis = S.phrase.map(d=>T.comfy(S.tonic + T.degSemi(d,S.quality) + S.phraseOct));
  S.phraseMidis.forEach(m=>{
    A.playNote(settings.currentInstrument, m, at, TIMING.phraseNoteDur, 1.1);
    at += TIMING.phraseNoteDur + TIMING.phraseGap;
  });
  const totalMs = (at - A.now())*1000;
  setTimeout(()=>{
    if(!isCurrent(gen)) return;
    ui.playBtn('Skip', false);
    ui.replayCadence(false); ui.replayNote(null, false);
    ui.padsEnabled(true);
    S.awaiting=true;
    updatePhrasePrompt();
    S.promptedAt=performance.now();
    startLiveClock();
  }, totalMs);
}
function updatePhrasePrompt(){
  const n=S.stage.phrase;
  const dots = S.phrase.map((_,i)=>{
    if(i<S.phraseIdx) return S.phraseResults[i]?'●':'○';
    if(i===S.phraseIdx) return '◆';
    return '·';
  }).join(' ');
  ui.prompt(`Name note <b>${S.phraseIdx+1}</b> of ${n} &nbsp; <span class="phrasedots">${dots}</span>${qtag()}`);
}

/* Play the current phrase; optionally light each pad in sync (gen-guarded).
   Returns total playback length in ms. */
export function playPhrase(highlight, startDelaySec=0){
  A.ensureAudio();
  let at=A.now()+0.05+startDelaySec;
  const gen=S.gen;
  const baseMs=50+startDelaySec*1000;
  const stepMs=(TIMING.phraseNoteDur+TIMING.phraseGap)*1000;
  S.phrase.forEach((deg,i)=>{
    A.playNote(settings.currentInstrument, S.phraseMidis[i], at, TIMING.phraseNoteDur, 1.1);
    at+=TIMING.phraseNoteDur+TIMING.phraseGap;
    if(highlight){
      setTimeout(()=>{
        if(!isCurrent(gen)) return;
        ui.highlightPad(deg.sol, TIMING.phraseNoteDur*1000);
      }, baseMs+i*stepMs);
    }
  });
  return baseMs+S.phrase.length*stepMs;
}

/* ---- find-do ---- */
function newFindDoRound(pool, gen){
  S.phrase = T.makeFindDoMelody(S.stage.melodyLen, pool, S.quality, weightedPick);
  S.phraseIdx = S.phrase.length - 1;
  S.phraseResults = []; S.phraseXp = 0;
  const totalMs = playFindDoMelody();
  setTimeout(()=>{
    if(!isCurrent(gen)) return;
    ui.prompt(`Which degree was the <b>last</b> note?${qtag()}`);
    ui.playBtn('Skip', false);
    ui.replayCadence(true);          // there is no cadence to replay
    ui.replayNote(null, false);
    ui.padsEnabled(true);
    S.awaiting=true;
    S.promptedAt=performance.now();
    startLiveClock();
  }, totalMs + 150);
}
function playFindDoMelody(){
  const t = A.now() + 0.1;
  let at = t;
  S.phraseOct = T.pickMelodyOct(S.phrase, S.tonic, S.quality);
  S.phraseMidis = S.phrase.map(d=>T.comfy(S.tonic + T.degSemi(d,S.quality) + S.phraseOct));
  S.phraseMidis.forEach(m=>{
    A.playNote(settings.currentInstrument, m, at, TIMING.phraseNoteDur, 1.1);
    at += TIMING.phraseNoteDur + TIMING.phraseGap;
  });
  return (at - A.now())*1000;
}
function newFindDoSingRound(pool, gen){
  S.phrase = T.makeFindDoMelody(S.stage.melodyLen, pool, S.quality, weightedPick);
  S.phraseResults = []; S.phraseXp = 0;
  const tSol = T.tonicSol(S.quality);
  S.sing.targetDeg = pool.find(d=>d.sol===tSol);
  S.sing.targetMidi = T.comfy(S.tonic + 12);
  S.degree = S.sing.targetDeg;
  const totalMs = playFindDoMelody();
  setTimeout(()=>{
    if(!isCurrent(gen)) return;
    ui.playBtn('Skip', false);
    ui.replayCadence(true);
    ui.replayNote('Reveal', false);
    ui.singTarget(tSol + ' — the tonic you inferred');
    ui.prompt('Sing the tonic of the melody you just heard.');
    // deliberately NO drone: it would hand over the answer
    S.awaiting=true;
    S.sing.inTuneSince=0;
    S.promptedAt=performance.now();
    clearTimeout(singTimer);
    singTimer=setTimeout(()=>{ if(S.awaiting) singFail(false); }, TIMING.singTimeLimit);
    startSingLoop();
  }, totalMs + 150);
}

/* ---- sing-back ---- */
function newSingRound(pool, gen){
  S.phrase=null;
  S.sing.targetDeg = pickQuestionDegree(pool);
  S.sing.targetMidi = T.comfy(S.tonic + T.degSemi(S.sing.targetDeg, S.quality) + 12);
  S.degree = S.sing.targetDeg;
  const t = A.now() + 0.08;
  const cadLen = A.playCadence(settings.currentInstrument, S.tonic, t, S.cadence, S.quality);
  const totalMs = (t + cadLen - A.now())*1000 + 200;
  setTimeout(()=>{
    if(!isCurrent(gen)) return;
    ui.playBtn('Skip', false);
    ui.replayCadence(false);
    ui.replayNote('Reveal', false);
    const sub = settings.doMode==='fixed' ? ` (${T.noteName(S.sing.targetMidi)})` : '';
    ui.singTarget(S.sing.targetDeg.sol + sub);
    ui.prompt('Sing the note — match the needle to centre.'+qtag());
    A.startDrone(settings.currentInstrument, S.tonic, S.stage.scaffold);
    S.awaiting=true;
    S.sing.inTuneSince=0;
    S.promptedAt=performance.now();
    clearTimeout(singTimer);
    singTimer=setTimeout(()=>{ if(S.awaiting) singFail(false); }, TIMING.singTimeLimit);
    startSingLoop();
  }, totalMs);
}
function startSingLoop(){
  cancelAnimationFrame(singRAF);
  let frame=0;
  const loop=()=>{
    if(!S.awaiting){ return; }
    if(frame++ % 3 !== 0){ singRAF=requestAnimationFrame(loop); return; } // ~20Hz detection
    const f = A.detectPitch();
    const folded = T.foldCents(T.centsFromMidi(f, S.sing.targetMidi));
    ui.needle(f, folded, SING_TOLERANCE);
    if(f>0 && folded!==null && Math.abs(folded)<=SING_TOLERANCE){
      if(!S.sing.inTuneSince) S.sing.inTuneSince=performance.now();
      if(performance.now()-S.sing.inTuneSince >= SING_HOLD_MS){
        return singSuccess();
      }
    } else {
      S.sing.inTuneSince=0;
    }
    singRAF=requestAnimationFrame(loop);
  };
  loop();
}
export function stopSingLoop(){ cancelAnimationFrame(singRAF); clearTimeout(singTimer); A.stopDrone(); }

function singSuccess(){
  S.awaiting=false; stopSingLoop();
  const rt = performance.now()-S.promptedAt;
  ui.rt((rt/1000).toFixed(2)+'s', {});
  ui.needleOff();
  // rt shown for interest but NOT recorded: sing times include the hold and
  // would skew the recognition avg + adaptive speed target
  const {gain} = pushStat(true, null, S.sing.targetDeg);
  ui.feedback(`✓ sang ${S.sing.targetDeg.sol} · ${(rt/1000).toFixed(2)}s <span class="xpgain">+${gain} XP</span>`, 'good');
  checkProgression();
  ui.renderStats(); ui.renderMastery(masterySpec());
  completeRound({resolveFrom:S.sing.targetMidi, confirmMidi:S.sing.targetMidi});
}
export function singFail(revealed){
  if(!S.awaiting) return;
  S.awaiting=false; stopSingLoop();
  ui.rt('—', {});
  ui.needleOff();
  pushStat(false, null, S.sing.targetDeg);
  ui.feedback((revealed? '✗ revealed — ' : '✗ time up — ') + `this is ${S.sing.targetDeg.sol}`, 'bad');
  ui.renderStats(); ui.renderMastery(masterySpec());
  completeRound({resolveFrom:S.sing.targetMidi, confirmMidi:S.sing.targetMidi});
}

/* ---------- answering ---------- */
export function answer(d, padEl){
  if(!S.awaiting) return;

  // ---- FIND-DO (recognize): one question, the melody's last note ----
  if(S.stage.findDo && S.phrase){
    S.awaiting=false; cancelAnimationFrame(rtRAF);
    const rt = performance.now()-S.promptedAt;
    ui.rt((rt/1000).toFixed(2)+'s', {});
    ui.padsEnabled(false);
    const target = S.phrase[S.phrase.length-1];
    const ok = d.sol===target.sol;
    A.ensureAudio();
    A.playNote(settings.currentInstrument, T.clampMelodyNote(S.tonic + T.degSemi(d,S.quality) + S.phraseOct),
      A.now()+0.02, TIMING.clickNoteDur, 1.05);
    const {gain} = pushStat(ok, rt, target);
    const melody = S.phrase.map(x=>x.sol).join(' ');
    if(ok){
      ui.markPad(padEl,'correct');
      ui.feedback(`✓ ${target.sol} · ${(rt/1000).toFixed(2)}s <span class="xpgain">+${gain} XP</span>`, 'good');
      checkProgression();
      ui.renderStats(); ui.renderMastery(masterySpec());
      completeRound({});
    } else {
      ui.markPad(padEl,'wrong');
      handleConfusion(target.sol, d.sol);
      ui.feedback(`✗ it was ${target.sol} — the melody: ${melody}`, 'bad');
      ui.renderStats(); ui.renderMastery(masterySpec());
      ui.clearPadStates();
      const replayMs = playPhrase(true, TIMING.clickNoteDur + 0.15);
      completeRound({extraMs:replayMs});
    }
    return;
  }

  // ---- PHRASE MODE ----
  if(S.phrase){
    const target = S.phrase[S.phraseIdx];
    const ok = d.sol===target.sol;
    A.ensureAudio();
    A.playNote(settings.currentInstrument, T.clampMelodyNote(S.tonic + T.degSemi(d,S.quality) + S.phraseOct),
      A.now()+0.02, TIMING.clickNoteDur, 1.05);
    S.phraseResults[S.phraseIdx]=ok;
    if(ok){ ui.markPad(padEl,'correct'); }
    else {
      ui.markPad(padEl,'wrong');
      ui.revealPad(target.sol);
      handleConfusion(target.sol, d.sol);
    }
    const {gain} = pushStat(ok, null, target);
    S.phraseXp += gain;
    S.phraseIdx++;
    ui.renderStats(); ui.renderMastery(masterySpec());

    if(S.phraseIdx<S.phrase.length){
      S.awaiting=false;
      ui.padsEnabled(false);
      const gen=S.gen;
      setTimeout(()=>{ if(!isCurrent(gen)) return;
        ui.clearPadStates(); ui.padsEnabled(true); S.awaiting=true; updatePhrasePrompt(); }, TIMING.phraseBeat);
      return;
    }
    // phrase complete
    S.awaiting=false; cancelAnimationFrame(rtRAF);
    ui.padsEnabled(false);
    const hits=S.phraseResults.filter(Boolean).length;
    const perfect=hits===S.phrase.length;
    ui.rt(`${hits}/${S.phrase.length}`, {});
    ui.feedback(perfect
      ? `✓ full phrase — ${S.phrase.map(x=>x.sol).join(' ')} <span class="xpgain">+${S.phraseXp} XP</span>`
      : `${hits}/${S.phrase.length} right — it was ${S.phrase.map(x=>x.sol).join(' ')}`,
      perfect?'good':'bad');
    if(perfect){
      checkProgression();
      completeRound({});
    } else {
      ui.clearPadStates();
      const replayMs = playPhrase(true, TIMING.clickNoteDur + 0.15);
      completeRound({extraMs:replayMs});
    }
    return;
  }

  // ---- SINGLE-NOTE MODE ----
  S.awaiting=false; cancelAnimationFrame(rtRAF);
  const rt = performance.now()-S.promptedAt;
  ui.rt((rt/1000).toFixed(2)+'s', {});
  ui.padsEnabled(false);

  const ok = d.sol===S.degree.sol;
  const {gain, beatTarget} = pushStat(ok, rt, d);
  if(ok){
    ui.markPad(padEl,'correct');
    const bolt = beatTarget? ' ⚡':'';
    ui.feedback(`✓ ${S.degree.sol} · ${(rt/1000).toFixed(2)}s${bolt} <span class="xpgain">+${gain} XP</span>`, 'good');
    if(!S.drill) checkProgression();
  } else {
    ui.markPad(padEl,'wrong');
    ui.revealPad(S.degree.sol);
    ui.feedback(`✗ you chose ${d.sol} — it was ${S.degree.sol}`, 'bad');
    handleConfusion(S.degree.sol, d.sol);
  }
  ui.renderStats(); ui.renderMastery(masterySpec());

  if(S.drill){
    S.drillLeft--; if(ok) S.drillHits++;
    if(S.drillLeft<=0){
      const doneMidi=S.noteMidi;
      const ms = A.completionAudio({resolveFrom:doneMidi, resolveOn:settings.resolveOn,
        tonic:S.tonic, quality:S.quality, instrument:settings.currentInstrument});
      setTimeout(endDrill, settings.resolveOn? Math.max(ms+300,1800) : 600);
      return;
    }
  }
  completeRound({resolveFrom:S.noteMidi});
}
function handleConfusion(asked, chosen){
  if(settings.practiceMode!=='recognize' || S.drill) { recordConfusion(asked, chosen); return; }
  const pair = recordConfusion(asked, chosen);
  ui.renderConfusions(topConfusions());
  if(pair) ui.showDrillBanner(pair.join(' ↔ '), ()=>startDrill(pair));
}

/* ---------- shared completion: audio via the single owner, then advance ---------- */
function completeRound({resolveFrom=null, confirmMidi=null, extraMs=0}){
  ui.playBtn('Next', false);
  const resolved = settings.resolveOn && resolveFrom!=null;
  const audioMs = A.completionAudio({
    resolveFrom, resolveOn:settings.resolveOn, confirmMidi,
    tonic:S.tonic, quality:S.quality, instrument:settings.currentInstrument,
  });
  if(settings.autoAdvance){
    const wait = (resolved ? audioMs + TIMING.advanceBreath : TIMING.advanceNoResolve)
      + extraMs
      + (S.stage.findDo ? TIMING.findDoBreath : 0);
    clearTimeout(advTimer);
    advTimer=setTimeout(()=>{ if(!S.awaiting) newRound(); }, wait);
  }
}

/* ---------- pair drills ---------- */
export function startDrill(pair){
  clearTimeout(advTimer);
  S.drill = pair;
  S.drillLeft = DRILL_LENGTH; S.drillHits = 0;
  refreshAll();
  resetRound();
  ui.prompt(`<b>Pair drill:</b> ${pair.join(' ↔ ')} — ${DRILL_LENGTH} notes. Press Play.`);
}
function endDrill(){
  if(!S.drill) return;   // cancelled (stage/mode switch) before this fired
  const pct = Math.round(100*S.drillHits/DRILL_LENGTH);
  const pair = S.drill.join(' ↔ ');
  resetConfusion(S.drill[0], S.drill[1]);
  S.drill=null;
  refreshAll();
  resetRound();
  ui.feedback(`Drill done: ${pair} — ${S.drillHits}/${DRILL_LENGTH} (${pct}%)`, pct>=80?'good':'bad');
  ui.prompt('Back to normal practice. Press <b>Play</b>.');
}

/* ---------- transport ---------- */
export function onPlay(){
  clearTimeout(advTimer);
  stopSingLoop();
  A.ensureAudio();
  newRound();
}
export function onReplayCadence(){
  A.ensureAudio();
  A.playCadence(settings.currentInstrument, S.tonic, A.now()+0.05, S.cadence, S.quality);
}
export function onReplayNote(){
  A.ensureAudio();
  if(settings.practiceMode==='sing'){     // find-do sing has a phrase set, but the button is Reveal
    if(S.awaiting) singFail(true);
    else if(S.sing.targetMidi!=null) A.playNote(settings.currentInstrument, S.sing.targetMidi, A.now()+0.05, 0.9, 1.1);
  } else if(S.phrase){
    playPhrase(!S.awaiting);              // mid-question replay stays audio-only
  } else if(S.noteMidi!=null){
    A.playNote(settings.currentInstrument, S.noteMidi, A.now()+0.05, testNoteDur(), 1.15);
  }
}

/* ---------- live clock ---------- */
import { speedTarget } from './stats.js';
function startLiveClock(){
  cancelAnimationFrame(rtRAF);
  const tgt = (settings.speedMode && settings.practiceMode!=='sing')? speedTarget() : null;
  const tick=()=>{
    const ms = performance.now()-S.promptedAt;
    ui.rt((ms/1000).toFixed(1)+'s', {live:true, over: !!(tgt && ms>tgt)});
    rtRAF=requestAnimationFrame(tick);
  };
  tick();
}
