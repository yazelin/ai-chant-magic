// Task B3 — two-client ws integration smoke (spec §8 last bullet, §15.1).
//
// Drives the REAL server end-to-end in-process on an ephemeral port:
//   1. startServer(0) -> bind on 0.0.0.0:<random>; read the bound port.
//   2. client A connects, `create` -> `joined{roomCode, selfId}`.
//   3. client B connects, `join{roomCode}` -> both see the lobby grow.
//   4. A (the host) `start` -> both receive `started`, then `snapshot`s begin
//      arriving from the single 50ms tick loop.
//   5. A faces toward where enemies spawn and sends `input{casts:['fireball']}`.
//      The pyro loadout includes fireball; the sim spawns a projectile and (on
//      collision/expiry) a 'blast' effect. Assert a LATER snapshot carries a
//      projectile OR a relevant transient effect (blast/beam/etc).
//   6. Tear down: close both sockets, then close the server (stops the tick
//      loop + ws + http server) so vitest exits cleanly.
//
// No production code is special-cased for the test; the only refactor was
// extracting startServer(port) so this can run on an ephemeral port in-process.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startServer, type ServerHandle } from '../src/index';
import type { ServerMsg } from '../src/protocol';

let handle: ServerHandle;
let url: string;
const openSockets: WebSocket[] = [];

beforeEach(async () => {
  handle = startServer(0, '127.0.0.1');
  const port = await handle.listening;
  url = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const ws of openSockets.splice(0)) {
    try {
      ws.removeAllListeners();
      ws.close();
    } catch {
      /* ignore */
    }
  }
  await handle.close();
});

// Open a client and wait until it is connected.
function connect(): Promise<WebSocket> {
  const ws = new WebSocket(url);
  openSockets.push(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function sendMsg(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

// Poll `cond` until it returns true (or time out). Used to observe registry
// state changes driven by the server's own 50ms tick loop.
function waitUntil(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (cond()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error('waitUntil timed out'));
      }
    }, 20);
  });
}

// Resolve with the first server message whose `type` matches `type`.
function waitFor<T extends ServerMsg['type']>(
  ws: WebSocket,
  type: T,
  timeoutMs = 4000
): Promise<Extract<ServerMsg, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`timed out waiting for "${type}"`));
    }, timeoutMs);
    function onMsg(data: WebSocket.RawData): void {
      let parsed: ServerMsg;
      try {
        parsed = JSON.parse(data.toString()) as ServerMsg;
      } catch {
        return;
      }
      if (parsed.type === type) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(parsed as Extract<ServerMsg, { type: T }>);
      }
    }
    ws.on('message', onMsg);
  });
}

// Collect server messages of `type` until `predicate` is satisfied (or timeout).
function waitForMatch<T extends ServerMsg['type']>(
  ws: WebSocket,
  type: T,
  predicate: (m: Extract<ServerMsg, { type: T }>) => boolean,
  timeoutMs = 6000
): Promise<Extract<ServerMsg, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`timed out waiting for matching "${type}"`));
    }, timeoutMs);
    function onMsg(data: WebSocket.RawData): void {
      let parsed: ServerMsg;
      try {
        parsed = JSON.parse(data.toString()) as ServerMsg;
      } catch {
        return;
      }
      if (parsed.type === type) {
        const m = parsed as Extract<ServerMsg, { type: T }>;
        if (predicate(m)) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(m);
        }
      }
    }
    ws.on('message', onMsg);
  });
}

