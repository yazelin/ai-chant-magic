import {
  VoiceStatus,
  classifyError,
  classifyEnd,
  GIVE_UP_MESSAGE,
} from './recognizer-policy';

export type { VoiceStatus } from './recognizer-policy';

// Minimal Web Speech API typings (not in lib.dom for all TS versions).
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

const RESTART_DELAY_MS = 350;

// Swappable voice input. Web Speech now; a local Whisper / in-browser Whisper
// implementation could implement this same interface later.
export interface VoiceInput {
  readonly status: VoiceStatus;
  start(): void;
  stop(): void;
  onTranscript(cb: (text: string) => void): void;
  onStatusChange(cb: (s: VoiceStatus, message?: string) => void): void;
}

export class WebSpeechVoiceInput implements VoiceInput {
  private recog: SpeechRecognitionLike | null = null;
  private _status: VoiceStatus = 'idle';
  private transcriptCb: (t: string) => void = () => {};
  private statusCb: (s: VoiceStatus, message?: string) => void = () => {};
  private wantOn = false;

  // restart-loop / backend-health tracking
  private startedAt = 0;
  private gotResultSinceStart = false;
  private errorSinceStart = false;
  private consecutiveBadEnds = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private lang = 'zh-TW') {
    const Ctor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      this.setStatus('unsupported', '此瀏覽器不支援語音(請用 Chrome/Edge)');
      return;
    }
    const r: SpeechRecognitionLike = new Ctor();
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (e) => {
      this.gotResultSinceStart = true;
      this.consecutiveBadEnds = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (text) this.transcriptCb(text);
      }
    };

    r.onerror = (err: any) => {
      const code = (err && err.error) || 'unknown';
      console.debug('[voice] onerror', code, err);
      this.errorSinceStart = true;
      const c = classifyError(code);
      if (c.fatal) {
        this.wantOn = false;
        this.clearRestart();
        this.setStatus(c.status, c.message);
      } else if (c.message) {
        // surface the transient reason but let onend decide on restart/give-up
        this.setStatus(this._status === 'listening' ? 'listening' : c.status, c.message);
      }
    };

    r.onend = () => {
      console.debug('[voice] onend', {
        wantOn: this.wantOn,
        ms: this.now() - this.startedAt,
        gotResult: this.gotResultSinceStart,
        errored: this.errorSinceStart,
        badEnds: this.consecutiveBadEnds,
      });
      if (!this.wantOn) {
        if (this._status === 'listening') this.setStatus('idle');
        return;
      }
      const d = classifyEnd({
        msSinceStart: this.now() - this.startedAt,
        gotResultSinceStart: this.gotResultSinceStart,
        errorSinceStart: this.errorSinceStart,
        consecutiveBadEnds: this.consecutiveBadEnds,
      });
      this.consecutiveBadEnds = d.consecutiveBadEnds;
      if (d.giveUp) {
        this.wantOn = false;
        this.clearRestart();
        this.setStatus('error', GIVE_UP_MESSAGE);
        return;
      }
      // delayed restart avoids a tight flashing loop
      this.clearRestart();
      this.restartTimer = setTimeout(() => this.beginRecognition(), RESTART_DELAY_MS);
    };

    this.recog = r;
  }

  get status(): VoiceStatus {
    return this._status;
  }

  private now(): number {
    return Date.now();
  }

  private setStatus(s: VoiceStatus, message?: string): void {
    this._status = s;
    this.statusCb(s, message);
  }

  private clearRestart(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private beginRecognition(): void {
    if (!this.recog || !this.wantOn) return;
    this.gotResultSinceStart = false;
    this.errorSinceStart = false;
    this.startedAt = this.now();
    try {
      this.recog.start();
      this.setStatus('listening');
    } catch {
      // InvalidStateError: already started — ignore
    }
  }

  start(): void {
    if (!this.recog || this._status === 'unsupported') return;
    this.wantOn = true;
    this.consecutiveBadEnds = 0;
    this.beginRecognition();
  }

  stop(): void {
    this.wantOn = false;
    this.clearRestart();
    if (this.recog) {
      try { this.recog.stop(); } catch { /* not started */ }
    }
    if (this._status === 'listening') this.setStatus('idle');
  }

  onTranscript(cb: (text: string) => void): void {
    this.transcriptCb = cb;
  }

  onStatusChange(cb: (s: VoiceStatus, message?: string) => void): void {
    this.statusCb = cb;
    cb(this._status);
  }
}
