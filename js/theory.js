/* ============================================================
   theory.js — pure music theory. No DOM, no audio, no shared state.
   Every function takes what it needs; everything here is unit-testable.
   ============================================================ */

export const DEGREES = [
  {sol:'do', num:'1', semi:0,  cls:'deg-1'},
  {sol:'re', num:'2', semi:2,  cls:'deg-2'},
  {sol:'mi', num:'3', semi:4,  cls:'deg-3'},
  {sol:'fa', num:'4', semi:5,  cls:'deg-4'},
  {sol:'so', num:'5', semi:7,  cls:'deg-5'},
  {sol:'la', num:'6', semi:9,  cls:'deg-6'},
  {sol:'ti', num:'7', semi:11, cls:'deg-7'},
];
/* retained but dormant: no stage lists these syllables since Chromatic was dropped */
export const CHROMATIC = [
  {sol:'di', num:'#1', semi:1,  cls:'deg-2'},
  {sol:'fi', num:'#4', semi:6,  cls:'deg-4'},
  {sol:'si', num:'#5', semi:8,  cls:'deg-6'},
];
export const ALL_DEGREES = DEGREES.concat(CHROMATIC);

/* la-based minor: same syllables, tonal centre = LA */
export const MINOR_SEMI = { la:0, ti:2, do:3, re:5, mi:7, fa:8, so:10, di:4, fi:9, si:11 };
export const MINOR_CLS  = { la:'deg-1', ti:'deg-2', do:'deg-3', re:'deg-4', mi:'deg-5', fa:'deg-6', so:'deg-7',
                            di:'deg-3', fi:'deg-6', si:'deg-7' };
export const MINOR_NUM  = { la:'1', ti:'2', do:'3', re:'4', mi:'5', fa:'6', so:'7', di:'#3', fi:'#6', si:'#7' };

export function degSemi(d, quality){ return quality==='minor' ? MINOR_SEMI[d.sol] : d.semi; }
export function degClass(d, quality){ return quality==='minor' ? MINOR_CLS[d.sol] : d.cls; }
export function degNum(d, quality){ return quality==='minor' ? MINOR_NUM[d.sol] : d.num; }
export function tonicSol(quality){ return quality==='minor' ? 'la' : 'do'; }

export const NOTE_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
export function noteName(midi){ return NOTE_NAMES[((midi%12)+12)%12]; }
export const A4 = 440;
export function midiToFreq(m){ return A4 * Math.pow(2,(m-69)/12); }

/* ---------- pitch ranges ---------- */
export const PITCH_CEILING = 84; // C6 — general safety ceiling
export const PITCH_FLOOR   = 48; // C3
export const MELODY_CEIL   = 79; // G5 — melodies & their feedback notes never exceed this

export function comfy(midi){
  while(midi > PITCH_CEILING) midi -= 12;
  while(midi < PITCH_FLOOR)   midi += 12;
  return midi;
}
/* single feedback notes in melody register: a clicked degree can sit higher
   than any melody note, so it gets the G5 ceiling too */
export function clampMelodyNote(m){
  while(m > MELODY_CEIL) m -= 12;
  return comfy(m);
}
/* melody sits +12 above the tonic unless that would pass G5; then the whole
   melody drops an octave TOGETHER, preserving its contour */
export function pickMelodyOct(mel, tonic, quality){
  const maxSemi = Math.max(...mel.map(d=>degSemi(d, quality)));
  return (tonic + maxSemi + 12 <= MELODY_CEIL) ? 12 : 0;
}

/* ---------- key-establishing progressions ---------- */
export const CADENCES = {
  classic: { name:'I–IV–V–I',   chords:[[0,4,7],[5,9,12],[7,11,14],[0,4,7]] },
  pop1:    { name:'I–V–vi–IV',  chords:[[0,4,7],[7,11,14],[9,12,16],[5,9,12]] },
  pop2:    { name:'vi–IV–I–V',  chords:[[9,12,16],[5,9,12],[0,4,7],[7,11,14]] },
  jazz:    { name:'ii–V–I',     chords:[[2,5,9],[7,11,14],[0,4,7]] },
};
export const MINOR_CADENCES = {
  classic: { name:'i–iv–V–i',    chords:[[0,3,7],[5,8,12],[7,11,14],[0,3,7]] },
  pop1:    { name:'i–VI–III–VII',chords:[[0,3,7],[8,12,15],[3,7,10],[10,14,17]] },
  pop2:    { name:'i–VII–VI–V',  chords:[[0,3,7],[10,14,17],[8,12,15],[7,11,14]] },
  jazz:    { name:'iiø–V–i',     chords:[[2,5,8],[7,11,14],[0,3,7]] },
};
export function cadenceChords(style, quality){
  const set = quality==='minor' ? MINOR_CADENCES : CADENCES;
  return set[style].chords;
}
export function cadenceName(style, quality){
  const set = quality==='minor' ? MINOR_CADENCES : CADENCES;
  return set[style].name;
}

