// 等待模式的背景音樂：四首 Lyria 產的循環曲（arena-0 平靜 … arena-3 最激烈），
// 換階時交叉淡入淡出。用 <audio> 播放，分頁在背景也不會斷斷續續。
// 檔案載不到時退回原本程式合成的 MusicEngine（見 arena.ts）。

const FADE_MS = 1800;

export class TrackMusic {
  private els: HTMLAudioElement[];
  private level = 0;
  private volume = 0.55;
  private on = false;
  private fadeTimer = 0;

  constructor(urls: string[]) {
    this.els = urls.map((u) => {
      const a = new Audio(u);
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0;
      return a;
    });
  }

  // 要在使用者點擊的事件裡呼叫（瀏覽器的自動播放限制）。回傳是否真的播得出來。
  async start(): Promise<boolean> {
    this.on = true;
    try {
      // 四首一起開始（音量 0），之後只調音量，換階時不用等載入
      await Promise.all(this.els.map((a) => a.play()));
    } catch {
      this.on = false;
      return false;
    }
    this.fadeTo(this.level);
    return true;
  }

  stop(): void {
    this.on = false;
    clearInterval(this.fadeTimer);
    for (const a of this.els) a.volume = 0;
  }

  setMuted(m: boolean): void {
    for (const a of this.els) a.muted = m;
  }

  setIntensity(level: number): void {
    const l = Math.max(0, Math.min(this.els.length - 1, Math.floor(level)));
    if (l === this.level) return;
    this.level = l;
    if (this.on) this.fadeTo(l);
  }

  private fadeTo(l: number): void {
    clearInterval(this.fadeTimer);
    const from = this.els.map((a) => a.volume);
    const t0 = performance.now();
    this.fadeTimer = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / FADE_MS);
      this.els.forEach((a, i) => { a.volume = from[i] + ((i === l ? this.volume : 0) - from[i]) * k; });
      if (k >= 1) clearInterval(this.fadeTimer);
    }, 50);
  }
}
