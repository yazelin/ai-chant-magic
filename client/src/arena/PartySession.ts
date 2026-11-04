import {
  Vec2,
  World,
  Command,
  SpellId,
  ClassId,
  CLASSES,
  createWorld,
  step,
  enterEndlessMode,
  MAX_LEVEL_ID,
  CONFIG,
} from '@acm/shared';
import { GameSession } from '../session/GameSession';
import { npcThink, NPC_ID, NPC_NAME } from './npc';

// 等待模式（直播倒數）的 session：主畫面自己跑模擬，玩家是手機手把。
// 跟 LocalSession 一樣在本機 step，差別是玩家隨時加入、離開，而且沒有「自己」：
// getSelfId() 回傳空字串，GameScene 的 overview 模式會把整個場地縮放進畫面。
//
// 這個模式沒有輸贏：全滅就幾秒後從同一關的開頭重來（玩家與擊倒數留著），破關就直接進無盡。
// 無盡模式全滅則回到最後一關。
// ponytail: 玩家上限只靠 relay 的 MAX_PADS 擋；模擬本身沒有人數上限。

interface Pad {
  move: Vec2;
  face: number;
  casts: SpellId[];
  resonance: boolean;
}

const RESTART_AFTER_WIPE_SEC = 4;
const SPAWN_WINDOW_SEC = 30;
// 手機切到別的 App、鎖螢幕時連線會斷；角色留在場上（不被追、不算人數）等它回來
const AWAY_GRACE_SEC = 90;
// 原本死掉要等「下一波開始」才復活；魔王波打不完就不會有下一波，人會一直躺著（作者實測格莉奇卡在 0 血）。
// 等待模式改成死掉 RESPAWN_SEC 秒後原地附近復活，滿血。倒地 8 秒內隊友救人的規則不變。
const RESPAWN_SEC = 8;
const NAME_MAX = 8;

// 每個職業的大招：放出來時主畫面打一條條幅，寫是誰放的
export const ULTIMATES: Partial<Record<SpellId, true>> = { firestorm: true, frostnova: true, thunder: true, aegis: true };
export interface UltEvent { playerId: string; name: string; classId: ClassId; spell: SpellId; charge: number }

export class PartySession implements GameSession {
  private world: World = createWorld([]);
  private pads = new Map<string, Pad>();
  private worldCb: (w: World) => void = () => {};
  private wipedFor = 0;
  // 今晚最遠：關卡*100+波數，無盡另計（無盡一律比關卡遠）
  private best = { rank: 0, label: '' };
  wipes = 0;
  private pacedWave = -1;
  private awaySince = new Map<string, number>(); // id → 已離線秒數
  private deadFor = new Map<string, number>(); // id → 已死亡秒數
  onUlt: (e: UltEvent) => void = () => {};

  constructor(private rng: () => number = Math.random) {}

  // --- 手把進出 -----------------------------------------------------------

  join(id: string, rawName: string, classId: ClassId): void {
    const name = cleanName(rawName);
    const cls = CLASSES[classId] ? classId : 'pyro';
    const existing = this.world.players.find((p) => p.id === id);
    this.awaySince.delete(id);
    if (!this.pads.has(id)) this.pads.set(id, { move: { x: 0, y: 0 }, face: 0, casts: [], resonance: false });
    if (existing && existing.classId === cls) {
      // 斷線回來或重新報到：接回原本的角色
      existing.connected = true;
      existing.name = name;
      return;
    }
    if (existing) {
      // 同一支手機換職業：重建這個角色（位置保留）
      const { pos, kills } = existing;
      this.world.players = this.world.players.filter((p) => p.id !== id);
      this.addPlayer(id, name, cls, pos);
      this.world.players[this.world.players.length - 1].kills = kills;
      return;
    }
    this.addPlayer(id, name, cls);
  }

  // 連線斷了：先把角色標成離線，AWAY_GRACE_SEC 內回來就接回去
  away(id: string): void {
    const p = this.world.players.find((pl) => pl.id === id);
    if (!p) return;
    p.connected = false;
    const pad = this.pads.get(id);
    if (pad) pad.move = { x: 0, y: 0 };
    this.awaySince.set(id, 0);
  }

  leave(id: string): void {
    this.pads.delete(id);
    this.awaySince.delete(id);
    this.world.players = this.world.players.filter((p) => p.id !== id);
  }

  connectedCount(): number {
    return this.world.players.filter((p) => p.connected).length;
  }

