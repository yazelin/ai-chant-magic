import { ClassId, CLASSES, SPELLS } from '@acm/shared';
import { GameSession } from '../session/GameSession';
import { LocalSession } from '../session/LocalSession';
import { NetSession } from '../session/NetSession';
import {
  NetClient,
  LobbyPlayerView,
  ErrorCode,
  resolveServerUrl,
  needsServerSetup,
} from '../net/NetClient';

const CLASS_ORDER: ClassId[] = ['pyro', 'cryo', 'storm', 'warden'];

// A simple glyph per class shape (the in-game render uses real polygons; the
// lobby card just needs a recognizable hint of the placeholder shape).
const SHAPE_GLYPH: Record<string, string> = {
  diamond: '◆',
  hexagon: '⬢',
  triangle: '▲',
  circle: '●',
};

const ERROR_TEXT: Record<ErrorCode, string> = {
  'not-found': '找不到該房間代碼',
  full: '房間已滿(上限 4 人)',
  'already-started': '該房間已經開始遊戲',
  'server-full': '伺服器房間已滿,請稍後再試',
  'bad-message': '訊息格式錯誤',
  'not-in-room': '你不在任何房間中',
  'not-host': '只有房主可以開始遊戲',
};

// Lobby owns the dark-arcane DOM over the canvas area, the class pick, and the
// create/join/quick-join/solo flow. When a game is ready to start it calls
// `onStart(session, classId)` — the caller wires the session into GameScene.
// For solo it hands back a LocalSession; for net it hands back a NetSession over
// an already-`started` NetClient.
export class Lobby {
  private root: HTMLElement;
  private name = '';
  private classId: ClassId = 'pyro';
  private client: NetClient | null = null;
  private members: LobbyPlayerView[] = [];
  private roomCode = '';
  private isHost = false;
  private selfReady = false;

  constructor(private onStart: (session: GameSession, classId: ClassId) => void) {
    this.root = document.getElementById('lobby')!;
    this.renderSetup();
  }

