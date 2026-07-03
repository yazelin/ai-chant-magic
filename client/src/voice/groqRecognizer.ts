import { VoiceStatus } from '@acm/shared';
import { VoiceInput } from './recognizer';

// Resolution order mirrors resolveServerUrl()/resolveLeaderboardUrl():
// ?voiceproxy= query param > VITE_VOICE_PROXY_URL (baked in at build time) >
// '' (not configured — GroqVoiceInput becomes a permanent no-op 'unsupported',
// same as a browser with no Web Speech API at all).
export function resolveVoiceProxyUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const q = new URLSearchParams(window.location.search).get('voiceproxy');
    if (q) return q;
  }
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  if (env && env.VITE_VOICE_PROXY_URL) return env.VITE_VOICE_PROXY_URL;
  return '';
}

// Energy-based voice activity detection: no ML, just RMS amplitude against a
// threshold. Good enough for short (2-6 character) chant phrases — waiting
// for a real pause to end an utterance fits "say the spell name" much better
// than an arbitrary fixed-length chunk clock would, and it costs one Groq
// call per actual utterance instead of one per tick regardless of silence.
const SPEECH_RMS_THRESHOLD = 0.02;
const SILENCE_MS_TO_CUT = 700;
const MAX_UTTERANCE_MS = 8000; // safety cap — never buffer forever even if VAD never sees silence

// Web Speech API and any cloud STT both require network — this is the
// fallback for "browser's own recognizer is unsupported or non-functional",
// NOT an offline solution. See recognizer.ts's give-up heuristic for what
// triggers switching to this.
export class GroqVoiceInput implements VoiceInput {
  private _status: VoiceStatus = 'idle';
  private transcriptCb: (t: string) => void = () => {};
  private statusCb: (s: VoiceStatus, message?: string) => void = () => {};
  private wantOn = false;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private vadTimer: ReturnType<typeof setInterval> | null = null;
  private speaking = false;
  private silenceStartedAt = 0;
  private utteranceStartedAt = 0;
  private busy = false; // a transcription request is in flight

  constructor(
    private workerUrl: string,
    private promptHint: string,
  ) {
    if (!this.workerUrl) {
      this.setStatus('unsupported', '語音備援未設定');
    }
  }

  get status(): VoiceStatus {
    return this._status;
  }

  private setStatus(s: VoiceStatus, message?: string): void {
    this._status = s;
    this.statusCb(s, message);
  }

  async start(): Promise<void> {
    if (this._status === 'unsupported' || this.wantOn) return;
    this.wantOn = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.wantOn = false;
      this.setStatus('denied', '麥克風權限被拒,請在網址列允許麥克風後重新整理');
      return;
    }
    this.audioCtx = new AudioContext();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    this.setStatus('listening');
    this.beginUtterance();
    this.vadTimer = setInterval(() => this.checkVad(), 100);
  }

  stop(): void {
    this.wantOn = false;
    if (this.vadTimer !== null) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.analyser = null;
    if (this._status === 'listening') this.setStatus('idle');
  }

  onTranscript(cb: (text: string) => void): void {
    this.transcriptCb = cb;
  }

  onStatusChange(cb: (s: VoiceStatus, message?: string) => void): void {
    this.statusCb = cb;
    cb(this._status);
  }

  private beginUtterance(): void {
    if (!this.stream || !this.wantOn) return;
    this.chunks = [];
    this.speaking = false;
    this.silenceStartedAt = 0;
    this.utteranceStartedAt = Date.now();
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : '';
    this.recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => this.flushUtterance();
    this.recorder.start();
  }

  private checkVad(): void {
    if (!this.analyser || !this.recorder) return;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (const v of data) {
      const centered = (v - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const now = Date.now();

    if (rms > SPEECH_RMS_THRESHOLD) {
      this.speaking = true;
      this.silenceStartedAt = 0;
    } else if (this.speaking) {
      if (this.silenceStartedAt === 0) this.silenceStartedAt = now;
      if (now - this.silenceStartedAt >= SILENCE_MS_TO_CUT) this.cutUtterance();
    }
    // Safety cap: never buffer indefinitely even if VAD never sees silence
    // (e.g. sustained background noise keeping rms above threshold).
    if (now - this.utteranceStartedAt >= MAX_UTTERANCE_MS) this.cutUtterance();
  }

  private cutUtterance(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  private async flushUtterance(): Promise<void> {
    const chunks = this.chunks;
    this.chunks = [];
    // No speech detected this utterance (silence the whole time) — nothing
    // worth transcribing, just start listening for the next one.
    if (!this.speaking || chunks.length === 0 || this.busy) {
      if (this.wantOn) this.beginUtterance();
      return;
    }
    this.busy = true;
    try {
      const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
      const form = new FormData();
      form.append('audio', blob, 'audio.webm');
      if (this.promptHint) form.append('prompt', this.promptHint);
      const res = await fetch(`${this.workerUrl}/transcribe`, { method: 'POST', body: form });
      if (res.ok) {
        const data = (await res.json()) as { text?: string };
        if (data.text) this.transcriptCb(data.text);
      }
    } catch {
      // network hiccup on a single utterance — not fatal, just try the next one
    } finally {
      this.busy = false;
      if (this.wantOn) this.beginUtterance();
    }
  }
}
