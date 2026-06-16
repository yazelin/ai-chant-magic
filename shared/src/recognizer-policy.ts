// Pure decision logic for the speech recognizer, extracted so it can be unit-tested
// without a browser / Web Speech backend.

export type VoiceStatus = 'idle' | 'listening' | 'unsupported' | 'denied' | 'error';

// An "end" is considered bad if it produced no transcript and either ended almost
// immediately or an error fired during the session. Enough consecutive bad ends
// means the backend is unusable (e.g. snap Chromium has no Google speech backend)
// and we should stop the restart loop instead of flashing the mic forever.
export const IMMEDIATE_END_MS = 800;
export const MAX_BAD_ENDS = 4;

export const GIVE_UP_MESSAGE =
  '此瀏覽器無法使用語音辨識(常見於 Linux 的 snap 版 Chromium,沒有語音後端)。請改用 Google Chrome 或 Microsoft Edge。';

export interface ErrorClass {
  fatal: boolean;        // fatal = stop listening entirely
  status: VoiceStatus;
  message: string;       // human-facing; '' means no message to surface
}

// Map a SpeechRecognition error code to how the recognizer should react.
export function classifyError(code: string): ErrorClass {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return { fatal: true, status: 'denied', message: '麥克風權限被拒,請在網址列允許麥克風後重新整理' };
    case 'audio-capture':
      return { fatal: true, status: 'error', message: '找不到麥克風裝置' };
    case 'language-not-supported':
      return { fatal: true, status: 'error', message: '此語系不支援辨識' };
    case 'network':
      // Persistent on browsers without a speech backend (snap Chromium).
      return { fatal: false, status: 'error', message: '語音服務連線失敗(network)' };
    default:
      // 'no-speech' / 'aborted' etc. are benign — keep listening.
      return { fatal: false, status: 'listening', message: '' };
  }
}

export interface EndInput {
  msSinceStart: number;
  gotResultSinceStart: boolean;
  errorSinceStart: boolean;
  consecutiveBadEnds: number;
}

export interface EndDecision {
  consecutiveBadEnds: number;  // updated counter to carry forward
  giveUp: boolean;             // stop restarting and surface GIVE_UP_MESSAGE
}

export function classifyEnd(input: EndInput): EndDecision {
  const bad =
    !input.gotResultSinceStart &&
    (input.msSinceStart < IMMEDIATE_END_MS || input.errorSinceStart);
  const count = bad ? input.consecutiveBadEnds + 1 : 0;
  return { consecutiveBadEnds: count, giveUp: count >= MAX_BAD_ENDS };
}
