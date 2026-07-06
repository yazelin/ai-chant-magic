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
  | 'not-host'
  | 'not-victory'
  | 'not-endless'
  | 'spectator-readonly';

export type RoomStatus = 'lobby' | 'playing' | 'gameover' | 'victory';

interface JoinedMsg {
  type: 'joined';
  roomCode: string;
  selfId: string;
  players: LobbyPlayerView[];
  hostId: string | null;
}
interface LobbyUpdateMsg {
  type: 'lobby';
  players: LobbyPlayerView[];
  hostId: string | null;
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
interface EndlessStartedMsg {
  type: 'endlessStarted';
}
interface SpectatingMsg {
  type: 'spectating';
  roomCode: string;
  selfId: string;
  status: RoomStatus;
  players: LobbyPlayerView[];
  hostId: string | null;
}
type ServerMsg =
  | JoinedMsg
  | LobbyUpdateMsg
  | StartedMsg
  | SnapshotMsg
  | ErrorMsg
  | PeerLeftMsg
  | ChatBroadcastMsg
  | ReturnToLobbyMsg
  | EndlessStartedMsg
  | SpectatingMsg;

export interface NetCallbacks {
  onJoined?: (m: JoinedMsg) => void;
  onLobby?: (players: LobbyPlayerView[], hostId: string | null) => void;
  onStarted?: () => void;
  onSnapshot?: (snap: Snapshot, tick: number) => void;
  onError?: (code: ErrorCode, msg: string) => void;
  onPeerLeft?: (id: string) => void;
  onChat?: (from: string, text: string) => void;
  onReturnToLobby?: () => void;
  onEndlessStarted?: () => void;
  onSpectating?: (m: SpectatingMsg) => void;
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

// Fire-and-forget: ping the server's /healthz the moment the page loads (well
// before any multiplayer button is clicked), so a Render free-tier cold start
// (measured 90-200+s in practice, far past the old "數秒" copy) has a head
// start by the time a player actually decides to connect. Never awaited,
// never surfaces an error — worst case it's a no-op wasted request.
export function prewarmServer(): void {
  try {
    const url = resolveServerUrl().replace(/^ws/, 'http');
    void fetch(`${url}/healthz`).catch(() => {});
  } catch {
    /* ignore — best effort only */
  }
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
        this.cb.onLobby?.(m.players, m.hostId);
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
      case 'endlessStarted':
        this.cb.onEndlessStarted?.();
        break;
      case 'spectating':
        this.cb.onSpectating?.(m);
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

  // Join as a read-only observer — no classId, works at any room status.
  spectate(name: string, roomCode: string): void {
    this.send({ type: 'spectate', name, roomCode });
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

  // One input per frame: latest move/face + all queued casts (spec §15.1) +
  // an optional one-shot 共鳴詠唱 call flag.
  input(move: Vec2 | null, face: number | null, casts: SpellId[], resonance = false): void {
    const msg: {
      type: 'input'; seq: number; move?: Vec2; face?: number; casts?: SpellId[]; resonance?: boolean;
    } = {
      type: 'input',
      seq: this.seq++,
    };
    if (move) msg.move = move;
    if (face !== null) msg.face = face;
    if (casts.length) msg.casts = casts;
    if (resonance) msg.resonance = true;
    this.send(msg);
  }

  leave(): void {
    this.send({ type: 'leave' });
  }

  // Host-only; the server rejects these (not-host/not-victory/not-endless) if
  // sent out of turn — see server/src/protocol.ts.
  enterEndless(): void {
    this.send({ type: 'enterEndless' });
  }

  skipToLobby(): void {
    this.send({ type: 'skipToLobby' });
  }

  endEndless(): void {
    this.send({ type: 'endEndless' });
  }

  close(): void {
    if (this.ws) {
      // Unbind BEFORE closing: WebSocket.close() fires 'close' asynchronously
      // (the closing handshake), and without this, an intentional close (e.g.
      // Lobby's handleNetError() tearing the client down right after handling
      // an 'already-started' error) still fires onClose a moment later —
      // which calls handleDisconnect() and clobbers whatever screen
      // handleNetError() just rendered with a generic "無法連線到伺服器".
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* already closing */
      }
      this.ws = null;
    }
  }
}
