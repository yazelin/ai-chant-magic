import { describe, it, expect } from 'vitest';
import { Room, type LobbyMember } from '../src/room';
import type { Snapshot } from '../src/snapshot';

function member(id: string, classId: LobbyMember['classId'] = 'pyro'): LobbyMember {
  return { id, name: id, classId, ready: false, connected: true };
}

// A deterministic, injectable clock the Room can use for `tick` timing if needed.
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('Room lobby surface', () => {
  it('starts in lobby with the host as the only member', () => {
    const room = new Room('AAAA', member('host'));
    expect(room.code).toBe('AAAA');
    expect(room.status).toBe('lobby');
    expect(room.world).toBeNull();
    expect(room.members.map((m) => m.id)).toEqual(['host']);
    expect(room.hostId).toBe('host');
  });

  it('addPlayer appends a lobby member', () => {
    const room = new Room('AAAA', member('host'));
    room.addPlayer(member('guest'));
    expect(room.members.map((m) => m.id)).toEqual(['host', 'guest']);
  });

  it('setReady toggles a member ready flag', () => {
    const room = new Room('AAAA', member('host'));
    room.setReady('host', true);
    expect(room.getMember('host')?.ready).toBe(true);
    room.setReady('host', false);
    expect(room.getMember('host')?.ready).toBe(false);
  });

  it('setClass changes a member class', () => {
    const room = new Room('AAAA', member('host'));
    room.setClass('host', 'warden');
    expect(room.getMember('host')?.classId).toBe('warden');
  });

  it('isFull at MAX_PLAYERS (4)', () => {
    const room = new Room('AAAA', member('host'));
    expect(room.isFull).toBe(false);
    room.addPlayer(member('g1'));
    room.addPlayer(member('g2'));
    room.addPlayer(member('g3'));
    expect(room.members).toHaveLength(4);
    expect(room.isFull).toBe(true);
  });
});

describe('Room.start -> createWorld(seeds)', () => {
  it('builds a playing world seeded from the lobby members', () => {
    const room = new Room('AAAA', member('host', 'pyro'));
    room.addPlayer(member('guest', 'warden'));
    room.start();
    expect(room.status).toBe('playing');
    expect(room.isStarted).toBe(true);
    expect(room.world).not.toBeNull();
    const w = room.world!;
    expect(w.status).toBe('playing');
    // Seeds preserve id/name/class and order.
    expect(w.players.map((p) => p.id)).toEqual(['host', 'guest']);
    expect(w.players.map((p) => p.classId)).toEqual(['pyro', 'warden']);
    expect(w.players.every((p) => p.alive && !p.downed && p.connected)).toBe(true);
  });

  it('is idempotent (start while already playing does not rebuild the world)', () => {
    const room = new Room('AAAA', member('host'));
    room.start();
    const w = room.world;
    room.start();
    expect(room.world).toBe(w);
  });
});

describe('Room.applyInput buffering (spec §15.1)', () => {
  it('keeps only the latest move and latest face', () => {
    const room = new Room('AAAA', member('host'));
    room.start();
    room.applyInput('host', { move: { x: 1, y: 0 }, face: 0.1 });
    room.applyInput('host', { move: { x: 0, y: 1 }, face: 0.9 });
    const startX = room.world!.players.find((p) => p.id === 'host')!.pos.x;
    const startY = room.world!.players.find((p) => p.id === 'host')!.pos.y;
    const snap = room.tick(0.05)!;
    // After a tick the host should have moved along +y (the latest move),
    // not +x, and facing should be the latest value.
    const host = snap.players.find((p) => p.id === 'host')!;
    expect(host.facing).toBeCloseTo(0.9);
    // Latest move {x:0,y:1} pushes y up; x is unchanged (proves the +x first
    // move was discarded, only the latest move applied).
    expect(host.pos.y).toBeGreaterThan(startY);
    expect(host.pos.x).toBeCloseTo(startX);
  });

  it('appends ALL casts across multiple input messages in a tick', () => {
    // pyro can cast fireball; two queued fireballs would both be processed,
    // but the 2nd is on cooldown. So queue a fireball then a shield: both fire.
    const room = new Room('AAAA', member('host', 'pyro'));
    room.start();
    room.applyInput('host', { casts: ['fireball'] });
    room.applyInput('host', { casts: ['shield'] });
    const snap = room.tick(0.05)!;
    // fireball spawns a projectile; shield spawns an aura effect.
    expect(snap.projectiles.some((pr) => pr.spell === 'fireball')).toBe(true);
    expect(snap.effects.some((fx) => fx.kind === 'aura')).toBe(true);
  });

  it('buffered inputs are drained each tick (not replayed next tick)', () => {
    const room = new Room('AAAA', member('host', 'pyro'));
    room.start();
    room.applyInput('host', { casts: ['fireball'] });
    const first = room.tick(0.05)!;
    const projsAfterFirst = first.projectiles.filter((pr) => pr.spell === 'fireball').length;
    expect(projsAfterFirst).toBe(1);
    // No new input -> next tick must not spawn another fireball.
    const second = room.tick(0.05)!;
    const newFireballs = second.projectiles.filter(
      (pr) => pr.spell === 'fireball'
    ).length;
    // The original projectile may still be flying, but no SECOND one is added.
    expect(newFireballs).toBeLessThanOrEqual(1);
  });
});

