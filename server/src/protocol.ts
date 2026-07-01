// Wire protocol between client and the authoritative ws server.
// All messages are JSON. Per spec §8 (Server section) and plan Task B1.
//
// The transient `effects` channel and player gameplay fields ride inside the
// `Snapshot` (see snapshot.ts), which is embedded in the `snapshot` ServerMsg.

import type { ClassId, SpellId, Vec2 } from '@acm/shared';
import type { Snapshot } from './snapshot';
import type { RoomStatus } from './room';

// ---------------------------------------------------------------------------
// Shared lobby view (sent inside `joined` / `lobby`)
// ---------------------------------------------------------------------------

export interface LobbyPlayerView {
  id: string;
  name: string;
  classId: ClassId;
  ready: boolean;
  connected: boolean;
}

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export interface CreateMsg {
  type: 'create';
  name: string;
  classId: ClassId;
}

export interface JoinMsg {
  type: 'join';
  name: string;
  classId: ClassId;
  roomCode: string;
}

export interface QuickJoinMsg {
  type: 'quickJoin';
  name: string;
  classId: ClassId;
}

export interface ReadyMsg {
  type: 'ready';
  value: boolean;
}

// Change class while still in the room lobby (before the game starts). Ignored
// by the server once the room has started (never change class mid-game).
export interface SetClassMsg {
  type: 'setClass';
  classId: ClassId;
}

// `start` is the host pressing the start button (spec §14: host starts, >=1 player).
export interface StartMsg {
  type: 'start';
}

// Per-tick intent. Server aggregates: latest move / latest face, ALL casts.
export interface InputMsg {
  type: 'input';
  seq: number;
  move?: Vec2;
  face?: number;
  casts?: SpellId[];
}

export interface LeaveMsg {
  type: 'leave';
}

// Room chat (lobby + in-game). Server stamps the sender + relays to the room.
export interface ChatMsg {
  type: 'chat';
  text: string;
}

// Host-only, valid only from room.status 'victory': continue the same run
// past the campaign instead of returning to the lobby (see Room.enterEndless).
export interface EnterEndlessMsg {
  type: 'enterEndless';
}

// Host-only: skip the victory decision window and return everyone to the
// lobby immediately, without waiting out VICTORY_DECISION_MS.
export interface SkipToLobbyMsg {
  type: 'skipToLobby';
}

// Host-only: end an in-progress endless run on demand (a "結束本輪" button),
// same effect as a party wipe (see Room.endEndless).
export interface EndEndlessMsg {
  type: 'endEndless';
}

// Join a room as a read-only observer — never occupies a player slot, and
// works at any room status (lobby/playing/gameover/victory), unlike join's
// already-started/full rejections. No classId: a spectator never plays.
export interface SpectateMsg {
  type: 'spectate';
  name: string;
  roomCode: string;
}

export type ClientMsg =
  | CreateMsg
  | JoinMsg
  | QuickJoinMsg
  | ReadyMsg
  | SetClassMsg
  | StartMsg
  | InputMsg
  | LeaveMsg
  | ChatMsg
  | EnterEndlessMsg
  | SkipToLobbyMsg
  | EndEndlessMsg
  | SpectateMsg;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface JoinedMsg {
  type: 'joined';
  roomCode: string;
  selfId: string;
  players: LobbyPlayerView[];
}

export interface LobbyUpdateMsg {
  type: 'lobby';
  players: LobbyPlayerView[];
}

export interface StartedMsg {
  type: 'started';
}

export interface SnapshotMsg {
  type: 'snapshot';
  tick: number;
  world: Snapshot;
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

export interface ErrorMsg {
  type: 'error';
  code: ErrorCode;
  msg: string;
}

export interface PeerLeftMsg {
  type: 'peerLeft';
  id: string;
}

// A chat line relayed to everyone in the room (server stamps `from`).
export interface ChatBroadcastMsg {
  type: 'chat';
  from: string;
  text: string;
}

// Sent when a finished game returns the room to its lobby (play again together).
export interface ReturnToLobbyMsg {
  type: 'returnToLobby';
}

// Broadcast to every client the instant the host enters endless mode, so a
// non-host client can react (e.g. show the "無盡模式啟動!" toast) even though
// it didn't send the enterEndless message itself.
export interface EndlessStartedMsg {
  type: 'endlessStarted';
}

// Reply to a successful `spectate` — carries the room's CURRENT status so a
// spectator joining mid-game (the common case) can render the right view
// immediately, without waiting for/relying on a `started` broadcast that may
// have already fired before they connected.
export interface SpectatingMsg {
  type: 'spectating';
  roomCode: string;
  selfId: string;
  status: RoomStatus;
  players: LobbyPlayerView[];
}

export type ServerMsg =
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

// ---------------------------------------------------------------------------
// Parsing helper (used by the thin ws wiring in index.ts / B2)
// ---------------------------------------------------------------------------

const CLIENT_MSG_TYPES: ReadonlySet<string> = new Set([
  'create',
  'join',
  'quickJoin',
  'ready',
  'setClass',
  'start',
  'input',
  'leave',
  'chat',
  'enterEndless',
  'skipToLobby',
  'endEndless',
  'spectate',
]);

export function parseClientMsg(raw: string): ClientMsg | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { type?: unknown }).type !== 'string' ||
    !CLIENT_MSG_TYPES.has((parsed as { type: string }).type)
  ) {
    return null;
  }
  return parsed as ClientMsg;
}
