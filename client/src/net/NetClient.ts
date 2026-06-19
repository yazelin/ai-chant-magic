// ws client that speaks the authoritative server's wire protocol
// (server/src/protocol.ts) EXACTLY. The client must not import across the server
// workspace boundary, so the message shapes are mirrored here; the field names
// (create / join{roomCode} / quickJoin / ready{value} / start / input{seq,move?,
// face?,casts?} / leave; joined{roomCode,selfId,players} / lobby{players} /
// started / snapshot{tick,world} / error{code,msg} / peerLeft{id}) must stay in
// lockstep with protocol.ts.
//
// Incoming snapshots are pushed into a SnapshotBuffer for ~100ms-behind
// interpolated rendering (spec §15.1 — no client prediction).

import { ClassId, SpellId, Vec2 } from '@acm/shared';
import { Snapshot, SnapshotBuffer } from './interp';

// --- wire types (mirror server/src/protocol.ts) ----------------------------

export interface LobbyPlayerView {
  id: string;
  name: string;
  classId: ClassId;
  ready: boolean;
  connected: boolean;
}

export type ErrorCode =
  | 'not-found'
  | 'full'
  | 'already-started'
  | 'server-full'
  | 'bad-message'
  | 'not-in-room'
  | 'not-host';

interface JoinedMsg {
  type: 'joined';
  roomCode: string;
  selfId: string;
  players: LobbyPlayerView[];
}
interface LobbyUpdateMsg {
  type: 'lobby';
  players: LobbyPlayerView[];
}
interface StartedMsg {
  type: 'started';
}
interface SnapshotMsg {
  type: 'snapshot';
  tick: number;
  world: Snapshot;
}
interface ErrorMsg {
  type: 'error';
  code: ErrorCode;
  msg: string;
}
interface PeerLeftMsg {
  type: 'peerLeft';
  id: string;
}
interface ChatBroadcastMsg {
  type: 'chat';
  from: string;
  text: string;
}
interface ReturnToLobbyMsg {
  type: 'returnToLobby';
}
type ServerMsg =
  | JoinedMsg
  | LobbyUpdateMsg
  | StartedMsg
  | SnapshotMsg
  | ErrorMsg
  | PeerLeftMsg
  | ChatBroadcastMsg
  | ReturnToLobbyMsg;

export interface NetCallbacks {
  onJoined?: (m: JoinedMsg) => void;
  onLobby?: (players: LobbyPlayerView[]) => void;
  onStarted?: () => void;
  onSnapshot?: (snap: Snapshot, tick: number) => void;
  onError?: (code: ErrorCode, msg: string) => void;
  onPeerLeft?: (id: string) => void;
  onChat?: (from: string, text: string) => void;
  onReturnToLobby?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
}

const DEFAULT_SERVER_URL = 'ws://localhost:8787';

// Resolve the server URL per spec §9 / §15.4:
//   ?server= query param  >  import.meta.env.VITE_SERVER_URL  >  ws://localhost:8787
export function resolveServerUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const q = new URLSearchParams(window.location.search).get('server');
    if (q) return q;
  }
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  if (env && env.VITE_SERVER_URL) return env.VITE_SERVER_URL;
  return DEFAULT_SERVER_URL;
}

// True when the page is served over HTTPS but no explicit ws server was
// configured — used by the lobby to show the §15.4 "set up server" hint.
export function needsServerSetup(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  const secure = window.location.protocol === 'https:';
  const hasQuery = !!new URLSearchParams(window.location.search).get('server');
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const hasEnv = !!(env && env.VITE_SERVER_URL);
  return secure && !hasQuery && !hasEnv;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  readonly buffer: SnapshotBuffer;
  selfId = '';
  roomCode = '';

  constructor(
    private cb: NetCallbacks = {},
    private url: string = resolveServerUrl(),
    bufferClock: () => number = () => Date.now(),
  ) {
    this.buffer = new SnapshotBuffer(bufferClock);
  }

  connect(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      // Constructor itself throws on a malformed URL — surface as a connect error.
      this.cb.onError?.('not-found', '無法連線到伺服器');
      this.cb.onClose?.();
      return;
    }
    this.ws = ws;
    ws.onopen = () => this.cb.onOpen?.();
    ws.onclose = () => this.cb.onClose?.();
    ws.onerror = () => {
      // ws does not give a useful reason in the browser; onClose follows.
      this.cb.onError?.('not-found', '無法連線到伺服器');
    };
    ws.onmessage = (ev: MessageEvent) => this.handle(String(ev.data));
  }

  private handle(raw: string): void {
    let m: ServerMsg;
    try {
      m = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    switch (m.type) {
      case 'joined':
        this.selfId = m.selfId;
        this.roomCode = m.roomCode;
        this.cb.onJoined?.(m);
        break;
      case 'lobby':
        this.cb.onLobby?.(m.players);
        break;
      case 'started':
        this.cb.onStarted?.();
        break;
      case 'snapshot':
        this.buffer.push(m.world);
        this.cb.onSnapshot?.(m.world, m.tick);
        break;
      case 'error':
        this.cb.onError?.(m.code, m.msg);
        break;
      case 'peerLeft':
        this.cb.onPeerLeft?.(m.id);
        break;
      case 'chat':
        this.cb.onChat?.(m.from, m.text);
        break;
      case 'returnToLobby':
        this.cb.onReturnToLobby?.();
        break;
    }
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // --- ClientMsg senders (field names per protocol.ts) ----------------------

  create(name: string, classId: ClassId): void {
    this.send({ type: 'create', name, classId });
  }

  join(name: string, classId: ClassId, roomCode: string): void {
    this.send({ type: 'join', name, classId, roomCode });
  }

  quickJoin(name: string, classId: ClassId): void {
    this.send({ type: 'quickJoin', name, classId });
  }

  ready(value: boolean): void {
    this.send({ type: 'ready', value });
  }

  // Change class while in the room lobby. The server broadcasts the updated
  // lobby to everyone (including us), so the member list reflects the change.
  setClass(classId: ClassId): void {
    this.send({ type: 'setClass', classId });
  }

  // Send a room chat line; the server stamps the sender and relays to everyone.
  sendChat(text: string): void {
    this.send({ type: 'chat', text });
  }

  start(): void {
    this.send({ type: 'start' });
  }

  // One input per frame: latest move/face + all queued casts (spec §15.1).
  input(move: Vec2 | null, face: number | null, casts: SpellId[]): void {
    const msg: { type: 'input'; seq: number; move?: Vec2; face?: number; casts?: SpellId[] } = {
      type: 'input',
      seq: this.seq++,
    };
    if (move) msg.move = move;
    if (face !== null) msg.face = face;
    if (casts.length) msg.casts = casts;
    this.send(msg);
  }

  leave(): void {
    this.send({ type: 'leave' });
  }

  close(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closing */
      }
      this.ws = null;
    }
  }
}
