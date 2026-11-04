import { World, Player, Enemy, Vec2, SpellId, ClassId, CONFIG, CLASSES } from '@acm/shared';

// 格莉奇：等待模式裡幫大家打怪的 AI 隊友。每一格看場上狀況，決定往哪走、面向哪、放什麼招。
// 規則刻意簡單（不讀未來、不預判彈道）：
//   1. 有隊友倒下、附近沒有怪貼著 → 走過去站在旁邊（遊戲規則：靠近待 3 秒就救起來）
//   2. 否則找最近的怪，保持在「最佳距離」邊打邊退，不衝進怪群；離場地邊緣太近就往中間拉
//   3. 冷卻好了就放招，各職業有自己的放法（見 pickCasts）
// ponytail: 只看最近的怪與周圍數量，不做路徑規劃；被包圍時往怪最少的方向退。

export const NPC_ID = 'npc-glitch';
export const NPC_NAME = '格莉奇';

export interface NpcIntent { move: Vec2; face: number; casts: SpellId[] }

// 跟最近那隻怪保持的距離：守護者的聖光只打身邊 120，要貼近；電擊使射程最遠，站最後面
const PREFERRED: Record<ClassId, number> = { pyro: 240, cryo: 220, storm: 300, warden: 80 };
const TOO_CLOSE: Record<ClassId, number> = { pyro: 140, cryo: 130, storm: 170, warden: 40 };
const EDGE = 120;

export function npcThink(w: World, me: Player): NpcIntent {
  const idle: NpcIntent = { move: { x: 0, y: 0 }, face: me.facing, casts: [] };
  if (!me.alive || me.downed) return idle;

  const enemies = w.enemies.filter((e) => e.hp > 0);
  const nearest = closest(me.pos, enemies);
  const dN = nearest ? dist(me.pos, nearest.pos) : Infinity;
  const near = (r: number) => enemies.filter((e) => dist(me.pos, e.pos) <= r + e.radius).length;

  let move: Vec2 = { x: 0, y: 0 };
  let face = me.facing;

  // 1. 救人
  const downed = w.players.filter((p) => p.id !== me.id && p.downed && p.connected);
  const rescue = closest(me.pos, downed);
  const pref = PREFERRED[me.classId], tooClose = TOO_CLOSE[me.classId];
  if (rescue && (dN > 140 || near(140) <= 1)) {
    const d = dist(me.pos, rescue.pos);
    if (d > CONFIG.revive.radius * 0.6) move = norm(sub(rescue.pos, me.pos));
  } else if (nearest) {
    // 2. 風箏：太遠就靠近、太近就後退，中間距離繞圈（側移）讓怪追不上
    const to = norm(sub(nearest.pos, me.pos));
    if (dN > pref + 60) move = to;
    else if (dN < tooClose) move = awayFromCrowd(me.pos, enemies);
    else move = { x: -to.y, y: to.x }; // 側移
  } else {
    // 沒怪：慢慢回到場地中央附近
    const c = { x: CONFIG.arenaWidth / 2, y: CONFIG.arenaHeight / 2 };
    if (dist(me.pos, c) > 160) move = scale(norm(sub(c, me.pos)), 0.5);
  }
  move = keepInArena(me.pos, move);
  if (nearest) face = Math.atan2(nearest.pos.y - me.pos.y, nearest.pos.x - me.pos.x);

  return { move, face, casts: pickCasts(w, me, nearest, dN, near) };
}

function pickCasts(w: World, me: Player, nearest: Enemy | null, dN: number, near: (r: number) => number): SpellId[] {
  const ready = (s: SpellId) => w.time >= me.cooldowns[s] && CLASSES[me.classId].spells.includes(s);
  const out: SpellId[] = [];
  const try_ = (s: SpellId, ok: boolean) => { if (ok && ready(s) && out.length === 0) out.push(s); };
  const allies = w.players.filter((p) => p.connected && p.alive && !p.downed);
  const hurtNear = allies.filter((p) => p.hp < p.maxHp * 0.6 && dist(p.pos, me.pos) <= CONFIG.heal.radius).length;

  switch (me.classId) {
    case 'pyro': {
      // 集到 3 層、或怪已經貼近，就放爆裂魔法；其餘時間輪流詠唱集氣
      const charge = me.pyroCharge ?? 0;
      try_('firestorm', !!nearest && charge >= 1 && (charge >= 3 || dN < 220) && dN < 420);
      try_(charge % 2 === 0 ? 'chant1' : 'chant2', charge < 5);
      break;
    }
    case 'cryo':
      try_('frostnova', near(CONFIG.frostnova.radius) >= 2);
      try_('mend', me.hp < me.maxHp * 0.5);
      try_('frost', !!nearest && dN < 420);
      break;
    case 'storm':
      try_('repulse', near(CONFIG.repulse.radius) >= 2);
      try_('chain', !!nearest && dN < CONFIG.chain.range);
      try_('thunder', !!nearest && dN < 900);
      break;
    case 'warden':
      try_('heal', hurtNear >= 1);
      try_('aegis', near(260) >= 4 || allies.some((p) => p.hp < p.maxHp * 0.35));
      try_('holybolt', near(CONFIG.holybolt.radius) >= 1);
      break;
  }
  return out;
}

// --- 小工具 ---------------------------------------------------------------
function dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
function scale(a: Vec2, k: number): Vec2 { return { x: a.x * k, y: a.y * k }; }
function norm(a: Vec2): Vec2 { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; }
function closest<T extends { pos: Vec2 }>(p: Vec2, xs: T[]): T | null {
  let best: T | null = null, bd = Infinity;
  for (const x of xs) { const d = dist(p, x.pos); if (d < bd) { bd = d; best = x; } }
  return best;
}
// 往怪最少的方向退：把附近每隻怪的推力加總（越近推越大）
function awayFromCrowd(p: Vec2, enemies: Enemy[]): Vec2 {
  let x = 0, y = 0;
  for (const e of enemies) {
    const d = dist(p, e.pos);
    if (d > 320 || d === 0) continue;
    x += (p.x - e.pos.x) / (d * d); y += (p.y - e.pos.y) / (d * d);
  }
  return x === 0 && y === 0 ? { x: 0, y: 0 } : norm({ x, y });
}
// 靠近場地邊緣時把移動往中間拉，避免被逼進角落
function keepInArena(p: Vec2, m: Vec2): Vec2 {
  const W = CONFIG.arenaWidth, H = CONFIG.arenaHeight;
  let { x, y } = m;
  if (p.x < EDGE) x = Math.max(x, 0.7); else if (p.x > W - EDGE) x = Math.min(x, -0.7);
  if (p.y < EDGE) y = Math.max(y, 0.7); else if (p.y > H - EDGE) y = Math.min(y, -0.7);
  return x === 0 && y === 0 ? { x, y } : norm({ x, y });
}
