/* ============================================================
   ui.js — DOM rendering only. No round logic, no audio, no theory beyond
   what data specs carry. Nothing touches `document` at import time.
   ============================================================ */
import { stats, daily, levelFromXp, LEVEL_TITLES, speedTarget, settings } from './stats.js';

const el = id=>document.getElementById(id);
const RING_CIRC = 2*Math.PI*26;
export const SESSION_GOAL = 20;

/* ---------- console ---------- */
export function prompt(html){ el('prompt').innerHTML = html; }
export function feedback(html, cls){
  el('feedback').innerHTML = html;
  el('feedback').className = 'feedback' + (cls? ' '+cls : '');
}
export function rt(text, {live=false, over=false}={}){
  const r=el('rt');
  r.textContent=text;
  r.classList.toggle('live', live);
  r.classList.toggle('over', over);
}
export function playBtn(label, disabled){
  if(label!=null) el('playLabel').textContent=label;
  el('play').disabled=!!disabled;
}
export function replayCadence(disabled){ el('replayCadence').disabled=!!disabled; }
export function replayNote(label, disabled){
  if(label!=null) el('replayNote').textContent=label;
  if(disabled!=null) el('replayNote').disabled=!!disabled;
}

/* ---------- pads ---------- */
export function buildPads(spec, onAnswer){
  const pads = el('pads'); pads.innerHTML='';
  const cols = spec.length>7?5: (window.innerWidth<560?4:7);
  pads.style.gridTemplateColumns=`repeat(${Math.min(cols,spec.length)},1fr)`;
  spec.forEach(p=>{
    const b=document.createElement('button');
    b.className='pad'; b.disabled=true;
    b.style.setProperty('--glow', `var(--${p.cls})`);
    b.style.setProperty('--scaffold', p.scaffold);
    b.innerHTML=`<span class="sol">${p.sol}</span><span class="num">${p.sub}</span><span class="swatch"></span>`;
    b.dataset.sol=p.sol;
    b.onclick=()=>onAnswer(p.deg, b);
    pads.appendChild(b);
  });
}
/* colors/numbers follow function, which shifts in minor — styling only */
export function restylePads(spec){
  document.querySelectorAll('.pad').forEach((b,i)=>{
    const p = spec[i]; if(!p) return;
    b.style.setProperty('--glow', `var(--${p.cls})`);
    const numEl = b.querySelector('.num'); if(numEl) numEl.textContent = p.sub;
  });
}
export function padsEnabled(on){ document.querySelectorAll('.pad').forEach(p=>p.disabled=!on); }
export function clearPadStates(){ document.querySelectorAll('.pad').forEach(p=>p.classList.remove('correct','wrong','reveal','playing')); }
export function markPad(padEl, cls){ padEl.classList.add(cls); }
export function revealPad(sol){
  const p=document.querySelector(`.pad[data-sol="${sol}"]`);
  if(p) p.classList.add('reveal');
}
export function highlightPad(sol, ms){
  const p=document.querySelector(`.pad[data-sol="${sol}"]`);
  if(!p) return;
  p.classList.add('playing');
  setTimeout(()=>p.classList.remove('playing'), ms);
}

/* ---------- stage rail + banners ---------- */
export function refreshStageRail(spec){
  const rail=el('stages'); rail.innerHTML='';
  spec.forEach(s=>{
    const b=document.createElement('button');
    b.className='stage-btn'+(s.locked?' locked':'');
    b.setAttribute('aria-pressed', s.active);
    b.innerHTML=`<span class="n">STAGE ${s.id+1} ${s.locked?'🔒':(s.mastered?'★':'')}</span><span>${s.name}</span>`;
    b.title = s.locked? 'Master the previous stage to unlock' : s.sub;
    b.disabled = s.locked;
    b.onclick=()=>s.onClick();
    rail.appendChild(b);
  });
}
export function showUnlock(name, onGo){
  el('unlockName').textContent=name;
  el('unlock').classList.remove('hidden');
  el('unlockGo').onclick=()=>{ el('unlock').classList.add('hidden'); onGo(); };
  el('unlockStay').onclick=()=>{ el('unlock').classList.add('hidden'); };
}
export function showDrillBanner(pairText, onGo){
  el('drillName').textContent=pairText;
  el('drillBanner').classList.remove('hidden');
  el('drillGo').onclick=()=>{ el('drillBanner').classList.add('hidden'); onGo(); };
  el('drillSkip').onclick=()=>{ el('drillBanner').classList.add('hidden'); };
}

