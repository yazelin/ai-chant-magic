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
import { Room, type LobbyMember } from './room';
import {
  parseClientMsg,
  type ServerMsg,
  type LobbyPlayerView,
  type ErrorCode,
} from './protocol';

const DEFAULT_PORT = Number(process.env.PORT) || 8787;
const HOST = '0.0.0.0';
const TICK_MS = 50;
const TICK_DT = TICK_MS / 1000;

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
  interface Session {
    room?: Room;
    playerId?: string;
  }
  const sessions = new WeakMap<WebSocket, Session>();

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

  // Broadcast a ServerMsg to every still-connected member of a room.
  function broadcast(room: Room, msg: ServerMsg): void {
    for (const m of room.members) {
      if (m.connected && m.send) m.send(JSON.stringify(msg));
    }
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

    switch (msg.type) {
      case 'create': {
        try {
          const member = newMember(ws, msg.name, msg.classId);
          const room = registry.create(member);
          bindSession(ws, room, member.id);
          send(ws, {
            type: 'joined',
            roomCode: room.code,
            selfId: member.id,
            players: lobbyViews(room),
          });
        } catch (e) {
          if (e instanceof RoomError) sendError(ws, e.code as ErrorCode, e.message);
          else throw e;
        }
        break;
      }
      case 'join': {
        try {
          const member = newMember(ws, msg.name, msg.classId);
          const room = registry.joinByCode(msg.roomCode, member);
          bindSession(ws, room, member.id);
          send(ws, {
            type: 'joined',
            roomCode: room.code,
            selfId: member.id,
            players: lobbyViews(room),
          });
          broadcast(room, { type: 'lobby', players: lobbyViews(room) });
        } catch (e) {
          if (e instanceof RoomError) sendError(ws, e.code as ErrorCode, e.message);
          else throw e;
        }
        break;
      }
      case 'quickJoin': {
        try {
          const member = newMember(ws, msg.name, msg.classId);
          const room = registry.quickJoin(member);
          bindSession(ws, room, member.id);
          send(ws, {
            type: 'joined',
            roomCode: room.code,
            selfId: member.id,
            players: lobbyViews(room),
          });
          broadcast(room, { type: 'lobby', players: lobbyViews(room) });
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
        broadcast(room, { type: 'lobby', players: lobbyViews(room) });
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
        });
        break;
      }
      case 'leave': {
        const { room, playerId } = session;
        if (room && playerId) {
          room.removePlayer(playerId);
          broadcast(room, { type: 'peerLeft', id: playerId });
        }
        sessions.delete(ws);
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
      res.writeHead(200, { 'content-type': 'text/plain' });
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
        s.room.removePlayer(s.playerId);
        broadcast(s.room, { type: 'peerLeft', id: s.playerId });
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
      // Reap finished or abandoned rooms so the loop does not churn on them
      // forever. A gameover room has already broadcast its final snapshot on the
      // tick that ended it; an empty room has no one left to notify.
      if (room.status === 'gameover' || room.isEmpty) {
        registry.remove(room.code);
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
