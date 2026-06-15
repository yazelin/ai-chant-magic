// RoomRegistry: room-code generation + matchmaking (spec §8, plan Task B1 Step 4).
// Pure, deterministic given an injected rng (Math.random by default).

import { Room, MAX_PLAYERS, type LobbyMember } from './room';

export { MAX_PLAYERS };

// No-ambiguous alphabet: drops 0/O, 1/I/L to avoid mistyped codes when shared
// verbally or by sight.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 4;

// Guard against runaway room growth (spec §8: MAX_ROOMS protection).
export const MAX_ROOMS = 200;

export type RoomErrorCode = 'not-found' | 'full' | 'already-started' | 'server-full';

export class RoomError extends Error {
  readonly code: RoomErrorCode;
  constructor(code: RoomErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RoomError';
    this.code = code;
  }
}

export function makeCode(rng: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    const idx = Math.min(CODE_ALPHABET.length - 1, Math.floor(rng() * CODE_ALPHABET.length));
    out += CODE_ALPHABET[idx];
  }
  return out;
}

export class RoomRegistry {
  private roomsByCode = new Map<string, Room>();
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  get(code: string): Room | undefined {
    return this.roomsByCode.get(code);
  }

  // Live iterator over current rooms — the ws tick loop walks this each frame
  // to step playing rooms and reap empty ones.
  rooms(): IterableIterator<Room> {
    return this.roomsByCode.values();
  }

  get size(): number {
    return this.roomsByCode.size;
  }

  // Generate a code not currently in use. Retries on collision; bounded so a
  // pathological rng cannot spin forever.
  private freshCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const code = makeCode(this.rng);
      if (!this.roomsByCode.has(code)) return code;
    }
    throw new RoomError('server-full', 'could not allocate a unique room code');
  }

  create(host: LobbyMember): Room {
    if (this.roomsByCode.size >= MAX_ROOMS) {
      throw new RoomError('server-full', 'too many rooms');
    }
    const code = this.freshCode();
    const room = new Room(code, host);
    this.roomsByCode.set(code, room);
    return room;
  }

  joinByCode(code: string, member: LobbyMember): Room {
    const room = this.roomsByCode.get(code);
    if (!room) throw new RoomError('not-found', `no room ${code}`);
    if (room.isStarted) throw new RoomError('already-started', `room ${code} already started`);
    if (room.isFull) throw new RoomError('full', `room ${code} is full`);
    room.addMember(member);
    return room;
  }

  // Pick the first open lobby room that still has space; else create a new room.
  quickJoin(member: LobbyMember): Room {
    for (const room of this.roomsByCode.values()) {
      if (room.status === 'lobby' && !room.isFull) {
        room.addMember(member);
        return room;
      }
    }
    return this.create(member);
  }

  remove(code: string): void {
    this.roomsByCode.delete(code);
  }
}
