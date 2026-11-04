import { CLASSES, ClassId, SPELLS, SpellId, classSpellSet, matchSpell, matchesAny, RESONANCE_ALIASES } from '@acm/shared';
import { FallbackVoiceInput } from '../voice/recognizer';
import { RELAY_URL, roomFromUrl } from './relay';

// 等待模式手機手把：搖桿＋三顆招式鈕＋共鳴＋（選用）語音喊招。
// 手機不跑模擬，只送輸入；大螢幕（arena.ts）每 200ms 回傳血量與冷卻。

const IMG: Record<ClassId, string> = {
  pyro: new URL('../assets/pyro.png', import.meta.url).href,
  cryo: new URL('../assets/cryo.png', import.meta.url).href,
  storm: new URL('../assets/storm.png', import.meta.url).href,
  warden: new URL('../assets/warden.png', import.meta.url).href,
};
const BLURB: Record<ClassId, string> = {
  pyro: '先詠唱集氣，再放爆裂魔法',
  cryo: '冰柱遠攻、絕對零度凍住一圈',
  storm: '超電磁砲直線貫穿、落雷連鎖',
  warden: '聖光打周圍，幫隊友補血加盾',
};

const $ = (id: string) => document.getElementById(id)!;
const room = roomFromUrl(new URLSearchParams(location.search));
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let cls: ClassId = (store.get('acm-arena-cls') as ClassId) in CLASSES ? (store.get('acm-arena-cls') as ClassId) : 'pyro';
let myId = '';
let joined = false;
let ws: WebSocket | null = null;
let hostUp = false;
// 這支手機的身分：切 App、鎖螢幕斷線後帶著它重連，大螢幕就接回同一個角色
// 存在 sessionStorage：同一個分頁重新整理、切 App 都沿用；開第二個分頁就是另一支手把，不會互踢
const padKey = (() => {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');
  try {
    const k = sessionStorage.getItem('acm-arena-key') ?? make();
    sessionStorage.setItem('acm-arena-key', k);
    return k;
  } catch { return make(); }
})();
let replaced = false;
let reconnectTimer = 0;
let offlineTimer = 0;

($('name') as HTMLInputElement).value = store.get('acm-arena-name') ?? '';

// --- 選職業 ----------------------------------------------------------------
$('classes').innerHTML = (Object.keys(CLASSES) as ClassId[]).map((c) => `
  <button class="cls" data-c="${c}"><img src="${IMG[c]}" alt=""><b>${CLASSES[c].displayName}</b>
  <small>${CLASSES[c].spells.map((s) => SPELLS[s].displayName).join('・')}</small><small>${BLURB[c]}</small></button>`).join('');
const markClass = () => document.querySelectorAll<HTMLElement>('.cls').forEach((el) => el.classList.toggle('on', el.dataset.c === cls));
markClass();
$('classes').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.cls');
  if (b) { cls = b.dataset.c as ClassId; markClass(); }
});

// --- 連線 ------------------------------------------------------------------
function connect(): void {
  if (!room) { $('status0').textContent = '網址少了房間代碼，請重新掃大螢幕上的 QR Code'; return; }
  clearTimeout(reconnectTimer);
  if (replaced) return;
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  ws = new WebSocket(`${RELAY_URL}/room/${room}/pad?k=${padKey}`);
  const me = ws;
  ws.onmessage = (ev) => {
    let m: any;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'you') {
      myId = m.id; hostUp = !!m.host;
      clearTimeout(offlineTimer);
      if (joined) showMsg('');
      $('status0').textContent = hostUp ? `已連上房間 ${room}` : `已連上房間 ${room}，等大螢幕開啟`;
      if (joined) sendJoin(); // 斷線重連：用新 id 重新報到
    } else if (m.t === 'host') {
      hostUp = m.up;
      if (m.up && joined) sendJoin(); // 大螢幕重新整理後要重新報到
      showMsg(m.up ? '' : '大螢幕暫時離線，稍等一下');
    } else if (m.t === 'st') {
      onState(m);
    }
  };
  ws.onclose = (ev) => {
    if (ws !== me) return;
    ws = null;
    if (ev.reason === 'replaced') {
      // 同一支手把在別處又連上了（例如同一分頁的新連線）：這條不要再搶回來
      replaced = true;
      showMsg('這支手把在別的地方開著，請用那一個');
      return;
    }
    // 重連通常一秒內就好，超過 4 秒才提示，切回來的時候不會先看到一句「中斷」
    clearTimeout(offlineTimer);
    offlineTimer = window.setTimeout(() => {
      $('status0').textContent = '重新連線中…';
      if (joined && !document.hidden) showMsg('重新連線中…');
    }, 4000);
    reconnectTimer = window.setTimeout(connect, 1000);
  };
}
// 從別的 App 切回來時馬上重連，不等計時器
document.addEventListener('visibilitychange', () => { if (!document.hidden) connect(); });
window.addEventListener('pageshow', () => connect());
const send = (o: object) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
function sendJoin(): void { send({ t: 'join', name: ($('name') as HTMLInputElement).value, cls }); }
connect();

