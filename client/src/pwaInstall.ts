// In-page PWA install affordance. Chrome/Android no longer shows an automatic
// install banner — it fires `beforeinstallprompt`, which we capture to show our
// own "安裝 App" button. iOS Safari has no such event, so we show an
// "加到主畫面" hint with manual instructions. Hidden once installed / in-game.
type BeforeInstallPromptEvent = Event & {
  prompt: () => void;
  userChoice: Promise<{ outcome: string }>;
};

export function initPwaInstall(): void {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return; // already running as an installed app

  const ua = navigator.userAgent;
  const isIOSSafari = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios|android/i.test(ua);
  let deferred: BeforeInstallPromptEvent | null = null;

  const btn = document.createElement('button');
  btn.id = 'pwa-install';
  btn.textContent = '安裝 App';
  btn.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:200;display:none;cursor:pointer;' +
    'background:#2a1f4d;color:#fff;border:1px solid #b06cff;border-radius:999px;' +
    'padding:9px 15px;font:600 13px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.5);';
  document.body.appendChild(btn);

  const inGame = () =>
    document.getElementById('game-chrome')?.classList.contains('playing') ?? false;
  const show = () => { if (!inGame()) btn.style.display = 'block'; };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    show();
  });
  window.addEventListener('appinstalled', () => { btn.style.display = 'none'; });
  if (isIOSSafari) { btn.textContent = '加到主畫面'; show(); }

  btn.addEventListener('click', () => {
    if (deferred) {
      deferred.prompt();
      void deferred.userChoice.then(() => { deferred = null; btn.style.display = 'none'; });
    } else if (isIOSSafari) {
      alert('在 Safari 點底部「分享」→「加入主畫面」,即可像 App 一樣全螢幕開啟。');
    }
  });
}

// Hide the install button (e.g. when a game starts — keep it to the home).
export function hidePwaInstall(): void {
  const btn = document.getElementById('pwa-install');
  if (btn) btn.style.display = 'none';
}
