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

      // --- A casts fireball (pyro loadout) ---------------------------------
      // Face along +x and queue a fireball cast; the server aggregates this
      // into the next tick's commands -> sim spawns a fireball projectile.
      sendMsg(a, { type: 'input', seq: 1, face: 0, casts: ['fireball'] });

      // A later snapshot must show the fireball as a live projectile. A pyro
      // fireball travels for CONFIG.fireball.ttl (1.5s) before it expires into
      // a 'blast' effect, so across the 50ms tick stream it is observable as a
      // projectile of spell 'fireball'. (As a fallback, an early-collision case
      // would surface a 'blast' transient effect — accepted too so the smoke
      // stays robust to enemy placement, but the projectile is the primary
      // assertion since the arena starts empty.)
      const evidence = await waitForMatch(
        a,
        'snapshot',
        (m) =>
          m.world.projectiles.some((pr) => pr.spell === 'fireball') ||
          m.world.effects.some((fx) => fx.kind === 'blast')
      );

      const hasFireballProjectile = evidence.world.projectiles.some(
        (pr) => pr.spell === 'fireball'
      );
      const hasBlastEffect = evidence.world.effects.some((fx) => fx.kind === 'blast');
      expect(hasFireballProjectile || hasBlastEffect).toBe(true);
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
    'reaps a finished (gameover) room from the registry on the tick loop',
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

      // Force the room's world into gameover (the player is gone for the sim).
      const room = handle.registry.get(code)!;
      expect(room).toBeTruthy();
      room.status = 'gameover';

      // The next tick(s) of the 50ms loop must reap the finished room.
      await waitUntil(() => handle.registry.get(code) === undefined);
      expect(handle.registry.get(code)).toBeUndefined();
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
