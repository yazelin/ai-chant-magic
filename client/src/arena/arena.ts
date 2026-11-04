import Phaser from 'phaser';
import { ClassId, SpellId, Vec2, SPELLS, CLASSES } from '@acm/shared';
import { GameScene } from '../render/GameScene';
import { initAudio, getMaster } from '../audio/sfx';
import { MusicEngine } from '../audio/music';
import { TrackMusic } from './bgm';
import { PartySession, UltEvent } from './PartySession';
import { NPC_ID } from './npc';
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
// 驗收截圖用：?debug=1 才把 session 掛到 window
if (params.get('debug') === '1') (window as unknown as { __arena: PartySession }).__arena = session;
// 格莉奇（AI 隊友）：?npc=pyro|cryo|storm|warden 開頁面就上場；G 開關、1～4 換職業
const NPC_CLASSES: ClassId[] = ['pyro', 'cryo', 'storm', 'warden'];
let npcPick: ClassId = (NPC_CLASSES as string[]).includes(params.get('npc') ?? '') ? (params.get('npc') as ClassId) : 'warden';
if (params.get('npc')) session.setNpc(npcPick);

// --- 大招條幅：誰放了什麼大招。人多時排隊，一次一條，最多排 3 條 ------------
const ultQueue: UltEvent[] = [];
let ultShowing = false;
for (const sp of ['firestorm', 'frostnova', 'thunder', 'aegis']) new Image().src = `${import.meta.env.BASE_URL}arena/art/ult-${sp}.jpg`;
for (const c of ['pyro', 'cryo', 'storm', 'warden']) new Image().src = `${import.meta.env.BASE_URL}arena/art/por-${c}.webp`; // 條幅插畫與角色立繪先載好，條幅出現時不會空一下
session.onUlt = (e) => {
  if (ultQueue.length < 3) ultQueue.push(e);
  if (!ultShowing) nextUlt();
};
function nextUlt(): void {
  const e = ultQueue.shift();
  if (!e) { ultShowing = false; return; }
  ultShowing = true;
  const el = $('ult');
  el.style.setProperty('--c', CLASSES[e.classId].color);
  el.style.setProperty('--art', `url(${import.meta.env.BASE_URL}arena/art/ult-${e.spell}.jpg)`);
  el.classList.add('art');
  const charge = e.spell === 'firestorm' && e.charge > 1 ? `<span class="x">×${e.charge}</span>` : '';
  el.innerHTML = `<img class="por" src="${import.meta.env.BASE_URL}arena/art/por-${e.classId}.webp" alt="" onerror="this.remove()">`
    + `<div class="who">${esc(e.name)}・${CLASSES[e.classId].displayName}</div><div class="what">${SPELLS[e.spell].displayName}！${charge}</div>`;
  el.classList.remove('go');
  void el.offsetWidth; // 重新觸發動畫
  el.classList.add('go');
  window.setTimeout(nextUlt, 1250);
}
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
  ws = new WebSocket(`${RELAY_URL}/room/${room}/host?hk=${hostKey}${takeover ? '&takeover=1' : ''}`);
  takeover = false;
  ws.onopen = () => { clearTimeout(errTimer); $('err').textContent = ''; };
  ws.onmessage = (ev) => {
    let m: any;
    try { m = JSON.parse(ev.data); } catch { return; }
    switch (m.t) {
      case 'busy': stopped = true; showBusy('這個房間已經有主畫面在跑'); return;
      case 'taken': stopped = true; showBusy('別的分頁接手了這個房間'); return;
      case 'join': {
        const isNew = !session.getWorld().players.some((p) => p.id === m.id);
        session.join(m.id, String(m.name ?? ''), m.cls as ClassId);
        if (isNew) toast(`${session.getWorld().players.find((p) => p.id === m.id)?.name ?? '勇者'} 加入了`);
        break;
      }
      case 'in': session.input(m.id, vec(m.mx, m.my), typeof m.f === 'number' ? m.f : undefined); break;
      case 'cast': session.cast(m.id, m.s as SpellId); break;
      case 'res': session.resonate(m.id); break;
      case 'leave': session.away(m.id); break;
    }
  };
  ws.onclose = () => {
    if (stopped) return;
    // 短暫斷線（重連通常一秒內）不顯示，超過 4 秒才提示
    clearTimeout(errTimer);
    errTimer = window.setTimeout(() => { $('err').textContent = '連線中斷，重新連線中…'; }, 4000);
    setTimeout(connect, 1000);
  };
}
let errTimer = 0;
let stopped = false;
let takeover = false;
// 同一個分頁重新整理時沿用（sessionStorage 跟著分頁），轉發站就知道是同一個主畫面
const hostKey = (() => {
  try {
    const k = sessionStorage.getItem('acm-arena-hk') ?? Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem('acm-arena-hk', k);
    return k;
  } catch { return Math.random().toString(36).slice(2, 12); }
})();
function showBusy(text: string): void {
  const el = $('busy');
  el.querySelector('.a')!.textContent = text;
  el.style.display = 'grid';
}
$('takeover').addEventListener('click', () => {
  $('busy').style.display = 'none';
  stopped = false;
  takeover = true;
  connect();
});
connect();

// 主畫面在背景分頁時，瀏覽器會停掉 requestAnimationFrame（Phaser 跟著停）、
// 主執行緒的計時器也會被壓到一秒一次。Worker 裡的計時器不受影響，
// 所以用它當時鐘：分頁看不見時由這裡推進模擬，看得見時交回 Phaser。
// 狀態廣播也掛在這個時鐘上，背景時手機一樣收得到血量與冷卻。
const clock = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50)'], { type: 'text/javascript' })));
let lastTick = performance.now();
let lastBroadcast = 0;
clock.onmessage = () => {
  const now = performance.now();
  if (document.hidden) session.tick(Math.min((now - lastTick) / 1000, 0.1));
  lastTick = now;
  if (now - lastBroadcast >= 200) { lastBroadcast = now; broadcast(); }
};

