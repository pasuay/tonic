/* ============================================================
   stats.js — stats, XP/levels, per-degree mastery, confusion tracking,
   daily goal + day-streak, localStorage persistence. No DOM at import time.
   ============================================================ */

export const settings = {
  currentInstrument:'piano',
  doMode:'movable',        // 'movable' | 'fixed'
  practiceMode:'recognize',// 'recognize' | 'sing' (never persisted: mic needs a gesture)
  keyQuality:'major',      // 'major' | 'minor' | 'both'
  cadenceStyle:'classic',  // key of CADENCES or 'shuffle'
  resolveOn:true,
  justIntonation:false,    // just (5-limit, tonic-relative) vs equal temperament
  autoAdvance:true,
  autoStage:false,
  focusWeak:true,          // on by default
  speedMode:false,
  freeStages:true,         // all stages open by default
};

export const stats = { count:0, correct:0, streak:0, bestStreak:0, times:[], xp:0, byDeg:{}, confusion:{} };

export function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
export function yesterdayStr(){ const d=new Date(); d.setDate(d.getDate()-1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
export const daily = { date: todayStr(), correct: 0, dayStreak: 0, lastPractice: null };
export function touchDaily(){
  const t=todayStr();
  if(daily.date!==t){ daily.date=t; daily.correct=0; }
}

export function levelFromXp(xp){
  let lvl=1, need=100, acc=0;
  while(xp >= acc+need){ acc+=need; lvl++; need=Math.round(need*1.35); }
  return { lvl, into: xp-acc, need, pct: (xp-acc)/need };
}
export const LEVEL_TITLES=['','Tourist','Humming','Finding Do','Key-Aware','Degree Reader','Inner Ear','Solfège Fluent','Functional','Transposer','Golden Ear'];

function degRec(sol){ return stats.byDeg[sol] || (stats.byDeg[sol]={seen:0,hit:0}); }

/* adaptive: beat 90% of your rolling average (last 10 correct), floor 1.5s */
export function speedTarget(){
  const recent = stats.times.slice(-10);
  if(recent.length<3) return null;
  const avg = recent.reduce((a,b)=>a+b,0)/recent.length;
  return Math.max(1500, avg*0.9);
}

/* Records an answer; RETURNS {gain, beatTarget} instead of mutating shared
   display state — makes the stale-XP-display bug class impossible. */
export function pushStat(ok, rt, degObj){
  stats.count++;
  const rec=degRec(degObj.sol); rec.seen++;
  let gain=0, beatTarget=false;
  if(ok){
    stats.correct++; stats.streak++; stats.bestStreak=Math.max(stats.bestStreak,stats.streak);
    touchDaily();
    daily.correct++;
    if(daily.lastPractice!==daily.date){
      daily.dayStreak = (daily.lastPractice===yesterdayStr()) ? daily.dayStreak+1 : 1;
      daily.lastPractice = daily.date;
    }
    if(rt) stats.times.push(rt);
    rec.hit++;
    const speedBonus = rt? Math.max(0, Math.round((3000-Math.min(rt,3000))/150)) : 0;
    const streakMult = 1 + Math.min(stats.streak-1,10)*0.1;
    gain = Math.round((10 + speedBonus) * streakMult);
    const tgt = settings.speedMode? speedTarget() : null;
    beatTarget = !!(tgt && rt && rt<=tgt);
    if(beatTarget) gain = Math.round(gain*1.5);
    stats.xp += gain;
  } else {
    stats.streak=0;
  }
  saveSoon();
  return {gain, beatTarget};
}

/* ---------- confusion tracking ---------- */
export const CONFUSION_THRESHOLD = 3;
export function pairKey(a,b){ return [a,b].sort().join('↔'); }
/* returns the pair [a,b] if a drill should be suggested, else null */
export function recordConfusion(asked, chosen){
  if(asked===chosen) return null;
  const k = pairKey(asked, chosen);
  stats.confusion[k] = (stats.confusion[k]||0)+1;
  saveSoon();
  if(stats.confusion[k] % CONFUSION_THRESHOLD === 0) return k.split('↔');
  return null;
}
export function topConfusions(n=3){
  return Object.entries(stats.confusion).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,n);
}
export function resetConfusion(a,b){ stats.confusion[pairKey(a,b)] = 0; }

/* per-degree mastery threshold: 85%+ over >=4 reps */
export function degMastered(sol){
  const r=stats.byDeg[sol];
  return !!(r && r.seen>=4 && r.hit/r.seen>=0.85);
}

/* ---------- persistence ---------- */
const SAVE_KEY = 'tonic-trainer-v1';
function storageOK(){
  try{ localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; }
  catch(e){ return false; }
}
export const CAN_STORE = typeof localStorage!=='undefined' && storageOK();

let saveTimer=null;
let snapshotExtra = ()=>({});   // main.js injects {stageUnlocked, stageId}
export function setSnapshotProvider(fn){ snapshotExtra = fn; }

export function saveSoon(){ if(!CAN_STORE) return; clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,300); }
export function saveNow(){
  if(!CAN_STORE) return;
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      stats, daily, settings, ...snapshotExtra()
    }));
  }catch(e){ /* quota or privacy mode: run memory-only */ }
}
/* returns the raw saved blob (or null); main.js applies stage/unlock parts */
export function loadSaved(){
  if(!CAN_STORE) return null;
  try{
    const raw=localStorage.getItem(SAVE_KEY); if(!raw) return null;
    const s=JSON.parse(raw);
    if(s.stats) Object.assign(stats, s.stats);
    if(s.daily) Object.assign(daily, s.daily);
    touchDaily();
    if(s.settings){
      for(const k of Object.keys(settings)){
        if(k==='practiceMode') continue;       // never restore into sing mode
        if(typeof s.settings[k] === typeof settings[k]) settings[k]=s.settings[k];
      }
    }
    return s;
  }catch(e){ return null; }
}
export function resetProgress(){
  try{ if(CAN_STORE) localStorage.removeItem(SAVE_KEY); }catch(e){}
}
