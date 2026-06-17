// Procedural Web Audio SFX. No asset files — every sound is synthesized at play
// time from oscillators + a single shared white-noise buffer. Designed to be
// cheap, punchy, and totally optional: every entry point is guarded so a missing
// AudioContext (SSR / node test env / locked-down browser) simply does nothing.
//
// Usage:
//   initAudio()        — call from a user gesture to create/resume the context.
//   sfxCast()          — sparkly "shimmer/charge" when a spell is cast.
//   sfxFireball()      — airy "whoosh" for a fire projectile.
//   sfxExplosion(big)  — punchy "boom" on impact (bigger/longer when big).

// Lazily-created singletons. We keep one AudioContext + one master GainNode +
// one reusable noise buffer for the lifetime of the page.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

const MASTER_VOLUME = 0.25; // modest — layered sounds should not clip/blast

// Resolve a constructor for AudioContext across browsers without assuming it
// exists (Safari prefixes it; node/test has neither).
function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

// Create (once) the AudioContext + master gain, and resume it. Safe to call
// repeatedly and from non-gesture paths — it only succeeds inside a gesture but
// never throws if it can't.
export function initAudio(): void {
  try {
    if (!ctx) {
      const Ctor = audioContextCtor();
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
    }
    // Autoplay policies suspend a fresh context until a gesture resumes it.
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // AudioContext unavailable / blocked — stay silent.
    ctx = null;
    master = null;
  }
}

// Expose the shared context + master gain so the procedural music engine can
// schedule notes on the SAME AudioContext (one clock, one output bus).
export function getAudioCtx(): AudioContext | null {
  return ctx;
}
export function getMaster(): GainNode | null {
  return master;
}

// Build a 1-second mono white-noise buffer once and reuse it for every noise
// layer (whoosh filter sweep, explosion crackle). Returns null if no context.
function getNoiseBuffer(): AudioBuffer | null {
  if (!ctx) return null;
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 1.0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return noiseBuffer;
}

// A short waveshaper curve giving soft saturation/grit to the explosion boom.
// Typed against an explicit ArrayBuffer so it satisfies WaveShaperNode.curve
// under TS's newer typed-array generics.
let shaperCurve: Float32Array<ArrayBuffer> | null = null;
function getShaperCurve(): Float32Array<ArrayBuffer> {
  if (shaperCurve) return shaperCurve;
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 12; // drive amount — gentle, just enough for crunch
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  shaperCurve = curve;
  return shaperCurve;
}

// A noise source playing from a random offset through the shared buffer so
// repeated bursts don't sound identical.
function noiseSource(): AudioBufferSourceNode | null {
  const buf = getNoiseBuffer();
  if (!ctx || !buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

// CAST — a quick magical shimmer/charge. Two slightly detuned oscillators
// (triangle + sine) sweeping ~300→700Hz over ~0.18s with a snappy
// attack/decay envelope so it reads as a sparkle rather than a beep.
export function sfxCast(): void {
  try {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const dur = 0.18;

    const gain = ctx.createGain();
    gain.connect(master);
    // ramp, never hard-set: ~12ms attack, exponential decay to silence
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.6, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    const types: OscillatorType[] = ['triangle', 'sine'];
    const detunes = [0, 8]; // cents apart for a subtle chorus shimmer
    const oscs: OscillatorNode[] = [];
    for (let i = 0; i < types.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = types[i];
      osc.detune.value = detunes[i];
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + dur);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      oscs.push(osc);
    }
    void oscs;
  } catch {
    // ignore — audio is best-effort
  }
}

// FIREBALL — an airy whoosh: white noise through a bandpass whose center
// frequency sweeps ~1200→300Hz over ~0.22s. Fast attack, short decay.
export function sfxFireball(): void {
  try {
    if (!ctx || !master) return;
    const src = noiseSource();
    if (!src) return;
    const now = ctx.currentTime;
    const dur = 0.22;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(1200, now);
    bp.frequency.exponentialRampToValueAtTime(300, now + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.015); // fast attack
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur); // short decay

    src.connect(bp);
    bp.connect(gain);
    gain.connect(master);

    const offset = Math.random() * 0.5;
    src.start(now, offset, dur + 0.03);
    src.stop(now + dur + 0.05);
  } catch {
    // ignore
  }
}