describe('Room.tick (one 50ms step + snapshot)', () => {
  it('returns null before the game is playing', () => {
    const room = new Room('AAAA', member('host'));
    expect(room.tick(0.05)).toBeNull();
  });

  it('advances the world clock and returns a snapshot while playing', () => {
    const room = new Room('AAAA', member('host'));
    room.start();
    const snap = room.tick(0.05) as Snapshot;
    expect(snap).not.toBeNull();
    expect(snap.time).toBeCloseTo(0.05);
    expect(snap.status).toBe('playing');
    const snap2 = room.tick(0.05)!;
    expect(snap2.time).toBeCloseTo(0.1);
  });
});

describe('Room.removePlayer — mark connected=false, NEVER splice (spec §15.1)', () => {
  it('in lobby: marks the member disconnected but keeps the entry', () => {
    const room = new Room('AAAA', member('host'));
    room.addPlayer(member('guest'));
    room.removePlayer('guest');
    // Entry is NOT spliced; index correspondence preserved.
    expect(room.members.map((m) => m.id)).toEqual(['host', 'guest']);
    expect(room.getMember('guest')?.connected).toBe(false);
    expect(room.getMember('host')?.connected).toBe(true);
  });

  it('in playing: marks both the lobby member and world player connected=false without splicing', () => {
    const room = new Room('AAAA', member('host'));
    room.addPlayer(member('guest'));
    room.start();
    const idsBefore = room.world!.players.map((p) => p.id);
    room.removePlayer('host');
    // No splice in either array.
    expect(room.members.map((m) => m.id)).toEqual(['host', 'guest']);
    expect(room.world!.players.map((p) => p.id)).toEqual(idsBefore);
    expect(room.getMember('host')?.connected).toBe(false);
    expect(room.world!.players.find((p) => p.id === 'host')?.connected).toBe(false);
    // The other player is untouched.
    expect(room.world!.players.find((p) => p.id === 'guest')?.connected).toBe(true);
  });
});

describe('Room.isEmpty (registry reap signal)', () => {
  it('is empty only once every member is disconnected', () => {
    const room = new Room('AAAA', member('host'));
    room.addPlayer(member('guest'));
    expect(room.isEmpty).toBe(false);
    room.removePlayer('host');
    expect(room.isEmpty).toBe(false);
    room.removePlayer('guest');
    expect(room.isEmpty).toBe(true);
  });
});

describe('Room — mid-game join is rejected (spec §15.1)', () => {
  it('isStarted is true after start so the registry refuses joins', () => {
    const room = new Room('AAAA', member('host'));
    expect(room.isStarted).toBe(false);
    room.start();
    expect(room.isStarted).toBe(true);
  });
});

describe('Room with injected clock', () => {
  it('accepts a clock and leaves wall-clock injectable for tests', () => {
    const clock = fakeClock(1000);
    const room = new Room('AAAA', member('host'), clock.now);
    room.start();
    // The injected clock is what the room reports as its wall time.
    expect(room.clockNow()).toBe(1000);
    clock.advance(50);
    expect(room.clockNow()).toBe(1050);
  });
});
