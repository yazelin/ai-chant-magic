import Phaser from 'phaser';
import { ClassId, SpellId, Vec2 } from '@acm/shared';
import { GameScene } from '../render/GameScene';
import { initAudio, getMaster } from '../audio/sfx';
import { PartySession } from './PartySession';
import { RELAY_URL, padUrl, roomFromUrl } from './relay';

// 等待模式主畫面：直播分享這一頁。網址參數：
//   ?room=ABCD               房間代碼（沒給就隨機產一個並寫回網址，重新整理不會換）
//   ?at=2026-11-04T21:00+08:00  倒數目標時間
//   ?title=…                 倒數下方那行字

declare const qrcode: (type: number, ecl: string) => {
  addData(s: string): void; make(): void; createSvgTag(o: { cellSize: number; margin: number }): string;
};

const params = new URLSearchParams(location.search);
const room = roomFromUrl(params) ?? randomRoom();
if (params.get('room') !== room) {
  params.set('room', room);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
const target = new Date(params.get('at') ?? '2026-11-04T21:00:00+08:00');
const $ = (id: string) => document.getElementById(id)!;
$('countsub').textContent = params.get('title') ?? `${pad2(target.getHours())}:${pad2(target.getMinutes())} 開始`;

// --- QR ------------------------------------------------------------------
const joinUrl = padUrl(room);
const qr = qrcode(0, 'M');
qr.addData(joinUrl);
qr.make();
$('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0 });
$('qr').title = joinUrl;

// --- 遊戲 ------------------------------------------------------------------
const session = new PartySession();
const scene = new GameScene(session, true);
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0a0f1a',
  scale: { mode: Phaser.Scale.RESIZE },
  scene,
});

// --- 連線 ------------------------------------------------------------------
let ws: WebSocket | null = null;
function connect(): void {
  ws = new WebSocket(`${RELAY_URL}/room/${room}/host`);
  ws.onopen = () => { $('err').textContent = ''; };
  ws.onmessage = (ev) => {
    let m: any;
    try { m = JSON.parse(ev.data); } catch { return; }
    switch (m.t) {
      case 'join': {
        const isNew = !session.getWorld().players.some((p) => p.id === m.id);
        session.join(m.id, String(m.name ?? ''), m.cls as ClassId);
        if (isNew) toast(`${session.getWorld().players.find((p) => p.id === m.id)?.name ?? '勇者'} 加入了`);
        break;
      }
      case 'in': session.input(m.id, vec(m.mx, m.my), typeof m.f === 'number' ? m.f : undefined); break;
      case 'cast': session.cast(m.id, m.s as SpellId); break;
      case 'res': session.resonate(m.id); break;
      case 'leave': session.leave(m.id); break;
    }
  };
  ws.onclose = () => {
    $('err').textContent = '連線中斷，重新連線中…';
    setTimeout(connect, 1500);
  };
}
connect();

// 每 200ms 把每個人的血量與冷卻廣播給手機（手機只挑自己那筆）
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const w = session.getWorld();
  const p: Record<string, [number, number, number, Record<string, number>, number]> = {};
  for (const pl of w.players) {
    const cd: Record<string, number> = {};
    for (const [k, v] of Object.entries(pl.cooldowns)) if (v > w.time) cd[k] = Math.round((v - w.time) * 10) / 10;
    p[pl.id] = [Math.round(pl.hp), Math.round(pl.maxHp), pl.downed ? 2 : pl.alive ? 1 : 0, cd, pl.kills ?? 0];
  }
  ws.send(JSON.stringify({ t: 'st', p, wave: w.wave, n: w.players.length, over: w.status === 'gameover' }));
}, 200);

// --- 畫面上的字 ------------------------------------------------------------
setInterval(() => {
  const left = Math.max(0, target.getTime() - Date.now());
  const s = Math.floor(left / 1000);
  $('clock').textContent = left > 0
    ? (s >= 3600 ? `${Math.floor(s / 3600)}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}` : `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`)
    : '即將開始';

  const w = session.getWorld();
  const n = w.players.length;
  $('n').textContent = `目前 ${n} 位勇者`;
  $('empty').style.display = n ? 'none' : '';
  if (!n) { $('stat').innerHTML = session.bestLabel() ? `今晚最遠　${session.bestLabel()}` : '尚無勇者'; return; }
  const top = [...w.players].sort((a, b) => (b.kills ?? 0) - (a.kills ?? 0)).slice(0, 5).filter((p) => (p.kills ?? 0) > 0);
  $('stat').innerHTML = `<div class="stage serif">${PartySession.stageLabel(w)}</div>`
    + `<div>全隊擊倒 <b>${w.score}</b></div>`
    + `<div class="best">今晚最遠　${session.bestLabel()}</div>`
    + (w.status === 'gameover' ? '<div class="wipe">全員倒下，從這一關重來</div>' : '')
    + (top.length ? `<div class="k">擊倒王</div><ol>${top.map((p) => `<li><span>${esc(p.name)}</span><b>${p.kills}</b></li>`).join('')}</ol>` : '');
}, 250);

const SLIDES = [
  `<img class="cover" src="./arena/cover.jpg" alt=""><div><div class="k">今晚 21:00</div><h2>最後的聖戰</h2>
   <p>Larch 第三屆創作者挑戰「自由與限制」最佳作品，作者親自分享製作過程。</p></div>`,
  `<div><div class="k">作品簡介</div><p>聖騎士加雷斯奉神父之命，前去魔族的三大王國消滅魔王，取回神聖水晶，以喚醒信奉的光之神--路瑟耶爾。他究竟能不能完成使命呢？還是說……</p>
   <p style="margin-top:1vh;color:var(--gold)">zuihoudeshengzhan.larch.games</p></div>`,
  `<img class="avatar" src="./arena/speaker.jpg" alt=""><div><div class="k">講者</div><h2>茶葉飲料</h2>
   <p>靈感來源・審題・製作前的準備・遇到的問題・劇情改動</p></div>`,
  `<div><div class="k">等待時一起玩</div><h2>掃碼加入</h2><ol>
   <li>掃右上角的 QR Code，取名、選職業</li><li>搖桿移動，三顆按鈕放招式</li><li>打開麥克風，喊招式名也能施法</li></ol></div>`,
];
$('info').innerHTML = SLIDES.map((h) => `<div class="slide">${h}</div>`).join('');
const slides = Array.from(document.querySelectorAll<HTMLElement>('#info .slide'));
let si = 0;
const showSlide = () => { slides.forEach((el, i) => el.classList.toggle('on', i === si)); si = (si + 1) % slides.length; };
showSlide();
setInterval(showSlide, 9000);

// --- 操作 ------------------------------------------------------------------
$('gate').addEventListener('click', () => {
  initAudio();
  const g = getMaster();
  if (g) g.gain.value = 0.5;
  $('gate').remove();
});
let muted = false;
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') {
    muted = !muted;
    const g = getMaster();
    if (g) g.gain.value = muted ? 0 : 0.5;
    toast(muted ? '已靜音' : '音效開啟');
  } else if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }
});

let toastTimer = 0;
function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

function vec(x: unknown, y: unknown): Vec2 {
  const nx = Number(x), ny = Number(y);
  return { x: Number.isFinite(nx) ? Math.max(-1, Math.min(1, nx)) : 0, y: Number.isFinite(ny) ? Math.max(-1, Math.min(1, ny)) : 0 };
}
function esc(s: string): string { return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }
function pad2(n: number): string { return String(n).padStart(2, '0'); }
function randomRoom(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}
