// Procedural adaptive background music — NO audio files. A look-ahead scheduler
// computes chiptune notes on the shared AudioContext (one clock with the SFX),
// scheduling ~0.4s ahead so playback is seamless and sample-accurate. The track
// escalates with game intensity (wave count); switches land on the next bar so
// the transition is gap-free.
//
// Design echoes the "A Tale of Two Clocks" Web Audio scheduling pattern:
// a setInterval wakes often and queues any notes due within the look-ahead.
import { getAudioCtx, getMaster } from './sfx';

const ROOT = 220; // A3 — minor, "dark arcane" feel
const PENT = [0, 3, 5, 7, 10, 12, 15, 17]; // A-minor pentatonic over ~2 octaves
const hz = (semi: number): number => ROOT * Math.pow(2, semi / 12);

interface Note { at: number; freq: number; dur: number; type: OscillatorType; g: number }
interface Track { name: string; bar: number; build: (barIndex: number) => Note[] }

// Driving bass: root/fifth pattern, low square. count notes filling the bar.
function bass(count: number, dur: number, g: number): Note[] {
  const pat = [0, 0, 7, 5];
  const out: Note[] = [];
  for (let k = 0; k < count; k++) {
    out.push({ at: k * dur, freq: hz(pat[k % pat.length] - 12), dur: dur * 0.85, type: 'square', g });
  }
  return out;
}

// Lead: an evolving pentatonic walk (bar index shifts the phrase so it doesn't
// loop identically). `oct` raises it; count notes filling the bar.
function lead(barIndex: number, count: number, dur: number, oct: number, type: OscillatorType, g: number): Note[] {
  const out: Note[] = [];
  for (let k = 0; k < count; k++) {
    const idx = (barIndex * 3 + k * 2) % PENT.length;
    out.push({ at: k * dur, freq: hz(PENT[idx] + oct), dur: dur * 0.9, type, g });
  }
  return out;
}

// Intensity 0..2. Bar lengths get shorter + notes denser as it escalates.
const TRACKS: Track[] = [
  { name: '暗潮', bar: 2.0, build: (i) => [...bass(2, 1.0, 0.22), ...lead(i, 4, 0.5, 0, 'triangle', 0.16)] },
  { name: '獵殺', bar: 1.2, build: (i) => [...bass(4, 0.3, 0.24), ...lead(i, 8, 0.15, 0, 'square', 0.13)] },
  { name: '狂亂', bar: 0.9, build: (i) => [...bass(6, 0.15, 0.26), ...lead(i, 12, 0.075, 12, 'square', 0.11)] },
];

export class MusicEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private bus: GainNode | null = null;
  private nextBar = 0;
  private barIndex = 0;
  private current = 0;
  private pending = 0;
  private static readonly LOOKAHEAD = 0.4; // seconds scheduled ahead
  private static readonly TICK_MS = 100;

  // Start the scheduler. No-op if there's no AudioContext yet (call after a
  // user gesture / initAudio) or if already running.
  start(): void {
    const ctx = getAudioCtx();
    const master = getMaster();
    if (!ctx || !master || this.timer) return;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.5; // music sits under the SFX
    this.bus.connect(master);
    this.nextBar = ctx.currentTime + 0.15;
    this.barIndex = 0;
    this.timer = setInterval(() => this.schedule(), MusicEngine.TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // 0 = calm … 2 = frenzy. Applied at the next bar boundary (seamless).
  setIntensity(level: number): void {
    this.pending = Math.max(0, Math.min(TRACKS.length - 1, Math.floor(level)));
  }

  private schedule(): void {
    const ctx = getAudioCtx();
    if (!ctx || !this.bus) return;
    while (this.nextBar < ctx.currentTime + MusicEngine.LOOKAHEAD) {
      if (this.pending !== this.current) this.current = this.pending; // switch on the bar
      const track = TRACKS[this.current];
      for (const n of track.build(this.barIndex)) this.playNote(ctx, this.nextBar + n.at, n);
      this.nextBar += track.bar;
      this.barIndex++;
    }
  }

  private playNote(ctx: AudioContext, time: number, n: Note): void {
    const osc = ctx.createOscillator();
    osc.type = n.type;
    osc.frequency.value = n.freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(n.g, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + n.dur);
    osc.connect(g);
    g.connect(this.bus!);
    osc.start(time);
    osc.stop(time + n.dur + 0.03);
  }
}