// 每 200ms 把每個人的血量與冷卻廣播給手機（手機只挑自己那筆）
function broadcast(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const w = session.getWorld();
  const p: Record<string, [number, number, number, Record<string, number>, number, number]> = {};
  for (const pl of w.players) {
    const cd: Record<string, number> = {};
    for (const [k, v] of Object.entries(pl.cooldowns)) if (v > w.time) cd[k] = Math.round((v - w.time) * 10) / 10;
    p[pl.id] = [Math.round(pl.hp), Math.round(pl.maxHp), pl.downed ? 2 : pl.alive ? 1 : 0, cd, pl.kills ?? 0, pl.pyroCharge ?? 0];
  }
  ws.send(JSON.stringify({ t: 'st', p, wave: w.wave, n: w.players.length, over: w.status === 'gameover' }));
}

// --- 畫面上的字 ------------------------------------------------------------
setInterval(() => {
  const left = Math.max(0, target.getTime() - Date.now());
  const s = Math.floor(left / 1000);
  $('clock').textContent = left > 0
    ? (s >= 3600 ? `${Math.floor(s / 3600)}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}` : `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`)
    : '即將開始';

  const w = session.getWorld();
  const n = w.players.length;
  const npcOn = session.npcClass() !== null;
  $('n').textContent = `目前 ${session.connectedCount() - (npcOn ? 1 : 0)} 位勇者${npcOn ? '＋格莉奇' : ''}`;
  $('empty').style.display = w.players.some((p) => p.id !== NPC_ID) ? 'none' : '';
  if (!n) { $('stat').innerHTML = session.bestLabel() ? `今晚最遠　${session.bestLabel()}` : '尚無勇者'; return; }
  const top = [...w.players].sort((a, b) => (b.kills ?? 0) - (a.kills ?? 0)).slice(0, 5).filter((p) => (p.kills ?? 0) > 0);
  const num = (t: string) => t.replace(/\d+/g, '<em>$&</em>'); // 關卡與波數的數字另外上色
  $('stat').innerHTML = `<div class="stage serif">${num(PartySession.stageLabel(w))}</div>`
    + `<div>全隊擊倒 <b class="kill">${w.score}</b>　元素反應 <b class="react">${w.reactionCount}</b></div>`
    + `<div class="best">今晚最遠　${num(session.bestLabel())}</div>`
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
// BGM：咏唱魔法原本的四段自適應配樂（微焰→星火→燎原→焚天）。
// 等待模式按關卡升溫：第 1 關最平靜、無盡最激烈，魔王波再往上一階；沒人時最平靜。
const synth = new MusicEngine();
const tracks = new TrackMusic([0, 1, 2, 3].map((i) => `./arena/bgm/arena-${i}.mp3`));
let useTracks = true;
let musicOn = true;
const music = {
  start: () => { if (useTracks) void tracks.start().then((ok) => { if (!ok) { useTracks = false; synth.start(); } }); else synth.start(); },
  stop: () => { tracks.stop(); synth.stop(); },
  setIntensity: (l: number) => { tracks.setIntensity(l); synth.setIntensity(l); },
};
function musicIntensity(): number {
  const w = session.getWorld();
  if (!w.players.length || w.status === 'gameover') return 0;
  const base = w.endless ? 3 : w.levelId;
  const bossWave = !w.endless && w.wave > 0 && w.wave % 5 === 0;
  return Math.min(3, base + (bossWave ? 1 : 0));
}
setInterval(() => music.setIntensity(musicIntensity()), 500);

$('gate').addEventListener('click', () => {
  initAudio();
  const g = getMaster();
  if (g) g.gain.value = 0.5;
  music.start();
  $('gate').remove();
});
let muted = false;
let resetArmedAt = 0;
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') {
    muted = !muted;
    const g = getMaster();
    if (g) g.gain.value = muted ? 0 : 0.5;
    tracks.setMuted(muted);
    toast(muted ? '已靜音' : '音效開啟');
  } else if (e.key === 'g' || e.key === 'G') {
    const on = session.npcClass() === null;
    session.setNpc(on ? npcPick : null);
    toast(on ? `格莉奇上場（${CLASSES[npcPick].displayName}）` : '格莉奇下場');
  } else if (['1', '2', '3', '4'].includes(e.key)) {
    npcPick = NPC_CLASSES[Number(e.key) - 1];
    if (session.npcClass() !== null) session.setNpc(npcPick);
    toast(`格莉奇${session.npcClass() !== null ? '換成' : '下次上場用'}${CLASSES[npcPick].displayName}`);
  } else if (e.key === 'r' || e.key === 'R') {
    // 按兩次才重置，避免直播中誤按把大家的分數清掉
    if (performance.now() - resetArmedAt < 2000) {
      session.resetAll();
      resetArmedAt = 0;
      toast('已重置：回到第 1 關，紀錄全部歸零');
    } else {
      resetArmedAt = performance.now();
      toast('2 秒內再按一次 R 重置所有紀錄');
    }
  } else if (e.key === 'b' || e.key === 'B') {
    musicOn = !musicOn;
    if (musicOn) music.start(); else music.stop();
    toast(musicOn ? '背景音樂開啟' : '背景音樂關閉');
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
