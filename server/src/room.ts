// Room: lobby -> playing -> gameover state machine + authoritative runtime.
//
// Lobby surface (members, code, status, start) is composed by the RoomRegistry
// and exercised by the pure-logic tests. The runtime (applyInput/tick/snapshot,
// per-player ws `send` fns, no-splice disconnect) follows spec §15.1:
//   - aggregate per-tick inputs: latest move / latest face win, ALL casts kept;
//   - one 50ms step + one snapshot per tick (the ws wiring drives the interval);
//   - disconnect marks connected=false and NEVER splices the players array;
//   - joins only happen in lobby (the registry refuses started rooms).
// A wall clock is injectable so tests can drive timing deterministically.

import {
  createWorld,
  step,
  SPELLS,
  type World,
  type Command,
  type ClassId,
  type SpellId,
  type Vec2,
  type PlayerSeed,
} from '@acm/shared';
import { toSnapshot, type Snapshot } from './snapshot';

// Known spell ids — a bogus cast (typo / hostile client) must never reach the
// input buffer where it would flow into the sim as an unknown command.
const VALID_SPELLS = new Set<string>(Object.keys(SPELLS));

function isValidSpell(s: unknown): s is SpellId {
  return typeof s === 'string' && VALID_SPELLS.has(s);
}

export type RoomStatus = 'lobby' | 'playing' | 'gameover';

// A lobby member. `send` is the ws push channel, optional so pure tests can
// construct members without a socket. The ws wiring (index.ts) sets it.
export interface LobbyMember {
  id: string;
  name: string;
  classId: ClassId;
  ready: boolean;
  connected: boolean;
  send?: (data: string) => void;
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
  tickCount = 0;
  hostId: string | null = null;

  private inputs = new Map<string, BufferedInput>();
  private clock: () => number;

  constructor(code: string, host: LobbyMember, clock: () => number = Date.now) {
    this.code = code;
    this.members.push(host);
    this.hostId = host.id;
    this.clock = clock;
  }

  // Injected wall clock (ms). Used by the ws wiring for reap/idle decisions;
  // tests inject a fake to drive it deterministically.
  clockNow(): number {
    return this.clock();
  }

  get isFull(): boolean {
    return this.members.length >= MAX_PLAYERS;
  }

  get isStarted(): boolean {
    return this.status !== 'lobby';
  }

  // True once no member is still connected — the registry reap signal. A
  // disconnected member is never spliced from the array (spec §15.1), so the
  // count is stable and emptiness is "everyone left".
  get isEmpty(): boolean {
    return this.members.every((m) => !m.connected);
  }

  // Canonical name per Task B2. The RoomRegistry composes rooms through it.
  addPlayer(m: LobbyMember): void {
    this.members.push(m);
  }

  getMember(id: string): LobbyMember | undefined {
    return this.members.find((m) => m.id === id);
  }

  setReady(id: string, value: boolean): void {
    const m = this.getMember(id);
    if (m) m.ready = value;
  }

  // Change a lobby member's class. Only mutates while the room is in the lobby;
  // once the game has started the class is locked (the world was seeded from the
  // members at start), so this is a no-op to prevent any mid-game class change.
  setClass(id: string, classId: ClassId): void {
    if (this.status !== 'lobby') return;
    const m = this.getMember(id);
    if (m) m.classId = classId;
  }

  // lobby -> playing. Seeds the authoritative World from the current members
  // (id/name/class, in order). Idempotent: a second start while playing is a
  // no-op so the world is never rebuilt mid-game.
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
  // Non-finite move/face (NaN/Infinity) is dropped so a hostile/buggy client
  // cannot poison the player's position, and unknown casts are filtered out so
  // only real spell ids ever reach the sim.
  applyInput(
    playerId: string,
    msg: { move?: Vec2; face?: number; casts?: SpellId[] }
  ): void {
    let buf = this.inputs.get(playerId);
    if (!buf) {
      buf = { casts: [] };
      this.inputs.set(playerId, buf);
    }
    if (
      msg.move !== undefined &&
      Number.isFinite(msg.move.x) &&
      Number.isFinite(msg.move.y)
    ) {
      buf.move = msg.move;
    }
    if (msg.face !== undefined && Number.isFinite(msg.face)) {
      buf.face = msg.face;
    }
    if (msg.casts) {
      for (const c of msg.casts) {
        if (isValidSpell(c)) buf.casts.push(c);
      }
    }
  }

  // Drain buffered inputs into a flat Command[] and advance the sim one step.
  // Returns the broadcast-ready snapshot (or null if not playing). This is the
  // single 50ms step+broadcast unit (spec §15.1) — the ws interval calls it.
  tick(dt: number, rng: () => number = Math.random): Snapshot | null {
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
    this.tickCount += 1;
    return toSnapshot(this.world);
  }

  // Disconnect: mark connected=false on the lobby member AND (if a world exists)
  // its world player. NEVER splice either array — splicing would break the
  // snapshot index/id correspondence the client interpolation relies on
  // (spec §15.1). isEmpty then reaps the room once everyone has left.
  removePlayer(id: string): void {
    const m = this.getMember(id);
    if (m) m.connected = false;
    if (this.world) {
      const p = this.world.players.find((pl) => pl.id === id);
      if (p) p.connected = false;
    }
  }
}
