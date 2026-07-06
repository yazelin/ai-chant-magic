// Thin ws wiring for the authoritative server (Task B2, spec §15.1 / §15.4).
//
// - http.createServer with /healthz -> 200 on the SAME http server (Render probe);
// - WebSocketServer({ server }) shares that http server;
// - binds process.env.PORT || 8787 on 0.0.0.0;
// - routes ClientMsg -> RoomRegistry / Room;
// - ONE 50ms setInterval ticks every playing room once (one step + one snapshot)
//   and broadcasts to each room's connected sockets (single 20Hz rate);
// - socket close -> room.removePlayer (mark connected=false, never splice);
// - reaps empty rooms;
// - rejects mid-game joins (registry throws already-started).
//
// This file is deliberately minimal and manually verified; the integration
// smoke (Task B3) exercises it end-to-end. To keep that smoke in-process and on
// an ephemeral port, the whole server (http + ws + tick loop + registry) is
// built inside `startServer(port)` which returns a handle the test can start
// (await `listening`) and stop (`close`). When run as the entry module, it
// auto-starts on `process.env.PORT || 8787`.

import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomRegistry, RoomError } from './rooms';
import { Room, type LobbyMember, type Spectator } from './room';
import {
  parseClientMsg,
  type ServerMsg,
  type LobbyPlayerView,
  type ErrorCode,
} from './protocol';
import { CLASSES, CONFIG, type ClassId } from '@acm/shared';

// The server is public: a hostile/buggy client can send any string as `classId`.
// An unknown class is stored unvalidated by setClass/create/join/quickJoin and
// later crashes room.start() -> createWorld -> CLASSES[bad].hpMod (TypeError),
// which can prevent a room from ever starting. Guard at every ingestion point.
function isValidClass(c: unknown): c is ClassId {
  return typeof c === 'string' && c in CLASSES;
}

const DEFAULT_PORT = Number(process.env.PORT) || 8787;
const HOST = '0.0.0.0';
const TICK_MS = 50;
const TICK_DT = TICK_MS / 1000;
const GAMEOVER_RETURN_MS = 4500; // pause on the game-over screen before returning to the room lobby
// Victory gets a much longer window than gameover — it's a real decision (host
// picks endless mode vs. lobby), not just a "read the score" pause.
const VICTORY_DECISION_MS = CONFIG.transition.victoryDecisionSec * 1000;

// Handle returned by startServer: the bound port (after `listening` resolves),
// the underlying http/ws objects and registry (for assertions/inspection), and
// a clean teardown that stops the tick loop, closes the ws server and the http
// server.
export interface ServerHandle {
  httpServer: Server;
  wss: WebSocketServer;
  registry: RoomRegistry;
  listening: Promise<number>;
  port(): number;
  close(): Promise<void>;
}

