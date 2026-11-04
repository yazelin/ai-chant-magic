// 等待模式的轉發站位址與房間網址。本機開發可用 ?relay=ws://localhost:8787 覆寫。
const override = new URLSearchParams(location.search).get('relay');
export const RELAY_URL = override ?? 'wss://ai-chant-magic-arena.yazelinj303.workers.dev';

export function roomFromUrl(params: URLSearchParams): string | null {
  const r = (params.get('room') ?? '').toUpperCase();
  return /^[A-Z0-9]{3,12}$/.test(r) ? r : null;
}

// 手機頁跟主畫面放在同一個目錄（GitHub Pages 的 /ai-chant-magic/）
export function padUrl(room: string): string {
  const u = new URL('pad.html', location.href);
  u.search = `?room=${room}`;
  if (override) u.searchParams.set('relay', override);
  return u.toString();
}
