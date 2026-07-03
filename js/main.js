/* ============================================================
   main.js — composition root. Wires DOM controls to settings/machine,
   applies persistence, owns init. No round logic lives here.
   ============================================================ */
import * as T from './theory.js';
import * as A from './audio.js';
import { settings, stats, loadSaved, saveSoon, saveNow, setSnapshotProvider,
         resetProgress, topConfusions } from './stats.js';
import * as M from './machine.js';
import * as ui from './ui.js';

const el = id=>document.getElementById(id);

function init(){
  /* ---- persistence: load, then apply stage/unlock parts ---- */
  setSnapshotProvider(()=>({
    stageUnlocked: M.S.unlocked,
    stageId: M.S.stage.id,
    freeStages: el('freeStageToggle').checked,
  }));
  const saved = loadSaved();
  let savedFreeStages = settings.freeStages;
  if(saved){
    if(Array.isArray(saved.stageUnlocked))
      saved.stageUnlocked.forEach((v,i)=>{ if(i<M.S.unlocked.length) M.S.unlocked[i]=v; });
    if(typeof saved.freeStages==='boolean') savedFreeStages=saved.freeStages;
    if(Number.isInteger(saved.stageId) && M.STAGES[saved.stageId] && M.S.unlocked[saved.stageId])
      M.S.stage = M.STAGES[saved.stageId];
    if(settings.keyQuality!=='both') M.S.quality = settings.keyQuality;
  }

  /* ---- transport ---- */
  el('play').onclick = M.onPlay;
  el('replayCadence').onclick = M.onReplayCadence;
  el('replayNote').onclick = M.onReplayNote;

  /* ---- instrument ---- */
  ['piano','flute','strings','vox','synth'].forEach(name=>{
    const b=document.createElement('button');
    b.textContent=name[0].toUpperCase()+name.slice(1);
    b.setAttribute('aria-pressed', name===settings.currentInstrument);
    b.onclick=()=>{ settings.currentInstrument=name;
      document.querySelectorAll('#instrument button').forEach(x=>x.setAttribute('aria-pressed', x.textContent.toLowerCase()===name));
      saveSoon(); };
    el('instrument').appendChild(b);
  });

  /* ---- do-mode ---- */
  document.querySelectorAll('#doMode button').forEach(b=>{
    b.onclick=()=>{
      settings.doMode=b.dataset.mode;
      document.querySelectorAll('#doMode button').forEach(x=>x.setAttribute('aria-pressed', x===b));
      ui.modeHint(settings.doMode==='fixed'
        ? 'Do = C always. Syllables name the actual pitch (C D E…).'
        : 'Do = the tonic of each key. Trains function.');
      M.refreshAll(); M.resetRound(); saveSoon();
    };
  });

  /* ---- practice mode (recognize / sing) ---- */
  document.querySelectorAll('#practiceMode button').forEach(b=>{
    b.onclick=async ()=>{
      const pm=b.dataset.pm;
      if(pm==='sing'){
        ui.prompt('Requesting microphone…');
        const ok=await A.ensureMic();
        if(!ok){
          ui.prompt('Mic access denied. Sing-back needs your microphone — check browser permissions.');
          return;
        }
      }
      settings.practiceMode=pm;
      document.querySelectorAll('#practiceMode button').forEach(x=>x.setAttribute('aria-pressed', x===b));
      M.S.drill=null;                    // mode switch cancels an active pair drill
      ui.setSingVisible(pm==='sing');
      ui.setSpeedTargetVisible(settings.speedMode && pm!=='sing');
      M.stopSingLoop();
      M.refreshAll();
      M.resetRound();
    };
  });

  /* ---- key quality + cadence style ---- */
  document.querySelectorAll('#keyQuality button').forEach(b=>{
    b.onclick=()=>{ settings.keyQuality=b.dataset.q;
      document.querySelectorAll('#keyQuality button').forEach(x=>x.setAttribute('aria-pressed', x===b));
      if(settings.keyQuality!=='both') M.S.quality=settings.keyQuality;
      ui.restylePads(M.padsSpec()); ui.renderMastery(M.masterySpec());
      refreshCadenceLabels(); saveSoon();
    };
  });
  document.querySelectorAll('#cadenceStyle button').forEach(b=>{
    b.onclick=()=>{ settings.cadenceStyle=b.dataset.c;
      document.querySelectorAll('#cadenceStyle button').forEach(x=>x.setAttribute('aria-pressed', x===b));
      saveSoon(); };
  });
  function refreshCadenceLabels(){
    const q = settings.keyQuality==='minor' ? 'minor' : 'major';
    document.querySelectorAll('#cadenceStyle button').forEach(b=>{
      if(b.dataset.c==='shuffle') return;
      b.textContent = T.cadenceName(b.dataset.c, q);
    });
  }

  /* ---- toggles ---- */
  const bind=(id,key,extra)=>{ el(id).onchange=e=>{ settings[key]=e.target.checked; if(extra)extra(); saveSoon(); }; };
  bind('resolveToggle','resolveOn');
  bind('justToggle','justIntonation', ()=>A.setTuning(settings.justIntonation));
  bind('autoToggle','autoAdvance');
  bind('autoStageToggle','autoStage');
  bind('focusToggle','focusWeak');
  bind('speedToggle','speedMode', ()=>{
    ui.setSpeedTargetVisible(settings.speedMode && settings.practiceMode!=='sing');
    ui.updateSpeedTargetReadout();
  });
  el('freeStageToggle').onchange = e=>{
    if(e.target.checked){
      M.S.unlocked = M.STAGES.map(()=>true);
    } else {
      M.S.unlocked = M.STAGES.map((s,i)=> i===0 || M.stageMastered(M.STAGES[i-1]) || s.id<=M.S.stage.id );
    }
    ui.refreshStageRail(M.railSpec()); saveSoon();
  };
  el('resetProgress').onclick=()=>{
    if(!confirm('Reset all progress? Stats, mastery, unlocks and settings will be cleared.')) return;
    resetProgress();
    location.reload();
  };

  /* ---- keyboard: 1-9,0 pick pads, space = play/next ---- */
  window.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT') return;
    if(e.code==='Space'){ e.preventDefault(); if(!el('play').disabled) el('play').click(); return; }
    const pads=[...document.querySelectorAll('.pad')];
    const idx='1234567890'.indexOf(e.key);
    if(idx>=0 && idx<pads.length && !pads[idx].disabled){ pads[idx].click(); }
  });
  window.addEventListener('resize', ()=>{
    if(!M.S.awaiting && !document.querySelector('.pad.correct')) M.refreshAll();
  });

  /* ---- apply restored settings to visible controls ---- */
  ['resolveToggle','autoToggle','autoStageToggle','focusToggle','speedToggle','justToggle'].forEach((id,i)=>{
    el(id).checked=[settings.resolveOn,settings.autoAdvance,settings.autoStage,settings.focusWeak,settings.speedMode,settings.justIntonation][i];
  });
  el('freeStageToggle').checked=savedFreeStages;
  A.setTuning(settings.justIntonation);
  ui.setSpeedTargetVisible(settings.speedMode);
  document.querySelectorAll('#instrument button').forEach(x=>x.setAttribute('aria-pressed', x.textContent.toLowerCase()===settings.currentInstrument));
  document.querySelectorAll('#doMode button').forEach(x=>x.setAttribute('aria-pressed', x.dataset.mode===settings.doMode));
  document.querySelectorAll('#keyQuality button').forEach(x=>x.setAttribute('aria-pressed', x.dataset.q===settings.keyQuality));
  document.querySelectorAll('#cadenceStyle button').forEach(x=>x.setAttribute('aria-pressed', x.dataset.c===settings.cadenceStyle));
  refreshCadenceLabels();
  ui.modeHint(settings.doMode==='fixed'
    ? 'Do = C always. Syllables name the actual pitch (C D E…).'
    : 'Do = the tonic of each key. Trains function.');

  /* ---- first paint ---- */
  M.refreshAll();
  ui.renderStats();
  ui.renderConfusions(topConfusions());
  M.resetRound();
  ui.prompt('Choose an instrument and press <b>Play</b> to begin.');
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
else init();