export function startServer(port: number = DEFAULT_PORT, host: string = HOST): ServerHandle {
  const registry = new RoomRegistry();

  // Per-socket session: which room/player this connection is bound to.
  // isSpectator distinguishes a read-only observer from a real player sharing
  // the same playerId field (both just need a unique id to route messages).
  interface Session {
    room?: Room;
    playerId?: string;
    isSpectator?: boolean;
  }
  const sessions = new WeakMap<WebSocket, Session>();

  // Messages a spectator must never be able to act on — read-only per Task's
  // spec. 'chat' and 'leave' are deliberately NOT in this set (cheering and
  // stopping watching are both fine for an observer).
  const SPECTATOR_BLOCKED = new Set([
    'ready',
    'setClass',
    'start',
    'input',
    'enterEndless',
    'skipToLobby',
    'endEndless',
  ]);

  let nextPlayerId = 1;
  function makePlayerId(): string {
    return `p${nextPlayerId++}`;
  }

  function send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  function sendError(ws: WebSocket, code: ErrorCode, msg: string): void {
    send(ws, { type: 'error', code, msg });
  }

  function lobbyViews(room: Room): LobbyPlayerView[] {
    return room.members.map((m) => ({
      id: m.id,
      name: m.name,
      classId: m.classId,
      ready: m.ready,
      connected: m.connected,
    }));
  }

  // The `lobby` broadcast's shape is identical everywhere it's sent — factored
  // out so hostId (reassigned on host disconnect, see Room.removePlayer) can
  // never be forgotten at a call site.
  function lobbyMsg(room: Room): { type: 'lobby'; players: LobbyPlayerView[]; hostId: string | null } {
    return { type: 'lobby', players: lobbyViews(room), hostId: room.hostId };
  }

  // Broadcast a ServerMsg to every still-connected member AND spectator of a
  // room — spectators get the exact same snapshot/lobby/chat/etc. traffic,
  // just never send back anything that mutates the room.
  function broadcast(room: Room, msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const m of room.members) {
      if (m.connected && m.send) m.send(data);
    }
    for (const s of room.spectators) {
      if (s.connected && s.send) s.send(data);
    }
  }

  // Resolves a display name for chat, checking members first then spectators
  // — a spectator's cheer should still show their name, not "???".
  function nameFor(room: Room, id: string): string | undefined {
    return room.getMember(id)?.name ?? room.getSpectator(id)?.name;
  }

  function newMember(ws: WebSocket, name: string, classId: LobbyMember['classId']): LobbyMember {
    const id = makePlayerId();
    return {
      id,
      name: name || id,
      classId,
      ready: false,
      connected: true,
      send: (data: string) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
    };
  }

  function bindSession(ws: WebSocket, room: Room, playerId: string): void {
    sessions.set(ws, { room, playerId });
  }

  function handleMessage(ws: WebSocket, raw: string): void {
    const msg = parseClientMsg(raw);
    if (!msg) {
      sendError(ws, 'bad-message', 'unparseable or unknown message');
      return;
    }
    const session = sessions.get(ws) ?? {};
    sessions.set(ws, session);

    if (session.isSpectator && SPECTATOR_BLOCKED.has(msg.type)) {
      sendError(ws, 'spectator-readonly', '觀戰者無法操作遊戲');
      return;
    }

    switch (msg.type) {
      case 'create': {
        if (!isValidClass(msg.classId)) {
          sendError(ws, 'bad-message', 'unknown class');
          return;
        }
        try {
          const member = newMember(ws, msg.name, msg.classId);
          const room = registry.create(member);
          bindSession(ws, room, member.id);
          send(ws, {
            type: 'joined',
            roomCode: room.code,
            selfId: member.id,
            players: lobbyViews(room),
            hostId: room.hostId,
          });
        } catch (e) {
          if (e instanceof RoomError) sendError(ws, e.code as ErrorCode, e.message);
          else throw e;
        }
        break;
      }
      case 'join': {
        if (!isValidClass(msg.classId)) {
          sendError(ws, 'bad-message', 'unknown class');
          return;
        }
        try {
          const member = newMember(ws, msg.name, msg.classId);
          const room = registry.joinByCode(msg.roomCode, member);
          bindSession(ws, room, member.id);
          send(ws, {
            type: 'joined',
            roomCode: room.code,
            selfId: member.id,
            players: lobbyViews(room),
            hostId: room.hostId,
          });
          broadcast(room, lobbyMsg(room));
        } catch (e) {
          if (e instanceof RoomError) sendError(ws, e.code as ErrorCode, e.message);
          else throw e;
        }
        break;
      }
      case 'quickJoin': {
        if (!isValidClass(msg.classId)) {
          sendError(ws, 'bad-message', 'unknown class');
          return;
        }
        try {
          const member = newMember(ws, msg.name, msg.classId);
          const room = registry.quickJoin(member);
          bindSession(ws, room, member.id);
          send(ws, {
            type: 'joined',
            roomCode: room.code,
            selfId: member.id,
            players: lobbyViews(room),
            hostId: room.hostId,
          });
          broadcast(room, lobbyMsg(room));
        } catch (e) {
          if (e instanceof RoomError) sendError(ws, e.code as ErrorCode, e.message);
          else throw e;
        }
        break;
      }
      case 'ready': {
        const { room, playerId } = session;
        if (!room || !playerId) {
          sendError(ws, 'not-in-room', 'no room');
          return;
        }
        room.setReady(playerId, msg.value);
        broadcast(room, lobbyMsg(room));
        break;
      }
      case 'setClass': {
        const { room, playerId } = session;
        if (!room || !playerId) {
          sendError(ws, 'not-in-room', 'no room');
          return;
        }
        // Class can only change in the lobby. Mid-game the world is already
        // seeded from the members, so reject instead of silently no-op'ing.
        if (room.isStarted) {
          sendError(ws, 'already-started', 'cannot change class after the game has started');
          return;
        }
        if (!isValidClass(msg.classId)) {
          sendError(ws, 'bad-message', 'unknown class');
          return;
        }
        room.setClass(playerId, msg.classId);
        broadcast(room, lobbyMsg(room));
        break;
      }
      case 'start': {
        const { room, playerId } = session;
        if (!room || !playerId) {
          sendError(ws, 'not-in-room', 'no room');
          return;
        }
        if (room.hostId !== playerId) {
          sendError(ws, 'not-host', 'only the host can start');
          return;
        }
        if (room.isStarted) {
          sendError(ws, 'already-started', 'game already started');
          return;
        }
        room.start();
        broadcast(room, { type: 'started' });
        break;
      }
      case 'input': {
        const { room, playerId } = session;
        if (!room || !playerId) return; // inputs before joining are ignored
        room.applyInput(playerId, {
          move: msg.move,
          face: msg.face,
          casts: msg.casts,
          resonance: msg.resonance,
        });
        break;
      }
      case 'chat': {
        const { room, playerId } = session;
        if (!room || !playerId) return;
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 200) : '';
        if (!text) return;
        broadcast(room, { type: 'chat', from: nameFor(room, playerId) ?? '???', text });
        break;
      }
      case 'leave': {
        const { room, playerId, isSpectator } = session;
        if (room && playerId) {
          if (isSpectator) {
            room.removeSpectator(playerId);
          } else {
            room.removePlayer(playerId);
            broadcast(room, { type: 'peerLeft', id: playerId });
            // peerLeft alone never refreshes a client's roster/host UI (onPeerLeft
            // is a no-op everywhere on the client, by design deferring to this) —
            // without it, a promoted host (see Room.removePlayer) never actually
            // learns they're host until some unrelated lobby broadcast happens to
            // follow.
            broadcast(room, lobbyMsg(room));
          }
        }
        sessions.delete(ws);
        break;
      }
      case 'spectate': {
        try {
          const room = registry.get(msg.roomCode);
          if (!room) {
            throw new RoomError('not-found', `no room ${msg.roomCode}`);
          }
          const id = makePlayerId();
          const spectator: Spectator = {
            id,
            name: msg.name || id,
            connected: true,
            send: (data: string) => {
              if (ws.readyState === ws.OPEN) ws.send(data);
            },
          };
          room.addSpectator(spectator);
          sessions.set(ws, { room, playerId: id, isSpectator: true });
          send(ws, {
            type: 'spectating',
            roomCode: room.code,
            selfId: id,
            status: room.status,
            players: lobbyViews(room),
            hostId: room.hostId,
          });
        } catch (e) {
          if (e instanceof RoomError) sendError(ws, e.code as ErrorCode, e.message);
          else throw e;
        }
        break;
      }
      case 'enterEndless': {
        const { room, playerId } = session;
        if (!room || !playerId) {
          sendError(ws, 'not-in-room', 'no room');
          return;
        }
        if (room.hostId !== playerId) {
          sendError(ws, 'not-host', 'only the host can start endless mode');
          return;
        }
        if (!room.enterEndless()) {
          sendError(ws, 'not-victory', 'endless mode can only be entered from victory');
          return;
        }
        broadcast(room, { type: 'endlessStarted' });
        break;
      }
      case 'skipToLobby': {
        const { room, playerId } = session;
        if (!room || !playerId) {
          sendError(ws, 'not-in-room', 'no room');
          return;
        }
        if (room.hostId !== playerId) {
          sendError(ws, 'not-host', 'only the host can return to the lobby');
          return;
        }
        if (room.status !== 'victory') {
          sendError(ws, 'not-victory', 'nothing to skip');
          return;
        }
        room.returnToLobby();
        broadcast(room, { type: 'returnToLobby' });
        broadcast(room, lobbyMsg(room));
        break;
      }
      case 'endEndless': {
        const { room, playerId } = session;
        if (!room || !playerId) {
          sendError(ws, 'not-in-room', 'no room');
          return;
        }
        if (room.hostId !== playerId) {
          sendError(ws, 'not-host', 'only the host can end endless mode');
          return;
        }
        if (!room.endEndless()) {
          sendError(ws, 'not-endless', 'not currently in an endless run');
          return;
        }
        break;
      }
      default:
        sendError(ws, 'bad-message', 'unhandled message type');
    }
  }

  // -------------------------------------------------------------------------
  // http server (shared by ws + /healthz) and ws server
  // -------------------------------------------------------------------------

  const httpServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      // 'access-control-allow-origin: *' is safe here — a public, no-data
      // health probe (Render's own uptime checks already hit it cross-origin
      // implicitly). Needed so the client's fire-and-forget prewarmServer()
      // ping (see net/NetClient.ts) doesn't error in the browser console —
      // the request itself would still reach the server and wake it either
      // way, but a same-origin-policy error on every page load is bad hygiene.
      res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
      res.end('ok');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws: WebSocket) => {
    sessions.set(ws, {});
    ws.on('message', (data) => {
      try {
        handleMessage(ws, data.toString());
      } catch {
        sendError(ws, 'bad-message', 'handler error');
      }
    });
    ws.on('close', () => {
      const s = sessions.get(ws);
      if (s?.room && s.playerId) {
        if (s.isSpectator) {
          s.room.removeSpectator(s.playerId);
        } else {
          s.room.removePlayer(s.playerId);
          broadcast(s.room, { type: 'peerLeft', id: s.playerId });
          broadcast(s.room, lobbyMsg(s.room));
        }
      }
      sessions.delete(ws);
    });
    ws.on('error', () => {
      /* swallow; close handler does the cleanup */
    });
  });

  // -------------------------------------------------------------------------
  // Single 50ms loop: step every playing room once, broadcast its snapshot, reap.
  // -------------------------------------------------------------------------

  const loop = setInterval(() => {
    for (const room of registry.rooms()) {
      // Only step a playing room that still has at least one connected member.
      // An abandoned (everyone disconnected) playing room is left alone here and
      // reaped below — without this guard the 20Hz loop would run its sim forever.
      if (room.status === 'playing' && !room.isEmpty) {
        const snap = room.tick(TICK_DT);
        if (snap) {
          broadcast(room, { type: 'snapshot', tick: room.tickCount, world: snap });
        }
      }
      // Empty (everyone disconnected) → reap. A finished game with players
      // still connected → after a pause (they see the banner), send the room
      // back to its lobby so they can re-ready and play again. Victory gets
      // the much longer VICTORY_DECISION_MS window (a real choice: endless
      // mode vs. lobby) instead of gameover's short GAMEOVER_RETURN_MS —
      // enterEndless()/skipToLobby() (host-triggered) can also short-circuit
      // this wait from either state.
      if (room.isEmpty) {
        registry.remove(room.code);
      } else if (
        room.status === 'gameover' &&
        room.gameoverAt !== null &&
        Date.now() - room.gameoverAt > GAMEOVER_RETURN_MS
      ) {
        room.returnToLobby();
        broadcast(room, { type: 'returnToLobby' });
        broadcast(room, lobbyMsg(room));
      } else if (
        room.status === 'victory' &&
        room.victoryDecisionAt !== null &&
        Date.now() - room.victoryDecisionAt > VICTORY_DECISION_MS
      ) {
        room.returnToLobby();
        broadcast(room, { type: 'returnToLobby' });
        broadcast(room, lobbyMsg(room));
      }
    }
  }, TICK_MS);

  // Do not keep the event loop alive solely for the tick (lets tests/processes
  // exit cleanly when nothing else is pending).
  if (typeof loop.unref === 'function') loop.unref();

  const listening = new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      const addr = httpServer.address() as AddressInfo;
      // eslint-disable-next-line no-console
      console.log(`[acm-server] listening on ws://${host}:${addr.port} (healthz at /healthz)`);
      resolve(addr.port);
    });
  });

  function boundPort(): number {
    const addr = httpServer.address();
    return addr && typeof addr === 'object' ? addr.port : port;
  }

  async function close(): Promise<void> {
    clearInterval(loop);
    // Terminate every live ws client, then close the ws + http servers.
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  return {
    httpServer,
    wss,
    registry,
    listening,
    port: boundPort,
    close,
  };
}

// Auto-start when run as the entry module (tsx dev / esbuild bundle on Render).
// Under vitest the file is imported, not executed as the entry, so this stays
// dormant and the test drives startServer(0) itself.
const isEntry = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isEntry) {
  startServer();
}
