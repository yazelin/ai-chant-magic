// Room: lobby -> playing -> gameover state machine.
//
// Task B1 implements the lobby surface (members, code, status, start) that the
// RoomRegistry composes and the pure-logic tests exercise. The authoritative
// runtime (addPlayer/applyInput/tick/snapshot, ws send fns, no-splice
// disconnect) is fleshed out in Task B2; this file is structured so that work
// extends it rather than rewrites it.

import {
  createWorld,
  step,
  type World,
  type Command,
  type ClassId,
  type SpellId,
  type Vec2,
  type PlayerSeed,
} from '@acm/shared';
import { toSnapshot, type Snapshot } from './snapshot';

export type RoomStatus = 'lobby' | 'playing' | 'gameover';

// A lobby member. `send` is the ws push channel, optional so pure tests can
// construct members without a socket. B2 wires real sockets.
export interface LobbyMember {
  id: string;
  name: string;
  classId: ClassId;
  ready: boolean;
  connected: boolean;
}

// Per-player buffered input, drained once per tick (spec §15.1):
// latest move / latest face win; ALL casts are kept.
interface BufferedInput {
  move?: Vec2;
  face?: number;
  casts: SpellId[];
}

export const MAX_PLAYERS = 4;

export class Room {
  readonly code: string;
  readonly members: LobbyMember[] = [];
  status: RoomStatus = 'lobby';
  world: World | null = null;
  tick = 0;
  hostId: string | null = null;

  private inputs = new Map<string, BufferedInput>();

  constructor(code: string, host: LobbyMember) {
    this.code = code;
    this.members.push(host);
    this.hostId = host.id;
  }

  get isFull(): boolean {
    return this.members.length >= MAX_PLAYERS;
  }

  get isStarted(): boolean {
    return this.status !== 'lobby';
  }

  // True once the room holds no still-present member (all disconnected) — used
  // by the registry to reap. A disconnected member is never spliced from a
  // playing world (spec §15.1), but in lobby we do drop them.
  get isEmpty(): boolean {
    return this.members.every((m) => !m.connected);
  }

  addMember(m: LobbyMember): void {
    this.members.push(m);
  }

  getMember(id: string): LobbyMember | undefined {
    return this.members.find((m) => m.id === id);
  }

  setReady(id: string, value: boolean): void {
    const m = this.getMember(id);
    if (m) m.ready = value;
  }

  setClass(id: string, classId: ClassId): void {
    const m = this.getMember(id);
    if (m) m.classId = classId;
  }

  start(): void {
    if (this.status !== 'lobby') return;
    const seeds: PlayerSeed[] = this.members.map((m) => ({
      id: m.id,
      name: m.name,
      classId: m.classId,
    }));
    this.world = createWorld(seeds);
    this.status = 'playing';
  }

  // Buffer an input. Latest move/face win; casts accumulate (never dropped).
  applyInput(playerId: string, msg: { move?: Vec2; face?: number; casts?: SpellId[] }): void {
    let buf = this.inputs.get(playerId);
    if (!buf) {
      buf = { casts: [] };
      this.inputs.set(playerId, buf);
    }
    if (msg.move !== undefined) buf.move = msg.move;
    if (msg.face !== undefined) buf.face = msg.face;
    if (msg.casts) buf.casts.push(...msg.casts);
  }

  // Drain buffered inputs into a flat Command[] and advance the sim one step.
  // Returns the broadcast-ready snapshot (or null if not playing).
  stepTick(dt: number, rng: () => number = Math.random): Snapshot | null {
    if (this.status !== 'playing' || !this.world) return null;
    const commands: Command[] = [];
    for (const [playerId, buf] of this.inputs) {
      if (buf.move !== undefined) {
        commands.push({ kind: 'move', playerId, dir: buf.move });
      }
      if (buf.face !== undefined) {
        commands.push({ kind: 'face', playerId, angle: buf.face });
      }
      for (const spell of buf.casts) {
        commands.push({ kind: 'cast', playerId, spell });
      }
    }
    this.inputs.clear();
    step(this.world, commands, dt, rng);
    if (this.world.status === 'gameover') this.status = 'gameover';
    this.tick += 1;
    return toSnapshot(this.world);
  }

  // Disconnect: mark connected=false. NEVER splice the players array while a
  // world exists (spec §15.1 — splicing breaks snapshot index correspondence).
  // In lobby (no world yet) we drop the entry so the room can be reaped.
  removePlayer(id: string): void {
    const m = this.getMember(id);
    if (m) m.connected = false;
    if (this.world) {
      const p = this.world.players.find((pl) => pl.id === id);
      if (p) p.connected = false;
    } else {
      const idx = this.members.findIndex((mm) => mm.id === id);
      if (idx >= 0) this.members.splice(idx, 1);
    }
  }
}