  // --- Setup screen: name + class pick + action buttons ---------------------
  private renderSetup(errorMsg?: string): void {
    this.teardownClient();
    const showSetupHint = needsServerSetup();

    this.root.innerHTML = `
      <h1>真。AI。咏唱魔法</h1>
      <div class="sub">語音咏唱 · 2–4 人連線 co-op · 暗黑秘術</div>
      <label for="lobby-name">召喚師名稱</label>
      <input id="lobby-name" type="text" maxlength="16" placeholder="輸入你的名字" value="${escapeHtml(this.name)}" />
      <label>選擇職業</label>
      <div class="class-cards" id="lobby-classes"></div>
      <div class="btns">
        <button id="btn-create" class="primary">建立房間</button>
        <button id="btn-join">輸入代碼加入</button>
        <button id="btn-quick">快速加入</button>
        <button id="btn-solo">單機</button>
      </div>
      <div class="error" id="lobby-error">${errorMsg ? escapeHtml(errorMsg) : ''}</div>
      ${
        showSetupHint
          ? `<div class="hint">此頁面為 HTTPS 但未設定伺服器。請以 <code>?server=wss://…</code> 指定伺服器,或直接「單機」遊玩。</div>`
          : ''
      }
    `;

    const nameEl = this.root.querySelector<HTMLInputElement>('#lobby-name')!;
    nameEl.addEventListener('input', () => {
      this.name = nameEl.value;
    });

    this.renderClassCards();

    this.root.querySelector('#btn-create')!.addEventListener('click', () => this.doNet('create'));
    this.root.querySelector('#btn-join')!.addEventListener('click', () => this.doJoinByCode());
    this.root.querySelector('#btn-quick')!.addEventListener('click', () => this.doNet('quickJoin'));
    this.root.querySelector('#btn-solo')!.addEventListener('click', () => this.startSolo());
  }

  private renderClassCards(): void {
    const host = this.root.querySelector('#lobby-classes')!;
    host.innerHTML = '';
    for (const id of CLASS_ORDER) {
      const def = CLASSES[id];
      const card = document.createElement('div');
      card.className = 'class-card' + (id === this.classId ? ' selected' : '');
      card.style.color = def.color;
      const spellNames = def.spells.map((s) => SPELLS[s].displayName).join('、');
      card.innerHTML = `
        <div class="glyph">${SHAPE_GLYPH[def.shape] ?? '◆'}</div>
        <div class="cname" style="color:${def.color}">${def.displayName}</div>
        <div class="spells">${escapeHtml(spellNames)}</div>
      `;
      card.addEventListener('click', () => {
        this.classId = id;
        this.renderClassCards();
      });
      host.appendChild(card);
    }
  }

  private effectiveName(): string {
    const n = this.name.trim();
    return n.length ? n : '召喚師';
  }

  // --- Solo ----------------------------------------------------------------
  private startSolo(): void {
    const session = new LocalSession(this.classId);
    this.hide();
    this.onStart(session, this.classId);
  }

  // --- Net: create / quickJoin ---------------------------------------------
  private doNet(kind: 'create' | 'quickJoin'): void {
    const url = resolveServerUrl();
    const client = new NetClient(
      {
        onOpen: () => {
          if (kind === 'create') client.create(this.effectiveName(), this.classId);
          else client.quickJoin(this.effectiveName(), this.classId);
        },
        onJoined: (m) => {
          this.client = client;
          this.roomCode = m.roomCode;
          this.members = m.players;
          // Host = the first player in the room (i.e. self created it). Server
          // enforces not-host on start; we just gate the button UX here.
          this.isHost = m.players.length > 0 && m.players[0].id === m.selfId;
          this.renderRoom();
        },
        onLobby: (players) => {
          this.members = players;
          if (this.roomCode) this.renderRoom();
        },
        onStarted: () => this.beginNetGame(client),
        onError: (code) => this.handleNetError(code),
        onPeerLeft: () => {
          /* lobby list refresh arrives via onLobby */
        },
        onClose: () => this.handleDisconnect(),
      },
      url,
    );
    this.client = client;
    this.showConnecting();
    client.connect();
  }

  private doJoinByCode(): void {
    const code = window.prompt('輸入房間代碼(4 碼):');
    if (!code) return;
    const roomCode = code.trim().toUpperCase();
    if (!roomCode) return;
    const url = resolveServerUrl();
    const client = new NetClient(
      {
        onOpen: () => client.join(this.effectiveName(), this.classId, roomCode),
        onJoined: (m) => {
          this.client = client;
          this.roomCode = m.roomCode;
          this.members = m.players;
          this.isHost = m.players.length > 0 && m.players[0].id === m.selfId;
          this.renderRoom();
        },
        onLobby: (players) => {
          this.members = players;
          if (this.roomCode) this.renderRoom();
        },
        onStarted: () => this.beginNetGame(client),
        onError: (errCode) => this.handleNetError(errCode),
        onPeerLeft: () => {
          /* refresh via onLobby */
        },
        onClose: () => this.handleDisconnect(),
      },
      url,
    );
    this.client = client;
    this.showConnecting();
    client.connect();
  }

  private beginNetGame(client: NetClient): void {
    const session = new NetSession(client);
    this.hide();
    this.onStart(session, this.classId);
  }

  private handleNetError(code: ErrorCode): void {
    // A lobby/room error: drop back to setup with a clear message; solo stays
    // available (spec §10).
    this.teardownClient();
    this.roomCode = '';
    this.renderSetup(ERROR_TEXT[code] ?? '發生未知錯誤');
  }

  private handleDisconnect(): void {
    // If we never made it into a room, this is a failed connection.
    if (!this.roomCode) {
      this.renderSetup('無法連線到伺服器(請確認網址 / 伺服器是否啟動)。你仍可選擇「單機」。');
    } else {
      // Lost connection while in the lobby (not yet started).
      this.renderSetup('與伺服器的連線中斷。你仍可選擇「單機」。');
      this.roomCode = '';
    }
  }

  private teardownClient(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  // --- Connecting / Room screens -------------------------------------------
  private showConnecting(): void {
    this.root.innerHTML = `
      <h1>連線中…</h1>
      <div class="sub">正在喚醒伺服器(免費伺服器冷啟動可能需要數秒)…</div>
      <div class="btns"><button id="btn-cancel">取消</button></div>
    `;
    this.root.querySelector('#btn-cancel')!.addEventListener('click', () => this.renderSetup());
  }

  private renderRoom(): void {
    const memberItems = this.members
      .map((p) => {
        const cls = CLASSES[p.classId]?.displayName ?? p.classId;
        const state = p.ready
          ? '<span class="ready">已準備</span>'
          : '<span class="waiting">等待中</span>';
        const self = this.client && p.id === this.client.selfId ? '(你)' : '';
        return `<li><span>${escapeHtml(p.name)}${self} · ${cls}</span>${state}</li>`;
      })
      .join('');

    this.root.innerHTML = `
      <h1>房間大廳</h1>
      <div class="code-banner">
        <div class="sub">把這組代碼給隊友</div>
        <div class="code">${escapeHtml(this.roomCode)}</div>
      </div>
      <label>成員(${this.members.length}/4)</label>
      <ul class="members">${memberItems}</ul>
      <label>更換職業</label>
      <div class="class-cards" id="room-classes"></div>
      <div class="btns">
        ${
          this.isHost
            ? `<button id="btn-start" class="primary">開始</button>`
            : `<button id="btn-ready">${this.selfReady ? '取消準備' : '準備'}</button>`
        }
        <button id="btn-leave">離開房間</button>
      </div>
      <div class="error" id="lobby-error"></div>
    `;

    if (this.isHost) {
      this.root.querySelector('#btn-start')!.addEventListener('click', () => {
        this.client?.start();
      });
    } else {
      this.root.querySelector('#btn-ready')!.addEventListener('click', () => {
        this.selfReady = !this.selfReady;
        this.client?.ready(this.selfReady);
        this.renderRoom();
      });
    }
    this.root.querySelector('#btn-leave')!.addEventListener('click', () => {
      this.client?.leave();
      this.teardownClient();
      this.roomCode = '';
      this.renderSetup();
    });

    this.renderRoomClassCards();
  }

  // In-room class picker. Reuses the setup screen's .class-cards/.class-card
  // markup, highlights the local player's current class, and on click tells the
  // server (which broadcasts an updated lobby so EVERYONE — including us — sees
  // the new class in the member list). `this.classId` is the source of truth the
  // game start uses for the voice loadout, so updating it here means the game we
  // start reflects the latest in-room selection.
  private renderRoomClassCards(): void {
    const host = this.root.querySelector('#room-classes');
    if (!host) return;
    host.innerHTML = '';
    for (const id of CLASS_ORDER) {
      const def = CLASSES[id];
      const card = document.createElement('div');
      card.className = 'class-card' + (id === this.classId ? ' selected' : '');
      card.style.color = def.color;
      const spellNames = def.spells.map((s) => SPELLS[s].displayName).join('、');
      card.innerHTML = `
        <div class="glyph">${SHAPE_GLYPH[def.shape] ?? '◆'}</div>
        <div class="cname" style="color:${def.color}">${def.displayName}</div>
        <div class="spells">${escapeHtml(spellNames)}</div>
      `;
      card.addEventListener('click', () => {
        if (id === this.classId) return;
        this.classId = id;
        this.client?.setClass(id);
        this.renderRoomClassCards();
      });
      host.appendChild(card);
    }
  }

  private hide(): void {
    this.root.style.display = 'none';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
