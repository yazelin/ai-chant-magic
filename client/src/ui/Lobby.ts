import { ClassId, CLASSES, SPELLS, SpellId, matchSpell, JUMON } from '@acm/shared';
import { SKILL_INFO } from './skillInfo';
import { SHEET_WALKERS } from '../render/walkSheets';
import { WebSpeechVoiceInput } from '../voice/recognizer';
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

// Random default summoner handles — meme/joke names riffing on this game's
// "shout the spell name to cast" gimmick. NOT anime character names, so the
// handle never clashes with the character you control.
const RANDOM_NAMES = [
  // 通用「吼叫詠唱」梗
  '嘴砲法師', '純靠吼', '詠唱中勿擾', '法術冷卻中', '喉嚨已陣亡', '收音不良',
  '麥克風測試中', '隊友剋星', '安全距離大師', '我先撤退', '喊不準協會',
  '今天也很大聲', '別吵我詠唱', '等我喝口水', '戰術性後仰', '用吼的就贏',
  // 為美好世界(惠惠)
  '每日一爆', '沒用女神', '抖M十字騎士',
  // Re:Zero(愛蜜莉雅)
  '死亡回歸', '從零開始', '蹲下來談談',
  // 科學超電磁砲(御坂美琴)
  '嗶哩嗶哩', '這份不幸', '三萬個妹妹',
  // Fate(貞德)
  '人被殺就會死', '身體由劍構成', '誓約勝利之劍',
];
function randomName(): string {
  return RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
}