  input(id: string, move: Vec2, face: number | undefined): void {
    const pad = this.pads.get(id);
    if (!pad) return;
    const l = Math.hypot(move.x, move.y);
    pad.move = l > 1 ? { x: move.x / l, y: move.y / l } : move;
    if (face !== undefined && Number.isFinite(face)) pad.face = face;
    else if (l > 0.2) pad.face = Math.atan2(move.y, move.x);
  }

  cast(id: string, spell: SpellId): void {
    const pad = this.pads.get(id);
    const pl = this.world.players.find((p) => p.id === id);
    if (!pad || !pl) return;
    if (!CLASSES[pl.classId].spells.includes(spell)) return;
    if (pad.casts.length < 4) pad.casts.push(spell);
  }

  resonate(id: string): void {
    const pad = this.pads.get(id);
    if (pad) pad.resonance = true;
    // 共鳴要兩個人在 1.5 秒內一起喊；格莉奇聽到有人喊就跟著喊，只有你跟她兩個也放得出來
    const npc = this.pads.get(NPC_ID);
    if (npc && id !== NPC_ID) npc.resonance = true;
  }

  // 格莉奇（AI 隊友）：null 是關掉，給職業就上場或換職業。擊倒數換職業時保留。
  setNpc(classId: ClassId | null): void {
    if (classId === null) { this.leave(NPC_ID); return; }
    this.join(NPC_ID, NPC_NAME, classId);
  }

  npcClass(): ClassId | null {
    return this.world.players.find((p) => p.id === NPC_ID)?.classId ?? null;
  }

  playerCount(): number {
    return this.world.players.length;
  }

  private addPlayer(id: string, name: string, classId: ClassId, pos?: Vec2): void {
    const p = createWorld([{ id, name, classId }]).players[0];
    p.pos = pos ?? this.freeSpot();
    // 中途加入的人等下一波才上場的規則不適用這裡：一掃碼就要看到自己
    this.world.players.push(p);
  }

  private freeSpot(): Vec2 {
    const cx = 960, cy = 540;
    const a = this.rng() * Math.PI * 2;
    const r = 80 + this.rng() * 220;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }

  // --- GameSession --------------------------------------------------------

  start(): void { this.worldCb(this.world); }
  sendMove(): void {}
  sendFace(): void {}
  sendCast(): void {}
  sendResonance(): void {}
  getWorld(): World { return this.world; }
  getSelfId(): string { return ''; }
  onWorld(cb: (w: World) => void): void { this.worldCb = cb; }

  tick(dt: number): void {
    const w = this.world;
    // 離線秒數自己累計（不用 world.time：全滅重開會把世界時間歸零）
    for (const [id, sec] of this.awaySince) {
      if (sec + dt > AWAY_GRACE_SEC) this.leave(id);
      else this.awaySince.set(id, sec + dt);
    }
    if (w.players.length === 0) {
      // 沒人時不跑模擬（0 人會被判定全滅），場地保持乾淨
      w.enemies = []; w.projectiles = []; w.effects = [];
      this.worldCb(w);
      return;
    }
    if (w.status === 'victory') enterEndlessMode(w);
    if (w.status === 'gameover') {
      this.wipedFor += dt;
      if (this.wipedFor >= RESTART_AFTER_WIPE_SEC) this.restartKeepingPlayers();
      this.worldCb(w);
      return;
    }
    const npc = w.players.find((p) => p.id === NPC_ID);
    const npcPad = this.pads.get(NPC_ID);
    if (npc && npcPad) {
      const it = npcThink(w, npc);
      npcPad.move = it.move;
      npcPad.face = it.face;
      npcPad.casts = it.casts;
      // resonance 由 resonate() 設定，這裡不覆蓋
    }
    const commands: Command[] = [];
    // 記下這一格要放的大招與放之前的冷卻、集氣，step 之後冷卻被設下去才算真的放出來
    const ultTries: { id: string; spell: SpellId; cdBefore: number; charge: number }[] = [];
    for (const [id, pad] of this.pads) {
      const pl = w.players.find((p) => p.id === id);
      if (pl) for (const spell of pad.casts) if (ULTIMATES[spell]) ultTries.push({ id, spell, cdBefore: pl.cooldowns[spell], charge: pl.pyroCharge ?? 0 });
      commands.push({ kind: 'face', playerId: id, angle: pad.face });
      commands.push({ kind: 'move', playerId: id, dir: pad.move });
      for (const spell of pad.casts) commands.push({ kind: 'cast', playerId: id, spell });
      pad.casts = [];
      if (pad.resonance) { commands.push({ kind: 'resonance', playerId: id }); pad.resonance = false; }
    }
    step(w, commands, dt, this.rng);
    this.respawnDead(dt);
    for (const t of ultTries) {
      const pl = w.players.find((p) => p.id === t.id);
      if (pl && pl.cooldowns[t.spell] > t.cdBefore) this.onUlt({ playerId: pl.id, name: pl.name, classId: pl.classId, spell: t.spell, charge: t.charge });
    }
    this.paceWave();
    this.trackBest();
    this.worldCb(w);
  }