$('go').addEventListener('click', () => {
  const name = ($('name') as HTMLInputElement).value.trim();
  store.set('acm-arena-name', name);
  store.set('acm-arena-cls', cls);
  joined = true;
  sendJoin();
  enterPad();
  // Android 會收掉網址列；iPhone Safari 不支援，維持原樣
  void document.documentElement.requestFullscreen?.().catch(() => {});
});
$('change').addEventListener('click', () => {
  voice?.stop(); micOn = false; renderMic();
  $('pad').style.display = 'none';
  $('setup').style.display = '';
  document.body.classList.remove('playing');
});

// --- 手把 ------------------------------------------------------------------
let voice: FallbackVoiceInput | null = null;
let micOn = false;
function enterPad(): void {
  $('setup').style.display = 'none';
  $('pad').style.display = 'grid';
  document.body.classList.add('playing');
  ($('me') as HTMLImageElement).src = IMG[cls];
  $('who').textContent = ($('name') as HTMLInputElement).value.trim() || '勇者';
  $('spells').innerHTML = CLASSES[cls].spells.map((s) => `<button class="sp" data-s="${s}">${SPELLS[s].displayName}<small>喊「${shoutHint(s)}」</small></button>`).join('')
    + '<button id="res">共鳴（兩人以上一起按或一起喊「共鳴」：全隊加盾回血）</button>';
  voice?.stop();
  voice = null;
  micOn = false;
  renderMic();
  void keepAwake();
  if (!store.get('acm-arena-tip')) { showTip(true); store.set('acm-arena-tip', '1'); }
}
function showTip(on: boolean): void { $('tip').style.display = on ? 'grid' : 'none'; }
$('help').addEventListener('click', () => showTip(true));
$('tipok').addEventListener('click', () => showTip(false));

$('spells').addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'res') { send({ t: 'res' }); buzz(); return; }
  const b = t.closest<HTMLElement>('.sp');
  if (b) { send({ t: 'cast', s: b.dataset.s }); buzz(); }
});

// 搖桿：按下的位置就是中心，拖多遠就多快
const stick = $('stick');
const knob = stick.querySelector<HTMLElement>('.knob')!;
const base = stick.querySelector<HTMLElement>('.base')!;
let stickId: number | null = null;
let origin = { x: 0, y: 0 };
let move = { x: 0, y: 0 };
let lastSent = '';
const R = 60;
stick.addEventListener('pointerdown', (e) => {
  stickId = e.pointerId;
  stick.setPointerCapture(e.pointerId);
  const r = stick.getBoundingClientRect();
  origin = { x: e.clientX - r.left, y: e.clientY - r.top };
  for (const el of [base, knob]) { el.style.left = `${origin.x}px`; el.style.top = `${origin.y}px`; }
});
stick.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stickId) return;
  const r = stick.getBoundingClientRect();
  let dx = e.clientX - r.left - origin.x, dy = e.clientY - r.top - origin.y;
  const l = Math.hypot(dx, dy);
  if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
  knob.style.left = `${origin.x + dx}px`; knob.style.top = `${origin.y + dy}px`;
  move = l < 8 ? { x: 0, y: 0 } : { x: dx / R, y: dy / R };
});
const release = (e: PointerEvent) => {
  if (e.pointerId !== stickId) return;
  stickId = null;
  move = { x: 0, y: 0 };
  for (const el of [base, knob]) { el.style.left = '50%'; el.style.top = '50%'; }
};
stick.addEventListener('pointerup', release);
stick.addEventListener('pointercancel', release);
// 15Hz 送搖桿；沒變就每秒補一次，避免大螢幕那邊漏掉放開
let idle = 0;
setInterval(() => {
  if (!joined) return;
  const key = `${move.x.toFixed(2)},${move.y.toFixed(2)}`;
  if (key !== lastSent || ++idle >= 15) {
    send({ t: 'in', mx: +move.x.toFixed(2), my: +move.y.toFixed(2) });
    lastSent = key; idle = 0;
  }
}, 66);

