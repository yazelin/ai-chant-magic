import { describe, it, expect } from 'vitest';
import {
  RoomRegistry,
  makeCode,
  CODE_ALPHABET,
  RoomError,
  MAX_PLAYERS,
} from '../src/rooms';
import type { LobbyMember } from '../src/room';

function member(id: string): LobbyMember {
  return { id, name: id, classId: 'pyro', ready: false, connected: true };
}

describe('makeCode', () => {
  it('produces 4 chars from a no-ambiguous alphabet', () => {
    const code = makeCode(() => 0);
    expect(code).toHaveLength(4);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  });

  it('alphabet excludes ambiguous chars 0/O/1/I/L', () => {
    for (const bad of ['0', 'O', '1', 'I', 'L']) {
      expect(CODE_ALPHABET).not.toContain(bad);
    }
  });

  it('is deterministic given an injected rng', () => {
    // rng=()=>0 selects index 0 every char.
    const first = CODE_ALPHABET[0];
    expect(makeCode(() => 0)).toBe(first.repeat(4));
    // a sequence rng selects successive indices.
    const seq = [0, 0.999999, 0, 0.5];
    let i = 0;
    const rng = () => seq[i++];
    const code = makeCode(rng);
    expect(code[0]).toBe(CODE_ALPHABET[0]);
    expect(code[1]).toBe(CODE_ALPHABET[CODE_ALPHABET.length - 1]);
  });
});

describe('RoomRegistry.create', () => {
  it('creates a room with a unique code and one member', () => {
    const reg = new RoomRegistry(() => 0);
    const room = reg.create(member('host'));
    expect(room.code).toHaveLength(4);
    expect(room.members).toHaveLength(1);
    expect(room.members[0].id).toBe('host');
    expect(room.status).toBe('lobby');
    expect(reg.get(room.code)).toBe(room);
  });

  it('avoids code collisions by retrying the rng', () => {
    const codes = ['AAAA', 'AAAA', 'BBBB'];
    let call = 0;
    // each makeCode call consumes 4 rng draws; force first code AAAA, second
    // collision AAAA then BBBB by feeding indices that map to those letters.
    const idxA = CODE_ALPHABET.indexOf('A');
    const idxB = CODE_ALPHABET.indexOf('B');
    const draws: number[] = [];
    const push = (idx: number) => draws.push(idx / CODE_ALPHABET.length);
    // room1 -> AAAA
    for (let i = 0; i < 4; i++) push(idxA);
    // room2 attempt1 -> AAAA (collision), attempt2 -> BBBB
    for (let i = 0; i < 4; i++) push(idxA);
    for (let i = 0; i < 4; i++) push(idxB);
    void codes;
    const rng = () => draws[call++];
    const reg = new RoomRegistry(rng);
    const r1 = reg.create(member('h1'));
    const r2 = reg.create(member('h2'));
    expect(r1.code).toBe('AAAA');
    expect(r2.code).toBe('BBBB');
    expect(r1.code).not.toBe(r2.code);
  });
});

describe('RoomRegistry.joinByCode', () => {
  it('adds a member to an existing lobby room', () => {
    const reg = new RoomRegistry(() => 0);
    const room = reg.create(member('host'));
    const joined = reg.joinByCode(room.code, member('guest'));
    expect(joined).toBe(room);
    expect(room.members.map((m) => m.id)).toEqual(['host', 'guest']);
  });

  it('throws not-found for an unknown code', () => {
    const reg = new RoomRegistry(() => 0);
    try {
      reg.joinByCode('ZZZZ', member('guest'));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RoomError);
      expect((e as RoomError).code).toBe('not-found');
    }
  });

  it('throws full when the room already has MAX_PLAYERS', () => {
    const reg = new RoomRegistry(() => 0);
    const room = reg.create(member('host'));
    for (let i = 1; i < MAX_PLAYERS; i++) {
      reg.joinByCode(room.code, member('g' + i));
    }
    expect(room.members).toHaveLength(MAX_PLAYERS);
    expect(MAX_PLAYERS).toBe(4);
    expect(() => reg.joinByCode(room.code, member('overflow'))).toThrow(RoomError);
    try {
      reg.joinByCode(room.code, member('overflow2'));
    } catch (e) {
      expect((e as RoomError).code).toBe('full');
    }
  });

  it('throws already-started when the room is playing', () => {
    const reg = new RoomRegistry(() => 0);
    const room = reg.create(member('host'));
    room.start();
    try {
      reg.joinByCode(room.code, member('late'));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RoomError);
      expect((e as RoomError).code).toBe('already-started');
    }
  });
});

describe('RoomRegistry.quickJoin', () => {
  it('creates a new room when none are open', () => {
    const reg = new RoomRegistry(() => 0);
    const room = reg.quickJoin(member('solo'));
    expect(room.members.map((m) => m.id)).toEqual(['solo']);
    expect(room.status).toBe('lobby');
  });

  it('joins the first open lobby room that has space', () => {
    const idxA = CODE_ALPHABET.indexOf('A');
    const idxB = CODE_ALPHABET.indexOf('B');
    const draws: number[] = [];
    for (let i = 0; i < 4; i++) draws.push(idxA / CODE_ALPHABET.length);
    for (let i = 0; i < 4; i++) draws.push(idxB / CODE_ALPHABET.length);
    let call = 0;
    const reg = new RoomRegistry(() => draws[call++]);
    const r1 = reg.create(member('host'));
    const got = reg.quickJoin(member('guest'));
    expect(got).toBe(r1);
    expect(r1.members.map((m) => m.id)).toEqual(['host', 'guest']);
  });

  it('skips full rooms and skips started rooms', () => {
    const reg = new RoomRegistry(Math.random);
    const full = reg.create(member('h'));
    for (let i = 1; i < MAX_PLAYERS; i++) reg.joinByCode(full.code, member('f' + i));
    const started = reg.create(member('s'));
    started.start();
    const got = reg.quickJoin(member('q'));
    expect(got).not.toBe(full);
    expect(got).not.toBe(started);
    expect(got.members.map((m) => m.id)).toEqual(['q']);
  });
});

describe('RoomRegistry.remove', () => {
  it('removes a room so it can no longer be joined', () => {
    const reg = new RoomRegistry(() => 0);
    const room = reg.create(member('host'));
    reg.remove(room.code);
    expect(reg.get(room.code)).toBeUndefined();
    expect(() => reg.joinByCode(room.code, member('g'))).toThrow(RoomError);
  });
});