  bestLabel(): string { return this.best.label; }

  private respawnDead(dt: number): void {
    const w = this.world;
    if (w.status !== 'playing') return;
    for (const p of w.players) {
      if (p.alive) { this.deadFor.delete(p.id); continue; }
      const t = (this.deadFor.get(p.id) ?? 0) + dt;
      if (t < RESPAWN_SEC) { this.deadFor.set(p.id, t); continue; }
      this.deadFor.delete(p.id);
      p.alive = true;
      p.downed = false;
      p.hp = p.maxHp;
      p.reviveProgress = 0;
      p.bleedoutAt = 0;
      p.respawnAtWave = 0;
      p.pos = this.freeSpot();
    }
  }

  // 原本的出怪量是人數的 1.4 次方（為 4 人房調的）：20 人第 1 波約 400 隻、
  // 每 1.2 秒才出一隻，一波要打好幾分鐘。等待模式改成跟人數線性成長，
  // 出怪速度跟著加快，讓每一波大約 SPAWN_WINDOW_SEC 秒出完。
  private paceWave(): void {
    const w = this.world;
    if (w.wave === this.pacedWave || w.spawnQueue === 0) return;
    this.pacedWave = w.wave;
    const n = Math.max(1, w.players.filter((p) => p.alive || p.downed).length);
    const ratio = Math.min(1, (1.5 + n * 0.6) / Math.pow(n, CONFIG.wave.scaleExp));
    w.spawnQueue = Math.max(1, Math.round(w.spawnQueue * ratio));
    w.spawnCadence = Math.max(0.12, Math.min(w.spawnCadence, SPAWN_WINDOW_SEC / w.spawnQueue));
    w.spawnTimer = Math.min(w.spawnTimer, w.spawnCadence);
  }

  static stageLabel(w: World): string {
    const wave = Math.max(1, w.wave);
    return w.endless ? `無盡第 ${wave} 波` : `第 ${w.levelId + 1} 關第 ${wave} 波`;
  }

  private trackBest(): void {
    const w = this.world;
    const rank = (w.endless ? 10000 : w.levelId * 100) + w.wave;
    if (rank > this.best.rank) this.best = { rank, label: PartySession.stageLabel(w) };
  }

  restart(): void { this.restartKeepingPlayers(); }

  // 直播前清掉測試時的紀錄：人留著，擊倒數、今晚最遠、關卡、反應次數全部歸零，回第 1 關第 1 波
  resetAll(): void {
    const seeds = this.world.players.map((p) => ({ id: p.id, name: p.name, classId: p.classId }));
    const connected = new Map(this.world.players.map((p) => [p.id, p.connected]));
    this.world = createWorld(seeds);
    for (const p of this.world.players) p.connected = connected.get(p.id) ?? true;
    this.best = { rank: 0, label: '' };
    this.wipes = 0;
    this.wipedFor = 0;
    this.pacedWave = -1;
    this.deadFor.clear();
    this.worldCb(this.world);
  }
  enterEndless(): void { enterEndlessMode(this.world); }
  endEndless(): void {}
  skipToLobby(): void {}

  private restartKeepingPlayers(): void {
    const old = this.world;
    const seeds = old.players.map((p) => ({ id: p.id, name: p.name, classId: p.classId }));
    const prev = new Map(old.players.map((p) => [p.id, p]));
    this.world = createWorld(seeds);
    for (const p of this.world.players) { p.kills = prev.get(p.id)?.kills ?? 0; p.connected = prev.get(p.id)?.connected ?? true; }
    // 從同一關的開頭重來；無盡模式全滅就回到最後一關
    this.world.levelId = old.endless ? MAX_LEVEL_ID : old.levelId;
    this.world.score = old.score;
    this.wipedFor = 0;
    this.wipes += 1;
    this.pacedWave = -1;
    this.worldCb(this.world);
  }
}

export function cleanName(raw: string): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim();
  return Array.from(s).slice(0, NAME_MAX).join('') || '勇者';
}