// --- 語音 ------------------------------------------------------------------
$('mic').addEventListener('click', () => {
  if (!voice) {
    voice = new FallbackVoiceInput('zh-TW', CLASSES[cls].spells.map((s) => SPELLS[s].displayName).join(','));
    const allowed = classSpellSet(cls);
    voice.onTranscript((text) => {
      if (matchesAny(text, RESONANCE_ALIASES)) { send({ t: 'res' }); heard(text, '共鳴'); return; }
      const s: SpellId | null = matchSpell(text, { allowed });
      heard(text, s ? SPELLS[s].displayName : null);
      if (s) { send({ t: 'cast', s }); buzz(); }
    });
    voice.onStatusChange((s, message) => {
      if (s === 'error' || s === 'unsupported') $('heard').textContent = message ?? '這個瀏覽器不能用語音，請用按鈕';
    });
  }
  micOn = !micOn;
  if (micOn) voice.start(); else voice.stop();
  renderMic();
});
// 按鈕下面那行「喊什麼」：招式名，再加一個比較短的別名（兩個字以上、中文、不是誤聽字）
function shoutHint(s: SpellId): string {
  const name = SPELLS[s].displayName;
  const alt = SPELLS[s].aliases.find((a) => a !== name && a.length >= 2 && a.length < name.length && /^[\u4e00-\u9fff]+$/.test(a) && name.includes(a.slice(0, 1))
    && !(name.startsWith(a) && name.length - a.length === 1)); // 「絕對零」這種只少一個字的不列
  return alt ? `${name}」或「${alt}` : name;
}
function renderMic(): void {
  $('mic').classList.toggle('on', micOn);
  $('mic').textContent = micOn ? '聽你喊…' : '麥克風';
  if (joined) $('heard').textContent = micOn ? '對手機喊按鈕下面的字，說在句子裡也可以' : '';
}
let heardTimer = 0;
function heard(text: string, spell: string | null): void {
  $('heard').textContent = spell ? `「${text}」→ ${spell}` : `「${text}」沒對到招式`;
  clearTimeout(heardTimer);
  heardTimer = window.setTimeout(() => { $('heard').textContent = ''; }, 2500);
}

// --- 大螢幕回傳的狀態 --------------------------------------------------------
function onState(m: { p: Record<string, [number, number, number, Record<string, number>, number, number]>; over?: boolean }): void {
  if (!joined) return;
  const me = m.p[myId];
  if (!me) { showMsg(hostUp ? '報到中…' : '等大螢幕開啟'); return; }
  const [hp, max, state, cd, kills, charge] = me;
  const rank = 1 + Object.values(m.p).filter((o) => (o[4] ?? 0) > (kills ?? 0)).length;
  $('kills').textContent = kills ? `擊倒 ${kills}・第 ${rank} 名` : '';
  ($('hp').firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(100, (hp / max) * 100))}%`;
  showMsg(m.over ? '全員倒下，從這一關重來' : state === 2 ? '倒下了！隊友靠近可以救你' : state === 0 ? '下一波會復活' : '');
  document.querySelectorAll<HTMLElement>('.sp').forEach((b) => {
    const left = cd[b.dataset.s!];
    let c = b.querySelector<HTMLElement>('.cd');
    if (left && left > 0.05) {
      if (!c) { c = document.createElement('span'); c.className = 'cd'; b.appendChild(c); }
      c.textContent = left >= 1 ? String(Math.ceil(left)) : left.toFixed(1);
    } else c?.remove();
    // 爆裂魔法要先集氣：沒集氣時按鈕變暗並說明，有集氣時顯示層數
    if (b.dataset.s === 'firestorm') {
      b.classList.toggle('need', !charge);
      let t = b.querySelector<HTMLElement>('.charge');
      if (!t) { t = document.createElement('em'); t.className = 'charge'; b.appendChild(t); }
      t.textContent = charge ? `×${charge}` : '先按黑暗或深淵集氣';
    }
  });
}

function showMsg(text: string): void {
  const el = $('msg');
  el.textContent = text;
  el.style.display = text && joined ? 'block' : 'none';
}
function buzz(): void { try { navigator.vibrate?.(15); } catch { /* ignore */ } }
async function keepAwake(): Promise<void> {
  try { await (navigator as any).wakeLock?.request('screen'); } catch { /* not supported */ }
}
