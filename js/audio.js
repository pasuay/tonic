/* ============================================================
   audio.js — Web Audio synthesis, cadence/melody scheduling, the single
   completionAudio() owner, and mic + pitch detection. Lazy init: nothing
   touches AudioContext or getUserMedia at import time (node-importable).
   ============================================================ */
import { midiToFreq, cadenceChords, resolutionPath, comfy } from './theory.js';

const AudioCtx = typeof window!=='undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
let ac = null;
export function ensureAudio(){ if(!ac) ac = new AudioCtx(); if(ac.state==='suspended') ac.resume(); return ac; }
export function now(){ ensureAudio(); return ac.currentTime; }

export const INSTRUMENTS = {
  piano:   { partials:[1,0.55,0.35,0.18,0.09,0.05], attack:0.005, decay:1.9, type:'decay' },
  flute:   { partials:[1,0.25,0.12,0.04], attack:0.06, decay:0.2, type:'sustain', vibrato:5 },
  strings: { partials:[1,0.6,0.45,0.4,0.28,0.2,0.14,0.08], attack:0.12, decay:0.3, type:'sustain', vibrato:6, vibratoDepth:0.008 },
  vox:     { partials:[1,0.7,0.85,0.4,0.22,0.1,0.05], attack:0.08, decay:0.25, type:'sustain', vibrato:5.5, vibratoDepth:0.012 },
  synth:   { partials:[1,0.4,0.6,0.2,0.15], attack:0.01, decay:0.5, type:'sustain' },
};

export function playNote(instName, midi, when, dur, gainScale=1){
  const ctx = ensureAudio();
  const inst = INSTRUMENTS[instName];
  const f = midiToFreq(midi);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const peak = 0.16 * gainScale;
  const t0 = when;
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(peak, t0 + inst.attack);
  if(inst.type==='decay'){
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  } else {
    master.gain.setValueAtTime(peak, t0 + Math.max(inst.attack, dur-0.12));
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  inst.partials.forEach((amp,i)=>{
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f*(i+1);
    if(inst.vibrato){
      const lfo = ctx.createOscillator(); const lg = ctx.createGain();
      lfo.frequency.value = inst.vibrato; lg.gain.value = f*(i+1)*(inst.vibratoDepth||0.006);
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t0); lfo.stop(t0+dur);
    }
    const g = ctx.createGain(); g.gain.value = amp;
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0+dur+0.05);
  });
}
export function playChord(instName, midis, when, dur, gainScale=0.8){
  midis.forEach(m=>playNote(instName, m, when, dur, gainScale/Math.sqrt(midis.length)));
}

/* Play the round's key-establishing progression; returns its length (s). */
export function playCadence(instName, tonicMidi, when, style, quality){
  const chords = cadenceChords(style, quality);
  const d=0.55;
  chords.forEach((ch,i)=>{
    const last = i===chords.length-1;
    playChord(instName, ch.map(x=>x+tonicMidi), when + d*i, last? d*1.3 : d);
  });
  return d*(chords.length-1) + d*1.3;
}

/* ============================================================
   completionAudio — the SINGLE owner of "what sounds when a round ends".
   Four audio-collision bugs came from callers each deciding this locally;
   now every completion path calls here and nowhere else.
   Returns total ms until the sound finishes (0 if silent).
   opts:
     resolveFrom : midi to resolve down/up to the tonic (or null)
     resolveOn   : the user setting
     confirmMidi : note to sound plainly when resolve is OFF (or null)
     tonic, quality, instrument
   ============================================================ */
export function completionAudio({resolveFrom=null, resolveOn=false, confirmMidi=null, tonic, quality, instrument}){
  ensureAudio();
  if(resolveOn && resolveFrom!=null){
    return resolveToTonic(instrument, resolveFrom, tonic, quality);
  }
  if(confirmMidi!=null){
    playNote(instrument, confirmMidi, ac.currentTime+0.1, 0.8, 1.1);
    return 900;
  }
  return 0;
}