describe('two-client ws integration smoke (B3)', () => {
  it('healthz responds 200 on the shared http server', async () => {
    const port = handle.port();
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it(
    'create -> join -> start -> snapshot, then a pyro cast yields a projectile or effect',
    async () => {
      // --- A creates the room ---------------------------------------------
      const a = await connect();
      const joinedPromise = waitFor(a, 'joined');
      sendMsg(a, { type: 'create', name: 'Alice', classId: 'pyro' });
      const joinedA = await joinedPromise;
      expect(joinedA.roomCode).toMatch(/^[A-Z0-9]{4}$/);
      expect(joinedA.selfId).toBeTruthy();
      expect(joinedA.players).toHaveLength(1);

      const code = joinedA.roomCode;

      // --- B joins by code -------------------------------------------------
      const b = await connect();
      // A should see a lobby update growing to 2 players when B joins.
      const lobbyGrew = waitForMatch(a, 'lobby', (m) => m.players.length === 2);
      const joinedBPromise = waitFor(b, 'joined');
      sendMsg(b, { type: 'join', name: 'Bob', classId: 'warden', roomCode: code });
      const joinedB = await joinedBPromise;
      expect(joinedB.roomCode).toBe(code);
      expect(joinedB.players).toHaveLength(2);
      await lobbyGrew;

      // --- A (host) starts -> both get `started` ---------------------------
      const startedA = waitFor(a, 'started');
      const startedB = waitFor(b, 'started');
      sendMsg(a, { type: 'start' });
      await Promise.all([startedA, startedB]);

      // --- Both receive snapshots from the 50ms tick loop ------------------
      const firstSnapA = await waitFor(a, 'snapshot');
      const firstSnapB = await waitFor(b, 'snapshot');
      expect(firstSnapA.world.status).toBe('playing');
      expect(firstSnapA.world.players).toHaveLength(2);
      expect(firstSnapB.world.players).toHaveLength(2);

      // --- A casts 黑暗詠唱 (pyro loadout) ----------------------------------
      // pyro's chant has no cooldown and stacks 爆裂 charge while spawning an
      // aura effect; the server aggregates it into the next tick's commands.
      sendMsg(a, { type: 'input', seq: 1, face: 0, casts: ['chant1'] });

      // A later snapshot must reflect the cast: an aura transient effect and/or
      // the caster's 爆裂 charge having ticked up.
      const evidence = await waitForMatch(
        a,
        'snapshot',
        (m) =>
          m.world.effects.some((fx) => fx.kind === 'aura') ||
          m.world.players.some((p) => (p.pyroCharge ?? 0) > 0)
      );

      const hasAura = evidence.world.effects.some((fx) => fx.kind === 'aura');
      const hasCharge = evidence.world.players.some((p) => (p.pyroCharge ?? 0) > 0);
      expect(hasAura || hasCharge).toBe(true);
    },
    15000
  );

  it(
    'a setClass message in the lobby broadcasts an updated lobby with the new classId',
    async () => {
      // A creates the room as pyro.
      const a = await connect();
      const joinedPromise = waitFor(a, 'joined');
      sendMsg(a, { type: 'create', name: 'Alice', classId: 'pyro' });
      const joinedA = await joinedPromise;
      expect(joinedA.players[0].classId).toBe('pyro');
      const selfId = joinedA.selfId;
      const code = joinedA.roomCode;

      // B joins so there is more than one room member to broadcast to.
      const b = await connect();
      const joinedBPromise = waitFor(b, 'joined');
      sendMsg(b, { type: 'join', name: 'Bob', classId: 'warden', roomCode: code });
      await joinedBPromise;

      // A switches class to warden while still in the lobby.
      // BOTH clients must receive a `lobby` broadcast in which A is now warden.
      const aSawWarden = waitForMatch(
        a,
        'lobby',
        (m) => m.players.some((p) => p.id === selfId && p.classId === 'warden')
      );
      const bSawWarden = waitForMatch(
        b,
        'lobby',
        (m) => m.players.some((p) => p.id === selfId && p.classId === 'warden')
      );
      sendMsg(a, { type: 'setClass', classId: 'warden' });
      const [seenByA, seenByB] = await Promise.all([aSawWarden, bSawWarden]);

      // The authoritative room reflects the change too.
      const room = handle.registry.get(code)!;
      expect(room.getMember(selfId)?.classId).toBe('warden');
      // And the broadcast each client saw carries the new class.
      expect(seenByA.players.find((p) => p.id === selfId)?.classId).toBe('warden');
      expect(seenByB.players.find((p) => p.id === selfId)?.classId).toBe('warden');
    },
    15000
  );

  it(
    'ignores setClass once the game has started (no mid-game class change)',
    async () => {
      const a = await connect();
      const joinedPromise = waitFor(a, 'joined');
      sendMsg(a, { type: 'create', name: 'Solo', classId: 'pyro' });
      const joined = await joinedPromise;
      const selfId = joined.selfId;
      const code = joined.roomCode;

      const started = waitFor(a, 'started');
      sendMsg(a, { type: 'start' });
      await started;
      await waitFor(a, 'snapshot'); // game is live

      // Attempt a class change mid-game — must be ignored.
      sendMsg(a, { type: 'setClass', classId: 'warden' });

      const room = handle.registry.get(code)!;
      // Give the handler a couple of ticks to (not) apply the change.
      await waitUntil(() => room.tickCount >= 2);
      expect(room.getMember(selfId)?.classId).toBe('pyro');
    },
    10000
  );

  it(
    'returns a server-full error (not a generic bad-message) when create overflows MAX_ROOMS',
    async () => {
      const { MAX_ROOMS } = await import('../src/rooms');
      const a = await connect();
      // Fill the registry to MAX_ROOMS by repeatedly creating rooms on one socket.
      for (let i = 0; i < MAX_ROOMS; i++) {
        const joined = waitFor(a, 'joined');
        sendMsg(a, { type: 'create', name: `H${i}`, classId: 'pyro' });
        await joined;
      }
      expect(handle.registry.size).toBe(MAX_ROOMS);

      // The next create must surface the registry's RoomError as a typed
      // `server-full` error, not the generic handler 'bad-message'.
      const err = waitFor(a, 'error');
      sendMsg(a, { type: 'create', name: 'overflow', classId: 'pyro' });
      const got = await err;
      expect(got.code).toBe('server-full');
    },
    15000
  );

  it(
    'returns a finished (gameover) room to its lobby on the tick loop (play again)',
    async () => {
      const a = await connect();
      const joinedPromise = waitFor(a, 'joined');
      sendMsg(a, { type: 'create', name: 'Solo', classId: 'pyro' });
      const joined = await joinedPromise;
      const code = joined.roomCode;

      const started = waitFor(a, 'started');
      sendMsg(a, { type: 'start' });
      await started;
      await waitFor(a, 'snapshot'); // tick loop is running

      // Force the room into a finished state, back-dating gameoverAt past the
      // return-to-lobby delay so the next tick fires it (no real-time wait).
      const room = handle.registry.get(code)!;
      expect(room).toBeTruthy();
      const returned = waitFor(a, 'returnToLobby');
      room.status = 'gameover';
      room.gameoverAt = Date.now() - 60_000;

      // The connected player is sent back to the room lobby — the room is KEPT
      // (not reaped), world cleared, ready reset, so they can play again together.
      await returned;
      await waitUntil(() => room.status === 'lobby');
      expect(handle.registry.get(code)).toBeTruthy();
      expect(room.status).toBe('lobby');
      expect(room.world).toBeNull();
      expect(room.members[0].ready).toBe(false);
    },
    10000
  );

  it(
    'rejects a setClass with a bogus classId (member keeps old class, no bad-class broadcast)',
    async () => {
      const a = await connect();
      const joinedPromise = waitFor(a, 'joined');
      sendMsg(a, { type: 'create', name: 'Alice', classId: 'pyro' });
      const joined = await joinedPromise;
      const selfId = joined.selfId;
      const code = joined.roomCode;

      // A bogus classId must be rejected with a bad-message error and must NOT
      // mutate the member or broadcast a lobby carrying the bad class.
      const errPromise = waitFor(a, 'error');
      let sawBadLobby = false;
      function watchLobby(data: WebSocket.RawData): void {
        try {
          const m = JSON.parse(data.toString()) as ServerMsg;
          if (
            m.type === 'lobby' &&
            m.players.some((p) => p.id === selfId && p.classId === ('nope' as never))
          ) {
            sawBadLobby = true;
          }
        } catch {
          /* ignore */
        }
      }
      a.on('message', watchLobby);

      sendMsg(a, { type: 'setClass', classId: 'nope' as never });
      const err = await errPromise;
      a.off('message', watchLobby);

      expect(err.code).toBe('bad-message');
      // The authoritative room still has the original class.
      const room = handle.registry.get(code)!;
      expect(room.getMember(selfId)?.classId).toBe('pyro');
      expect(sawBadLobby).toBe(false);
    },
    10000
  );

  it(
    'rejects create / join / quickJoin with a bogus classId before making a room or member',
    async () => {
      // --- create with a bogus class -> bad-message, no room created ---------
      const a = await connect();
      const createErr = waitFor(a, 'error');
      sendMsg(a, { type: 'create', name: 'Alice', classId: 'bogus' as never });
      expect((await createErr).code).toBe('bad-message');
      expect(handle.registry.size).toBe(0);

      // --- quickJoin with a bogus class -> bad-message, no room created ------
      const q = await connect();
      const quickErr = waitFor(q, 'error');
      sendMsg(q, { type: 'quickJoin', name: 'Q', classId: 'bogus' as never });
      expect((await quickErr).code).toBe('bad-message');
      expect(handle.registry.size).toBe(0);

      // --- join an existing room with a bogus class -> bad-message ----------
      // First make a real room so there is something to (try to) join.
      const host = await connect();
      const hostJoined = waitFor(host, 'joined');
      sendMsg(host, { type: 'create', name: 'Host', classId: 'pyro' });
      const code = (await hostJoined).roomCode;
      expect(handle.registry.size).toBe(1);

      const b = await connect();
      const joinErr = waitFor(b, 'error');
      sendMsg(b, { type: 'join', name: 'Bad', classId: 'bogus' as never, roomCode: code });
      expect((await joinErr).code).toBe('bad-message');
      // The room only has the host (the bad join never added a member).
      expect(handle.registry.get(code)!.members).toHaveLength(1);
    },
    15000
  );

  it(
    'a room whose members all have valid classes starts fine (createWorld regression)',
    async () => {
      const a = await connect();
      const joinedA = waitFor(a, 'joined');
      sendMsg(a, { type: 'create', name: 'A', classId: 'storm' });
      const code = (await joinedA).roomCode;

      const b = await connect();
      const joinedB = waitFor(b, 'joined');
      sendMsg(b, { type: 'join', name: 'B', classId: 'cryo', roomCode: code });
      await joinedB;

      const startedA = waitFor(a, 'started');
      sendMsg(a, { type: 'start' });
      await startedA;

      // A snapshot must arrive without the world build crashing on a bad class.
      const snap = await waitFor(a, 'snapshot');
      expect(snap.world.status).toBe('playing');
      expect(snap.world.players).toHaveLength(2);
    },
    10000
  );

  it(
    'reaps an abandoned playing room (all members disconnected) and stops ticking it',
    async () => {
      const a = await connect();
      const joinedPromise = waitFor(a, 'joined');
      sendMsg(a, { type: 'create', name: 'Solo', classId: 'pyro' });
      const joined = await joinedPromise;
      const code = joined.roomCode;

      const started = waitFor(a, 'started');
      sendMsg(a, { type: 'start' });
      await started;
      await waitFor(a, 'snapshot');

      const room = handle.registry.get(code)!;
      const ticksAtAbandon = room.tickCount;

      // The only member leaves -> room is empty (everyone disconnected).
      a.removeAllListeners();
      a.close();

      // Loop must (a) stop stepping the empty room and (b) reap it.
      await waitUntil(() => handle.registry.get(code) === undefined);
      expect(handle.registry.get(code)).toBeUndefined();
      // It did not keep accumulating ticks after abandonment beyond a small margin
      // (the close + reap race may allow a tick or two, but not an unbounded run).
      expect(room.tickCount - ticksAtAbandon).toBeLessThanOrEqual(3);
    },
    10000
  );
});
