// In-page PWA install affordance. Chrome/Android fires `beforeinstallprompt`
// when ITS OWN internal engagement heuristics (visit count/time-on-site) are
// satisfied — a real player reported never once seeing this button on
// mobile, because that condition was never met for their browsing session.
// Rather than gate the whole button's visibility on that event, the button
// is now always shown (once not standalone); clicking it uses the native
// prompt when available, and otherwise falls back to manual instructions —
// iOS Safari always did this (no beforeinstallprompt event exists there at
// all), Chrome/Android/desktop now gets the same fallback instead of an
// invisible button. Hidden once installed / in-game.
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
  });
  window.addEventListener('appinstalled', () => { btn.style.display = 'none'; });
  show(); // always visible up front — no longer waiting on beforeinstallprompt

  btn.addEventListener('click', () => {
    if (deferred) {
      deferred.prompt();
      void deferred.userChoice.then(() => { deferred = null; btn.style.display = 'none'; });
    } else if (isIOSSafari) {
      alert('在 Safari 點底部「分享」→「加入主畫面」,即可像 App 一樣全螢幕開啟。');
    } else {
      alert(
        '安裝方法:\n' +
          'Chrome/Edge:網址列右側的安裝圖示,或右上角選單→「安裝應用程式」\n' +
          'Android Chrome:右上角選單→「新增至主畫面」\n' +
          '(有些瀏覽器要瀏覽幾次後才會顯示原生安裝提示,用上面的手動方式一樣有效)',
      );
    }
  });
}

// Hide the install button (e.g. when a game starts — keep it to the home).
export function hidePwaInstall(): void {
  const btn = document.getElementById('pwa-install');
  if (btn) btn.style.display = 'none';
}