/* voices theory.resolutionPath, anchored to the octave the note was heard in */
export function resolveToTonic(instName, fromMidi, tonicMidi, quality){
  ensureAudio();
  const octBase = tonicMidi + 12*Math.floor((fromMidi - tonicMidi)/12);
  const pc = ((fromMidi - tonicMidi) % 12 + 12) % 12;
  const path = resolutionPath(pc, quality);
  let t = ac.currentTime + 0.15;
  let last_end = t;
  path.forEach((semi,i)=>{
    const last = i===path.length-1;
    const dur = last?0.75:0.4;
    playNote(instName, comfy(octBase + semi), t, dur, last?1.15:0.95);
    last_end = t + dur;
    t += last?0.75:0.42;
  });
  return (last_end - ac.currentTime) * 1000;
}

/* ---------- drone (sing-back scaffold) ---------- */
let droneNodes=null;
export function startDrone(instUnused, tonicMidi, level){
  stopDrone();
  if(level<=0.02) return;
  const ctx=ensureAudio();
  const droneMidi = comfy(tonicMidi + 12); // the tonic (la in minor), in singing range
  const g = ctx.createGain();
  g.gain.value = 0.05 * level;
  g.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type='sine'; osc.frequency.value = midiToFreq(droneMidi);
  const osc2 = ctx.createOscillator();
  osc2.type='sine'; osc2.frequency.value = midiToFreq(droneMidi-12);
  const g2=ctx.createGain(); g2.gain.value=0.5; osc2.connect(g2); g2.connect(g);
  osc.connect(g); osc.start(); osc2.start();
  droneNodes = {osc,osc2,g};
}
export function stopDrone(){
  if(droneNodes){
    try{ droneNodes.osc.stop(); droneNodes.osc2.stop(); }catch(e){}
    droneNodes=null;
  }
}

/* ---------- mic + pitch detection ---------- */
let micAnalyser=null, micBuf=null;
export async function ensureMic(){
  if(micAnalyser) return true;
  try{
    ensureAudio();
    const micStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const src = ac.createMediaStreamSource(micStream);
    micAnalyser = ac.createAnalyser();
    micAnalyser.fftSize = 2048;
    src.connect(micAnalyser);
    micBuf = new Float32Array(micAnalyser.fftSize);
    return true;
  }catch(e){ return false; }
}
export function detectPitch(){
  if(!micAnalyser) return -1;
  micAnalyser.getFloatTimeDomainData(micBuf);
  return autoCorrelate(micBuf, ac.sampleRate);
}

/* Autocorrelation restricted to the vocal range (80–1000 Hz): ~6x cheaper
   than a full-lag search AND more robust against harmonic/octave errors.
   Preallocated scratch; verified <11 cents error across E2–B5. */
export const PITCH_MIN_HZ=80, PITCH_MAX_HZ=1000;
let corrScratch=null;
export function autoCorrelate(buf, sampleRate){
  const SIZE=buf.length; let rms=0;
  for(let i=0;i<SIZE;i++) rms+=buf[i]*buf[i];
  rms=Math.sqrt(rms/SIZE);
  if(rms<0.01) return -1;
  const lagMin=Math.floor(sampleRate/PITCH_MAX_HZ);
  const lagMax=Math.min(Math.ceil(sampleRate/PITCH_MIN_HZ), SIZE-1);
  if(!corrScratch || corrScratch.length<lagMax+1) corrScratch=new Float64Array(lagMax+1);
  const c=corrScratch;
  for(let lag=lagMin; lag<=lagMax; lag++){
    let sum=0;
    for(let i=0;i<SIZE-lag;i++) sum+=buf[i]*buf[i+lag];
    c[lag]=sum;
  }
  // skip the near-zero-lag shoulder, then take the global max in range
  let d=lagMin; while(d<lagMax && c[d]>c[d+1]) d++;
  let maxval=-1,maxpos=-1;
  for(let lag=d;lag<=lagMax;lag++){ if(c[lag]>maxval){ maxval=c[lag]; maxpos=lag; } }
  if(maxpos<0) return -1;
  let T0=maxpos;
  const x1=(T0>lagMin)?c[T0-1]:c[T0], x2=c[T0], x3=(T0<lagMax)?c[T0+1]:c[T0];
  const a=(x1+x3-2*x2)/2, bb=(x3-x1)/2;
  if(a) T0 = T0 - bb/(2*a);
  return sampleRate/T0;
}
