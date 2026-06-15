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
// smoke (Task B3) exercises it end-to-end.

import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomRegistry, RoomError } from './rooms';
import { Room, type LobbyMember } from './room';
import {
  parseClientMsg,
  type ServerMsg,
  type LobbyPlayerView,
  type ErrorCode,
} from './protocol';

const PORT = Number(process.env.PORT) || 8787;
const HOST = '0.0.0.0';
const TICK_MS = 50;
const TICK_DT = TICK_MS / 1000;

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
      const member = newMember(ws, msg.name, msg.classId);
      const room = registry.create(member);
      bindSession(ws, room, member.id);
      send(ws, {
        type: 'joined',
        roomCode: room.code,
        selfId: member.id,
        players: lobbyViews(room),
      });
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

// ---------------------------------------------------------------------------
// http server (shared by ws + /healthz) and ws server
// ---------------------------------------------------------------------------

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
    const session = sessions.get(ws);
    if (session?.room && session.playerId) {
      session.room.removePlayer(session.playerId);
      broadcast(session.room, { type: 'peerLeft', id: session.playerId });
    }
    sessions.delete(ws);
  });
  ws.on('error', () => {
    /* swallow; close handler does the cleanup */
  });
});

// ---------------------------------------------------------------------------
// Single 50ms loop: step every playing room once, broadcast its snapshot, reap.
// ---------------------------------------------------------------------------

const loop = setInterval(() => {
  for (const room of registry.rooms()) {
    if (room.status === 'playing') {
      const snap = room.tick(TICK_DT);
      if (snap) {
        broadcast(room, { type: 'snapshot', tick: room.tickCount, world: snap });
      }
    }
    if (room.isEmpty) registry.remove(room.code);
  }
}, TICK_MS);

// Do not keep the event loop alive solely for the tick (lets tests/processes
// exit cleanly when nothing else is pending).
if (typeof loop.unref === 'function') loop.unref();

httpServer.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[acm-server] listening on ws://${HOST}:${PORT} (healthz at /healthz)`);
});

export { httpServer, wss, registry };
