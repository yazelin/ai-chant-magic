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

export type VoiceStatus = 'idle' | 'listening' | 'unsupported' | 'denied';

// Swappable voice input. Web Speech now; local Whisper could implement this later.
export interface VoiceInput {
  readonly status: VoiceStatus;
  start(): void;
  stop(): void;
  // called with each (possibly interim) transcript chunk
  onTranscript(cb: (text: string) => void): void;
  onStatusChange(cb: (s: VoiceStatus) => void): void;
}

export class WebSpeechVoiceInput implements VoiceInput {
  private recog: SpeechRecognitionLike | null = null;
  private _status: VoiceStatus = 'idle';
  private transcriptCb: (t: string) => void = () => {};
  private statusCb: (s: VoiceStatus) => void = () => {};
  private wantOn = false;

  constructor(private lang = 'zh-TW') {
    const Ctor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      this.setStatus('unsupported');
      return;
    }
    const r: SpeechRecognitionLike = new Ctor();
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (text) this.transcriptCb(text);
      }
    };
    r.onerror = (err: any) => {
      if (err && err.error === 'not-allowed') this.setStatus('denied');
    };
    r.onend = () => {
      // Web Speech tends to auto-stop; restart if we still want to listen.
      if (this.wantOn && this._status === 'listening') {
        try { r.start(); } catch { /* already starting */ }
      }
    };
    this.recog = r;
  }

  get status(): VoiceStatus {
    return this._status;
  }

  private setStatus(s: VoiceStatus): void {
    this._status = s;
    this.statusCb(s);
  }

  start(): void {
    if (!this.recog || this._status === 'unsupported') return;
    this.wantOn = true;
    try {
      this.recog.start();
      this.setStatus('listening');
    } catch { /* already started */ }
  }

  stop(): void {
    this.wantOn = false;
    if (this.recog) this.recog.stop();
    if (this._status === 'listening') this.setStatus('idle');
  }

  onTranscript(cb: (text: string) => void): void {
    this.transcriptCb = cb;
  }

  onStatusChange(cb: (s: VoiceStatus) => void): void {
    this.statusCb = cb;
    cb(this._status);
  }
}