// Character names shown on the home cards (flavour); the class role (CLASSES
// displayName) stays the system name used in-game and the room list.
const CHAR_NAMES: Record<ClassId, string> = {
  pyro: '惠惠',
  cryo: '愛蜜莉雅',
  storm: '御坂美琴',
  warden: '貞德',
};

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
  // Chant-practice voice input (lazy; lives across re-renders of the setup screen)
  private voice: WebSpeechVoiceInput | null = null;
  private practicing = false;
  private hitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private onStart: (session: GameSession, classId: ClassId) => void) {
    this.root = document.getElementById('lobby')!;
    this.name = randomName(); // a fun default; player can edit or re-roll
    this.renderSetup();
  }

  // --- Setup screen: name + class pick + action buttons ---------------------
  private renderSetup(errorMsg?: string): void {
    this.teardownClient();
    const showSetupHint = needsServerSetup();

    this.root.innerHTML = `
      <h1>真。AI。咏唱魔法</h1>
      <div class="sub">語音咏唱 · 2–4 人連線 co-op · 暗黑秘術 · 點角色卡選擇職業</div>
      <div class="showcase">
        <div id="lobby-showcase" style="display:contents"></div>
        <div class="center-panel">
          <label for="lobby-name">召喚師名稱</label>
          <div class="name-row">
            <input id="lobby-name" type="text" maxlength="16" placeholder="輸入你的名字" value="${escapeHtml(this.name)}" />
            <button id="btn-reroll" title="隨機換一個名字">換一個</button>
          </div>
          <div class="practice">
            <button id="btn-mic">開始詠唱練習</button>
            <div class="mic-state" id="mic-state">點上方按鈕開麥克風,對著它喊任一招式名</div>
            <div class="heard-wrap">
              <div class="heard-label">聽到</div>
              <div class="heard" id="heard">—</div>
            </div>
            <div class="hit" id="hit"></div>
          </div>
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
        </div>
      </div>
    `;

    const nameEl = this.root.querySelector<HTMLInputElement>('#lobby-name')!;
    nameEl.addEventListener('input', () => {
      this.name = nameEl.value;
    });
    this.root.querySelector('#btn-reroll')!.addEventListener('click', () => {
      this.name = randomName();
      nameEl.value = this.name;
    });

    this.renderShowcase();
    this.wirePractice();

    this.root.querySelector('#btn-create')!.addEventListener('click', () => this.doNet('create'));
    this.root.querySelector('#btn-join')!.addEventListener('click', () => this.doJoinByCode());
    this.root.querySelector('#btn-quick')!.addEventListener('click', () => this.doNet('quickJoin'));
    this.root.querySelector('#btn-solo')!.addEventListener('click', () => this.startSolo());
  }

  // --- Chant practice: mic → live transcript → highlight the matched skill ---
  private wirePractice(): void {
    const btn = this.root.querySelector<HTMLButtonElement>('#btn-mic');
    if (!btn) return;
    btn.addEventListener('click', () => this.togglePractice());
    // reflect current state if the setup screen re-rendered mid-practice
    btn.textContent = this.practicing ? '停止練習' : '開始詠唱練習';
    btn.classList.toggle('primary', !this.practicing);
  }

  private togglePractice(): void {
    if (!this.voice) {
      this.voice = new WebSpeechVoiceInput('zh-TW');
      this.voice.onStatusChange((s, msg) => {
        const el = this.root.querySelector('#mic-state');
        if (el) el.textContent = msg ?? (s === 'listening' ? '聆聽中…喊出招式名' : s);
      });
      this.voice.onTranscript((text) => this.onPracticeTranscript(text));
    }
    this.practicing = !this.practicing;
    if (this.practicing) this.voice.start();
    else this.voice.stop();
    const btn = this.root.querySelector<HTMLButtonElement>('#btn-mic');
    if (btn) {
      btn.textContent = this.practicing ? '停止練習' : '開始詠唱練習';
      btn.classList.toggle('primary', !this.practicing);
    }
  }

  private onPracticeTranscript(text: string): void {
    const heard = this.root.querySelector('#heard');
    if (heard) heard.textContent = text || '—';
    const id = matchSpell(text, { mode: 'mueisho', jumon: JUMON });
    if (id) this.flashHit(id);
  }

  private flashHit(id: SpellId): void {
    const hit = this.root.querySelector('#hit');
    if (hit) hit.textContent = `命中 「${SKILL_INFO[id].name}」!`;
    const els = this.root.querySelectorAll<HTMLElement>(`.skill[data-spell="${id}"]`);
    els.forEach((e) => {
      e.classList.add('hit');
      // play a spell burst on that character's card sprite
      const fx = e.closest('.char-card')?.querySelector<HTMLElement>('.fx');
      if (fx) {
        fx.classList.remove('go');
        void fx.offsetWidth; // reflow so the animation restarts
        fx.classList.add('go');
      }
    });
    if (this.hitTimer) clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => {
      els.forEach((e) => e.classList.remove('hit'));
      const h = this.root.querySelector('#hit');
      if (h) h.textContent = '';
    }, 900);
  }

  private stopPractice(): void {
    this.practicing = false;
    if (this.voice) this.voice.stop();
  }

  // Home showcase: one animated card per class in the four corners. The card
  // walks (CSS sprite animation over the walk sheet), shows the class name, and
  // lists its 3 skills with effect + live numbers (from SKILL_INFO). Clicking a
  // card selects that class for the game we start.
  private renderShowcase(): void {
    const host = this.root.querySelector('#lobby-showcase');
    if (!host) return;
    host.innerHTML = '';
    const AREA: Record<ClassId, string> = { pyro: 'a', cryo: 'b', storm: 'c', warden: 'd' };
    for (const id of CLASS_ORDER) {
      const def = CLASSES[id];
      const sw = SHEET_WALKERS[id];
      const card = document.createElement('div');
      card.className = 'char-card' + (id === this.classId ? ' selected' : '');
      card.style.color = def.color;
      card.style.gridArea = AREA[id];
      const skills = def.spells
        .map((s) => {
          const k = SKILL_INFO[s];
          return `<li class="skill" data-spell="${s}"><div class="chant">「${escapeHtml(k.name)}」</div><div class="se">${escapeHtml(k.effect)}</div><div class="ss">${escapeHtml(k.stats)}</div></li>`;
        })
        .join('');
      let sprite = '';
      if (sw) {
        const dur = (sw.frames / 9).toFixed(2); // ≈9fps, close to in-game 10
        sprite = `background-image:url(${sw.url});background-size:${sw.frames * 96}px 96px;animation:walk${sw.frames} ${dur}s steps(${sw.frames}) infinite`;
      }
      card.innerHTML = `
        <div class="sprite-box"><div class="walk-sprite" style="${sprite}"></div><div class="fx"></div></div>
        <div class="cname" style="color:${def.color}">${escapeHtml(CHAR_NAMES[id])}</div>
        <div class="crole">${escapeHtml(def.displayName)}</div>
        <div class="chant-hint">▸ 喊出招式名即可施法</div>
        <ul class="skills">${skills}</ul>
      `;
      card.addEventListener('click', () => {
        this.classId = id;
        this.renderShowcase();
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
        // Optimistically reflect our own pick in the local member list right
        // away, instead of waiting a round-trip for the server's `lobby`
        // broadcast (which then confirms/converges). Match the self member by
        // selfId; if that isn't available yet, leave the list as-is.
        const selfId = this.client?.selfId;
        if (selfId) {
          const self = this.members.find((m) => m.id === selfId);
          if (self) self.classId = id;
        }
        this.renderRoom();
      });
      host.appendChild(card);
    }
  }

  private hide(): void {
    this.stopPractice(); // don't let the practice mic run into the game's own mic
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
