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
} from '@acm/shared';
import { GameSession } from '../session/GameSession';

// 等待模式（直播倒數）的 session：主畫面自己跑模擬，玩家是手機手把。
// 跟 LocalSession 一樣在本機 step，差別是玩家隨時加入、離開，而且沒有「自己」：
// getSelfId() 回傳空字串，GameScene 的 overview 模式會把整個場地縮放進畫面。
//
// 這個模式沒有輸贏：全滅就幾秒後原地重開（玩家留著），破關就直接進無盡。
// ponytail: 玩家上限只靠 relay 的 MAX_PADS 擋；模擬本身沒有人數上限。

interface Pad {
  move: Vec2;
  face: number;
  casts: SpellId[];
  resonance: boolean;
}

const RESTART_AFTER_WIPE_SEC = 4;
const NAME_MAX = 8;

export class PartySession implements GameSession {
  private world: World = createWorld([]);
  private pads = new Map<string, Pad>();
  private worldCb: (w: World) => void = () => {};
  private wipedFor = 0;

  constructor(private rng: () => number = Math.random) {}

  // --- 手把進出 -----------------------------------------------------------

  join(id: string, rawName: string, classId: ClassId): void {
    const name = cleanName(rawName);
    const cls = CLASSES[classId] ? classId : 'pyro';
    const existing = this.world.players.find((p) => p.id === id);
    if (existing) {
      // 同一支手機換職業：重建這個角色（位置保留）
      const pos = existing.pos;
      this.world.players = this.world.players.filter((p) => p.id !== id);
      this.addPlayer(id, name, cls, pos);
      return;
    }
    this.addPlayer(id, name, cls);
    this.pads.set(id, { move: { x: 0, y: 0 }, face: 0, casts: [], resonance: false });
  }

  leave(id: string): void {
    this.pads.delete(id);
    this.world.players = this.world.players.filter((p) => p.id !== id);
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
    const commands: Command[] = [];
    for (const [id, pad] of this.pads) {
      commands.push({ kind: 'face', playerId: id, angle: pad.face });
      commands.push({ kind: 'move', playerId: id, dir: pad.move });
      for (const spell of pad.casts) commands.push({ kind: 'cast', playerId: id, spell });
      pad.casts = [];
      if (pad.resonance) { commands.push({ kind: 'resonance', playerId: id }); pad.resonance = false; }
    }
    step(w, commands, dt, this.rng);
    this.worldCb(w);
  }

  restart(): void { this.restartKeepingPlayers(); }
  enterEndless(): void { enterEndlessMode(this.world); }
  endEndless(): void {}
  skipToLobby(): void {}

  private restartKeepingPlayers(): void {
    const seeds = this.world.players.map((p) => ({ id: p.id, name: p.name, classId: p.classId }));
    this.world = createWorld(seeds);
    this.wipedFor = 0;
    this.worldCb(this.world);
  }
}

export function cleanName(raw: string): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim();
  return Array.from(s).slice(0, NAME_MAX).join('') || '勇者';
}