/* ---------- diatonic resolution to the tonic ---------- */
export const MAJOR_SEMIS = [0,2,4,5,7,9,11];
export const MINOR_SEMIS = [0,2,3,5,7,8,10];

function descendPath(pc, scale){
  const below = scale.filter(s=>s<=pc);
  const path=[];
  if(!scale.includes(pc)) path.push(pc);
  for(let i=below.length-1;i>=0;i--) path.push(below[i]);
  if(path[path.length-1]!==0) path.push(0);
  return path;
}
/* pure: returns the semitone path (relative to the tonic pitch-class octave)
   the audio engine will voice. Leading tone resolves UP (pc 11 always;
   pc 10 only in major). */
export function resolutionPath(pc, quality){
  const scale = quality==='minor' ? MINOR_SEMIS : MAJOR_SEMIS;
  if(pc === 0) return [0];
  if(pc === 11 || (quality!=='minor' && pc === 10)) return [pc, 12];
  return descendPath(pc, scale);
}

/* ---------- melody generation ---------- */
/* Stepwise-biased phrase. `pick` supplies degree selection (lets the caller
   inject focus-weighting without theory knowing about stats). */
export function makePhrase(n, pool, quality, pick){
  const ordered = [...pool].sort((a,b)=>degSemi(a,quality)-degSemi(b,quality));
  const idxOf = d=>ordered.indexOf(d);
  const start = pick(pool);
  const phrase=[start];
  const leapChance = Math.min(0.15 + (n-2)*0.12, 0.45);
  for(let k=1;k<n;k++){
    const prev = phrase[k-1];
    const pi = idxOf(prev);
    let next;
    if(Math.random()<leapChance){
      do{ next = pick(pool); } while(next===prev && pool.length>1);
    } else {
      const dir = Math.random()<0.5?-1:1;
      let ni = pi+dir;
      if(ni<0) ni=pi+1; if(ni>=ordered.length) ni=pi-1;
      next = ordered[ni] || prev;
    }
    phrase.push(next);
  }
  return phrase;
}

/* ---------- Krumhansl–Schmuckler key clarity gate ---------- */
export const KK_MAJ=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
export const KK_MIN=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
export const KS_MARGIN = 0.20; // intended key must beat every rival decisively
                               // (~19 attempts/melody, 185 shapes remain; ear-calibratable)

function ksCorr(a,b){
  const n=12, ma=a.reduce((x,y)=>x+y)/n, mb=b.reduce((x,y)=>x+y)/n;
  let num=0,da=0,db=0;
  for(let i=0;i<n;i++){num+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;}
  return num/Math.sqrt(da*db||1);
}
export function ksIntendedKeyMargin(mel, quality){
  const hist=new Array(12).fill(0);
  mel.forEach(d=>hist[degSemi(d, quality)]++);
  let intended=null, best=-2, second=-2;
  for(let t=0;t<12;t++) for(const [q,prof] of [['maj',KK_MAJ],['min',KK_MIN]]){
    const rot=prof.map((_,i)=>prof[((i+t)%12)]);
    const c=ksCorr(hist,rot);
    if(t===0 && q===(quality==='minor'?'min':'maj')) intended=c;
    if(c>best){second=best;best=c;} else if(c>second) second=c;
  }
  return intended>=best ? intended-second : -1;
}
/* find-do melody: contains do, forced only into the MIDDLE if absent (no
   positional shortcut), and must pass the K-S clarity gate */
export function makeFindDoMelody(len, pool, quality, pick){
  let bestMel=null, bestMargin=-2;
  for(let tries=0;tries<60;tries++){
    const mel = makePhrase(len, pool, quality, pick);
    if(!mel.some(d=>d.sol==='do')){
      const doDeg = pool.find(d=>d.sol==='do');
      mel[1 + Math.floor(Math.random()*(mel.length-2))] = doDeg;
    }
    const margin = ksIntendedKeyMargin(mel, quality);
    if(margin>=KS_MARGIN) return mel;
    if(margin>bestMargin){ bestMargin=margin; bestMel=mel; }
  }
  return bestMel; // clearest candidate seen (fallback rate measured <0.5%)
}

/* cents between a frequency and a target midi note; null if no pitch */
export function centsFromMidi(freq, targetMidi){
  if(freq<=0) return null;
  return 1200*Math.log2(freq/midiToFreq(targetMidi));
}
/* fold to nearest octave: match pitch-class in ANY octave, range (-600,600] */
export function foldCents(cents){
  if(cents===null) return null;
  return ((cents+600)%1200+1200)%1200 - 600;
}