/* ---------- sing panel ---------- */
export function singTarget(text){ el('singTarget').textContent=text; }
export function singReset(){
  el('singTarget').textContent='—';
  el('singHz').textContent='—'; el('singCents').textContent='listening…';
  const n=el('needle'); n.classList.remove('on'); n.style.left='50%';
}
export function needle(freq, foldedCents, tolerance){
  const n=el('needle');
  if(freq<=0 || foldedCents===null){
    el('singHz').textContent='—'; el('singCents').textContent='listening…';
    n.classList.remove('on');
    return;
  }
  const clamped=Math.max(-100,Math.min(100,foldedCents));
  n.style.left = (50 + clamped/2) + '%';
  const inTune = Math.abs(foldedCents)<=tolerance;
  n.classList.toggle('on', inTune);
  el('singHz').textContent = freq.toFixed(0)+' Hz';
  el('singCents').textContent = (foldedCents>0?'+':'')+Math.round(foldedCents)+'¢'+(inTune?' ✓ hold':'');
}
export function needleOff(){ el('needle').classList.remove('on'); }
export function setSingVisible(on){
  el('singpanel').classList.toggle('hidden', !on);
  el('pads').classList.toggle('hidden', on);
}

/* ---------- stats / gamification ---------- */
export function renderStats(){
  el('sCount').textContent = stats.count;
  el('sStreak').textContent = stats.streak;
  el('sBest').textContent = stats.bestStreak;
  el('sDays').textContent = daily.dayStreak;
  el('sAcc').textContent = stats.count? Math.round(stats.correct/stats.count*100)+'%' : '—';
  const avg = stats.times.length? Math.round(stats.times.reduce((a,b)=>a+b,0)/stats.times.length) : null;
  el('sAvg').textContent = avg? (avg/1000).toFixed(2)+'s' : '—';

  const L = levelFromXp(stats.xp);
  el('lvlNum').textContent = L.lvl;
  el('lvlTitle').textContent = LEVEL_TITLES[Math.min(L.lvl,LEVEL_TITLES.length-1)]||'Golden Ear';
  el('xpFill').style.width = (L.pct*100).toFixed(1)+'%';
  el('xpText').textContent = `${L.into} / ${L.need} XP`;

  const done=Math.min(daily.correct, SESSION_GOAL);
  el('ringFill').style.strokeDashoffset = (RING_CIRC*(1-done/SESSION_GOAL)).toFixed(1);
  el('ringLabel').textContent = `${done}/${SESSION_GOAL}`;
  el('goalMsg').textContent = done>=SESSION_GOAL? 'Daily goal cleared 🎯' : 'notes to daily goal';

  updateSpeedTargetReadout();
}
export function renderMastery(spec){
  const grid=el('mastery'); grid.innerHTML='';
  spec.forEach(m=>{
    const cell=document.createElement('div');
    cell.className='mcell'+(m.mastered?' mastered':'');
    cell.style.setProperty('--glow',`var(--${m.cls})`);
    cell.innerHTML=`
      <div class="msol">${m.sol}</div>
      <div class="mbar"><div class="mfill" style="width:${m.pct}%"></div></div>
      <div class="mmeta">${m.seen? m.pct+'%':'—'}</div>`;
    grid.appendChild(cell);
  });
}
export function renderConfusions(pairs){
  el('conflist').textContent = pairs.length
    ? 'Top confusions: '+pairs.map(([k,n])=>`${k} ×${n}`).join(' · ') : '';
}
export function updateSpeedTargetReadout(){
  if(!settings.speedMode) return;
  const t=speedTarget();
  el('spdTarget').textContent = t? 'target '+(t/1000).toFixed(1)+'s' : 'target: warming up';
}
export function setSpeedTargetVisible(on){ el('spdTarget').classList.toggle('hidden', !on); }
export function modeHint(text){ el('modeHint').textContent=text; }