// EXPLOSION — a punchy boom. A low sine dropping 70→35Hz (90→40 when big) for
// the body + a noise burst through a lowpass (~800Hz) for the crack, both run
// through a waveshaper for grit. Fast ~5ms attack, ~0.35s decay (0.6s big).
// `big` makes it louder and longer (firestorm vs fireball).
export function sfxExplosion(big = false): void {
  try {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const decay = big ? 0.6 : 0.35;
    const peak = big ? 0.95 : 0.7;
    const fStart = big ? 90 : 70;
    const fEnd = big ? 40 : 35;

    // shared grit stage feeding the master
    const shaper = ctx.createWaveShaper();
    shaper.curve = getShaperCurve();
    shaper.oversample = '2x';
    const outGain = ctx.createGain();
    outGain.gain.setValueAtTime(0.0001, now);
    outGain.gain.exponentialRampToValueAtTime(peak, now + 0.005); // fast attack
    outGain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    shaper.connect(outGain);
    outGain.connect(master);

    // body: low sine sweeping down
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(fStart, now);
    body.frequency.exponentialRampToValueAtTime(fEnd, now + decay);
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 1.0;
    body.connect(bodyGain);
    bodyGain.connect(shaper);
    body.start(now);
    body.stop(now + decay + 0.05);

    // crack: noise burst through a lowpass
    const src = noiseSource();
    if (src) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(big ? 1000 : 800, now);
      lp.frequency.exponentialRampToValueAtTime(big ? 200 : 150, now + decay);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.9, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + decay * 0.9);
      src.connect(lp);
      lp.connect(noiseGain);
      noiseGain.connect(shaper);
      const offset = Math.random() * 0.5;
      src.start(now, offset, decay + 0.03);
      src.stop(now + decay + 0.05);
    }
  } catch {
    // ignore
  }
}

// --- Event SFX table -------------------------------------------------------
// Small reusable helpers so each event sound is a few lines. All best-effort.

// A pitched blip: an oscillator sweeping fStart→fEnd with a snappy envelope.
function blip(type: OscillatorType, fStart: number, fEnd: number, dur: number, peak: number): void {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(fStart, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, fEnd), now + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

// A short ascending arpeggio of square/triangle notes (for level-up / new wave).
function arp(freqs: number[], step: number, type: OscillatorType, peak: number): void {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  freqs.forEach((f, i) => {
    const t = now + i * step;
    const osc = ctx!.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
    osc.connect(g);
    g.connect(master!);
    osc.start(t);
    osc.stop(t + step * 1.6 + 0.02);
  });
}

// HIT / KILL — a quick "啵": square 200→70Hz + a tiny lowpass noise tick.
export function sfxHit(): void {
  try {
    blip('square', 200, 70, 0.12, 0.4);
    const src = noiseSource();
    if (!ctx || !master || !src) return;
    const now = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(now, Math.random() * 0.5, 0.1); src.stop(now + 0.12);
  } catch { /* ignore */ }
}

// HURT — harsh sawtooth 300→90Hz downslide.
export function sfxHurt(): void {
  try { blip('sawtooth', 300, 90, 0.18, 0.45); } catch { /* ignore */ }
}

// HEAL — gentle 784 + 1046Hz sine chime.
export function sfxHeal(): void {
  try { arp([784, 1046], 0.09, 'sine', 0.32); } catch { /* ignore */ }
}

// ZAP — thunder/chain crackle: high square zap + brief noise.
export function sfxZap(): void {
  try {
    blip('square', 1400, 500, 0.1, 0.3);
    const src = noiseSource();
    if (!ctx || !master || !src) return;
    const now = ctx.currentTime;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(now, Math.random() * 0.5, 0.1); src.stop(now + 0.12);
  } catch { /* ignore */ }
}

// FROST — icy shimmer: high sine + descending bandpass noise.
export function sfxFrost(): void {
  try {
    blip('triangle', 1800, 900, 0.2, 0.22);
    const src = noiseSource();
    if (!ctx || !master || !src) return;
    const now = ctx.currentTime;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(3000, now);
    bp.frequency.exponentialRampToValueAtTime(1200, now + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(now, Math.random() * 0.5, 0.22); src.stop(now + 0.24);
  } catch { /* ignore */ }
}

// SHIELD — protective rising shimmer.
export function sfxShield(): void {
  try { blip('sine', 400, 800, 0.25, 0.3); blip('triangle', 600, 1000, 0.25, 0.18); } catch { /* ignore */ }
}

// NEW WAVE — bright ascending C-E-G-C arpeggio.
export function sfxWave(): void {
  try { arp([523, 659, 784, 1046], 0.08, 'square', 0.26); } catch { /* ignore */ }
}

// PLAYER DOWN/DEATH — long 420→60Hz sine downslide.
export function sfxDeath(): void {
  try { blip('sine', 420, 60, 0.7, 0.4); } catch { /* ignore */ }
}
