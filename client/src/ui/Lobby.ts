import { ClassId, CLASSES, SpellId, matchSpell } from '@acm/shared';
import { SKILL_INFO } from './skillInfo';
import { skillIconSvg } from './skillIcons';
import { chantFor, setChant, chantsAsExtra } from '../customChants';
import { SHEET_WALKERS } from '../render/walkSheets';
import { WebSpeechVoiceInput } from '../voice/recognizer';
import { GameSession } from '../session/GameSession';
import { LocalSession } from '../session/LocalSession';
import { NetSession } from '../session/NetSession';
import { SpectatorSession } from '../session/SpectatorSession';
import {
  NetClient,
  LobbyPlayerView,
  ErrorCode,
  resolveServerUrl,
  needsServerSetup,
  prewarmServer,
} from '../net/NetClient';
import { loadRecord, isEndlessUnlocked } from '../session/endlessRecords';
import { weeklyRng, daysUntilWeeklyReset } from '../session/weeklyChallenge';

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

// Each character's source world — shown as a label + a themed image backdrop so
// the multi-world nature reads at a glance. The old gradients remain as
// translucent overlays to keep text/sprites readable on top of the artwork.
const WORLD_NAME: Record<ClassId, string> = {
  pyro: '為美好世界',
  cryo: 'Re:Zero 異世界',
  storm: '學園都市',
  warden: '聖杯戰爭 · 現代',
};
const WORLD_BG_IMAGE: Record<ClassId, string> = {
  pyro: new URL('../assets/lobby-bg-pyro.png', import.meta.url).href,
  cryo: new URL('../assets/lobby-bg-cryo.png', import.meta.url).href,
  storm: new URL('../assets/lobby-bg-storm.png', import.meta.url).href,
  warden: new URL('../assets/lobby-bg-warden.png', import.meta.url).href,
};
const WORLD_BG_OVERLAY: Record<ClassId, string> = {
  pyro: 'radial-gradient(100% 70% at 50% 0%, rgba(255,170,60,0.32), transparent 60%), linear-gradient(165deg,rgba(34,48,26,0.58),rgba(18,22,12,0.72))',
  cryo: 'radial-gradient(100% 70% at 50% 0%, rgba(120,200,255,0.32), transparent 60%), linear-gradient(165deg,rgba(22,39,58,0.56),rgba(12,20,32,0.74))',
  storm: 'radial-gradient(100% 70% at 50% 0%, rgba(176,108,255,0.34), transparent 60%), linear-gradient(165deg,rgba(34,26,58,0.56),rgba(16,12,30,0.74))',
  warden: 'radial-gradient(100% 70% at 50% 0%, rgba(255,210,77,0.30), transparent 60%), linear-gradient(165deg,rgba(42,36,24,0.58),rgba(20,18,12,0.74))',
};
const worldBackground = (id: ClassId): string => `${WORLD_BG_OVERLAY[id]}, url("${WORLD_BG_IMAGE[id]}")`;

const ERROR_TEXT: Record<ErrorCode, string> = {
  'not-found': '找不到該房間代碼',
  full: '房間已滿(上限 4 人)',
  'already-started': '該房間已經開始遊戲',
  'server-full': '伺服器房間已滿,請稍後再試',
  'bad-message': '訊息格式錯誤',
  'not-in-room': '你不在任何房間中',
  'not-host': '只有房主可以開始遊戲',
  // These two only ever fire from the in-game victory screen (enterEndless/
  // endEndless), never from the lobby — kept here only so this map stays
  // exhaustive over ErrorCode. Hud.ts handles the real user-facing surfacing.
  'not-victory': '無盡模式只能在通關畫面開啟',
  'not-endless': '目前不在無盡模式中',
  // Only ever fires if a spectator's client somehow sends a mutating message
  // (defense in depth — the spectator UI never wires up controls that would).
  'spectator-readonly': '觀戰者無法操作遊戲',
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
  private selectedSkill: SpellId | null = null;
  private client: NetClient | null = null;
  private members: LobbyPlayerView[] = [];
  private roomCode = '';
  private isHost = false;
  private isSpectating = false;
  private selfReady = false;
  private chatLog: { from: string; text: string }[] = []; // room chat history
  private chatVoice: WebSpeechVoiceInput | null = null; // one-shot dictation for chat
  private returnFn: (() => void) | null = null; // main.ts game teardown (net return-to-lobby)
  // Generic input-modal (join-by-code / edit-chant) — replaces window.prompt()
  // for the two highest-value first-time actions, matching the rest of this
  // UI's custom dark theme instead of dropping into an unstyled OS dialog.
  // The DOM's click/keydown handlers are wired ONCE per screen render
  // (wireInputModal(), same pattern as wirePractice()); showInputModal() just
  // updates this callback + the modal's text, so repeated calls never stack
  // up duplicate listeners.
  private inputModalSubmit: ((value: string) => void) | null = null;
  // The room code from the most recent join attempt — lets handleNetError's
  // 'already-started' case offer a one-click switch to spectating that same
  // room instead of just dead-ending (this.roomCode itself is only set on a
  // SUCCESSFUL join, so it's already empty by the time the error fires).
  private lastJoinAttemptCode = '';
  // Chant-practice voice input (lazy; lives across re-renders of the setup screen)
  private voice: WebSpeechVoiceInput | null = null;
  private practicing = false;
  private hitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private onStart: (
      session: GameSession,
      classId: ClassId,
      solo: boolean,
      isHost: boolean,
      spectator?: boolean,
      weeklyChallenge?: boolean,
      playerName?: string,
    ) => void,
  ) {
    this.root = document.getElementById('lobby')!;
    this.name = randomName(); // a fun default; player can edit or re-roll
    // Fire the moment the page loads, well before anyone clicks a multiplayer
    // button — gives Render's free-tier cold start (measured 90-200+s) a head
    // start against however long a visitor spends reading the lobby first.
    prewarmServer();
    // A friend clicking an invite link (?join=CODE) drops straight into the
    // room with zero clicks — no code to type or read aloud. They can still
    // change name/class once inside (the room view's picker already supports
    // that), so defaults here are fine. ?watch=CODE is the same idea for a 5th
    // friend who just wants to spectate (no player slot needed, no waiting).
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('join');
    const watchCode = params.get('watch');
    // Dev-only 訓練假人 (see main.ts's setupTrainingDummy): ?dummy=1 skips
    // straight to solo so a tester doesn't have to click through the lobby
    // every time; ?class=cryo etc. picks which class's spell is the "second
    // hit" (invalid/absent falls back to the default pyro).
    const dummyMode = import.meta.env.DEV && params.has('dummy');
    const dummyClass = params.get('class') as ClassId | null;
    if (watchCode && watchCode.trim()) {
      this.doSpectate(watchCode.trim().toUpperCase());
    } else if (inviteCode && inviteCode.trim()) {
      this.doJoinByCode(inviteCode.trim().toUpperCase());
    } else if (dummyMode) {
      if (dummyClass && dummyClass in CLASSES) this.classId = dummyClass;
      this.startSolo();
    } else {
      this.renderSetup();
    }
  }

  // --- Setup screen: name + class pick + action buttons ---------------------
  // errorAction: an optional actionable follow-up next to the error text —
  // e.g. a stale ?join=CODE link for a room that already started used to just
  // dead-end here with "該房間已經開始遊戲" and nothing else to do; offering
  // ?watch=CODE's spectate flow instead turns that dead end into a real path.
  private renderSetup(errorMsg?: string, errorAction?: { label: string; onClick: () => void }): void {
    this.teardownClient();
    this.isSpectating = false;
    const showSetupHint = needsServerSetup();

    this.root.innerHTML = `
      <h1>真。AI。咏唱魔法</h1>
      <div class="sub"><b class="voice-hook">對著麥克風喊出技能名稱施法</b> · 2–4 人連線 co-op · 點四角的角色卡選擇,中央查看技能</div>
      <div class="showcase">
        <div id="lobby-showcase" style="display:contents"></div>
        <div class="center-panel">
          <div id="center-skills" class="center-skills"></div>
          <div class="name-row">
            <input id="lobby-name" type="text" maxlength="16" placeholder="輸入你的名字" value="${escapeHtml(this.name)}" />
            <button id="btn-reroll" title="隨機換一個名字">換一個</button>
            <button id="btn-practice-open" class="practice-open" title="開麥克風練習詠唱">練習</button>
          </div>
          <div class="btns">
            <button id="btn-create" class="primary">建立房間</button>
            <button id="btn-join">輸入代碼加入</button>
            <button id="btn-quick">快速加入</button>
            <button id="btn-solo">單機</button>
            <button id="btn-weekly" title="本週固定種子,人人遇到一樣的怪,擊敗後看排行榜(還剩 ${daysUntilWeeklyReset()} 天更新)">本週挑戰</button>
            ${
              isEndlessUnlocked()
                ? '<button id="btn-endless" title="直接開始無盡模式,不用重打一次4章戰役">無盡模式</button>'
                : ''
            }
          </div>
          <div class="error" id="lobby-error">${errorMsg ? escapeHtml(errorMsg) : ''}${
            errorAction
              ? ` · <button id="lobby-error-action" class="link-btn" type="button">${escapeHtml(errorAction.label)}</button>`
              : ''
          }</div>
          ${
            showSetupHint
              ? `<div class="hint">此頁面為 HTTPS 但未設定伺服器。請以 <code>?server=wss://…</code> 指定伺服器,或直接「單機」遊玩。</div>`
              : ''
          }
        </div>
      </div>
      ${this.practiceModalHtml()}
      ${this.inputModalHtml()}
      <div class="foot">
      <div class="social">
        <a href="https://github.com/yazelin/ai-chant-magic" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.8 18 5.1 18 5.1c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/></svg>GitHub</a>
        <a href="https://www.facebook.com/yaze.lin.gm" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/></svg>Facebook</a>
        <a class="coffee" href="https://buymeacoffee.com/yazelin" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h12v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M17 9h2a2 2 0 0 1 0 4h-2"/><path d="M7 4v2M11 4v2M15 4v2"/></svg>支持開發者</a>
      </div>
      <div class="disclaimer" title="非官方同人二創 · 非商業作品。惠惠 / 愛蜜莉雅 / 御坂美琴 / 貞德 等角色及其原作世界版權均屬各原作者與發行商所有,本作與其無任何關聯;如版權方有疑慮,聯絡即下架。">非官方同人二創 · 非商業作品。角色及原作世界版權均屬各原作者與發行商;如版權方有疑慮聯絡即下架。</div>
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
    this.wireInputModal();

    this.root.querySelector('#btn-create')!.addEventListener('click', () => this.doNet('create'));
    this.root.querySelector('#btn-join')!.addEventListener('click', () => this.doJoinByCode());
    this.root.querySelector('#btn-quick')!.addEventListener('click', () => this.doNet('quickJoin'));
    this.root.querySelector('#btn-solo')!.addEventListener('click', () => this.startSolo());
    this.root.querySelector('#btn-weekly')!.addEventListener('click', () => this.startWeeklyChallenge());
    this.root.querySelector('#btn-endless')?.addEventListener('click', () => this.startEndless());
    if (errorAction) {
      this.root.querySelector('#lobby-error-action')!.addEventListener('click', errorAction.onClick);
    }
  }

  // Practice lives in a FLOATING modal (position:fixed) — on a fixed no-scroll
  // page an inline/expanding panel gets clipped off short phones, so it must
  // overlay the viewport instead. Shared markup for home + room.
  // Generic small input modal — join-by-code / edit-chant word both used
  // window.prompt() before, an unstyled OS dialog jarring next to this
  // otherwise fully custom dark UI (worse on mobile). Same shell (.practice-
  // modal/.pm-card) as the practice modal above. Static handlers wired once
  // by wireInputModal(); showInputModal() only updates text + the callback.
  private inputModalHtml(): string {
    return `
      <div id="input-modal" class="practice-modal" hidden>
        <div class="pm-card">
          <button id="im-close" class="pm-close" type="button" aria-label="關閉">×</button>
          <div class="pm-title" id="im-title"></div>
          <div class="pm-sub" id="im-sub"></div>
          <input id="im-input" type="text" maxlength="24" />
          <div class="btns">
            <button id="im-cancel" type="button">取消</button>
            <button id="im-ok" class="primary" type="button">確定</button>
          </div>
        </div>
      </div>`;
  }

  private wireInputModal(): void {
    const modal = this.root.querySelector<HTMLElement>('#input-modal');
    const input = this.root.querySelector<HTMLInputElement>('#im-input');
    const ok = this.root.querySelector<HTMLButtonElement>('#im-ok');
    const cancel = this.root.querySelector<HTMLButtonElement>('#im-cancel');
    const close = this.root.querySelector<HTMLButtonElement>('#im-close');
    if (!modal || !input || !ok || !cancel || !close) return;
    const shut = () => { modal.hidden = true; };
    const submit = () => {
      const fn = this.inputModalSubmit;
      shut();
      fn?.(input.value);
    };
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') shut();
    });
    cancel.addEventListener('click', shut);
    close.addEventListener('click', shut);
    modal.addEventListener('click', (e) => { if (e.target === modal) shut(); });
  }

  private showInputModal(opts: {
    title: string;
    sub: string;
    placeholder: string;
    initial: string;
    submitLabel: string;
    onSubmit: (value: string) => void;
  }): void {
    const modal = this.root.querySelector<HTMLElement>('#input-modal');
    const input = this.root.querySelector<HTMLInputElement>('#im-input');
    const title = this.root.querySelector<HTMLElement>('#im-title');
    const sub = this.root.querySelector<HTMLElement>('#im-sub');
    const ok = this.root.querySelector<HTMLButtonElement>('#im-ok');
    if (!modal || !input || !title || !sub || !ok) return;
    title.textContent = opts.title;
    sub.textContent = opts.sub;
    input.placeholder = opts.placeholder;
    input.value = opts.initial;
    ok.textContent = opts.submitLabel;
    this.inputModalSubmit = opts.onSubmit;
    modal.hidden = false;
    input.focus();
    input.select();
  }

  private practiceModalHtml(): string {
    return `
      <div id="practice-modal" class="practice-modal" hidden>
        <div class="pm-card">
          <button id="pm-close" class="pm-close" type="button" aria-label="關閉">×</button>
          <div class="pm-title">詠唱練習</div>
          <div class="pm-sub">開麥克風,喊出下面任一個詠唱詞,看會不會命中</div>
          <div class="pm-skills" id="pm-skills"></div>
          <button id="btn-mic">開始詠唱練習</button>
          <div class="mic-state" id="mic-state">準備中…</div>
          <div class="heard-wrap"><div class="heard-label">聽到</div><div class="heard" id="heard">—</div></div>
          <div class="hit" id="hit"></div>
        </div>
      </div>`;
  }

  // --- Chant practice: mic → live transcript → highlight the matched skill ---
  private wirePractice(): void {
    const btn = this.root.querySelector<HTMLButtonElement>('#btn-mic');
    if (btn) {
      btn.addEventListener('click', () => this.togglePractice());
      // reflect current state if the screen re-rendered mid-practice
      btn.textContent = this.practicing ? '停止練習' : '開始詠唱練習';
      btn.classList.toggle('primary', !this.practicing);
    }
    // Open/close the practice modal. Opening also starts the mic (this click is
    // the required user gesture); closing stops it.
    const modal = this.root.querySelector<HTMLElement>('#practice-modal');
    const open = this.root.querySelector<HTMLButtonElement>('#btn-practice-open');
    const close = this.root.querySelector<HTMLButtonElement>('#pm-close');
    if (modal && open) {
      open.addEventListener('click', () => {
        this.fillPracticeSkills(); // show the CURRENT character's chants to shout
        modal.hidden = false;
        if (!this.practicing) this.togglePractice();
      });
      const shut = () => {
        modal.hidden = true;
        if (this.practicing) this.togglePractice();
      };
      close?.addEventListener('click', shut);
      modal.addEventListener('click', (e) => { if (e.target === modal) shut(); });
    }
  }

  // Populate the practice modal with the CURRENT character's chant phrases so the
  // player knows exactly what to shout (the modal overlays the skill list).
  private fillPracticeSkills(): void {
    const host = this.root.querySelector<HTMLElement>('#pm-skills');
    if (!host) return;
    const id = this.classId;
    const def = CLASSES[id];
    const chips = def.spells
      .map((s) => {
        const phrase = chantFor(s, SKILL_INFO[s].name);
        const ico = `<span class="pm-chip-ico" style="color:${def.color}">${skillIconSvg(s)}</span>`;
        return `<span class="pm-chip">${ico}「${escapeHtml(phrase)}」</span>`;
      })
      .join('');
    host.innerHTML = `<div class="pm-skills-head" style="color:${def.color}">${escapeHtml(CHAR_NAMES[id])} 的招式</div><div class="pm-chips">${chips}</div>`;
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
    const id = matchSpell(text, { extra: chantsAsExtra() });
    if (id) this.flashHit(id);
  }

  private flashHit(id: SpellId): void {
    const hit = this.root.querySelector('#hit');
    if (hit) hit.textContent = `命中 「${SKILL_INFO[id].name}」!`;
    // Burst on the owning character's card sprite (cards no longer carry skills,
    // so find the card by the class that owns this spell).
    const owner = CLASS_ORDER.find((c) => CLASSES[c].spells.includes(id));
    const fx = owner
      ? this.root.querySelector<HTMLElement>(`.char-card[data-cls="${owner}"] .fx`)
      : null;
    if (fx) {
      fx.classList.remove('go');
      void fx.offsetWidth; // reflow so the animation restarts
      fx.classList.add('go');
    }
    // Highlight the center skill row when it's the selected character's spell.
    const rows = this.root.querySelectorAll<HTMLElement>(`#center-skills .skill[data-spell="${id}"]`);
    rows.forEach((e) => e.classList.add('hit'));
    if (this.hitTimer) clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => {
      rows.forEach((e) => e.classList.remove('hit'));
      const h = this.root.querySelector('#hit');
      if (h) h.textContent = '';
    }, 900);
  }

  private stopPractice(): void {
    this.practicing = false;
    if (this.voice) this.voice.stop();
  }

  // Home showcase: one compact animated card per class in the four corners
  // (walking sprite + name + source world). Clicking a card selects that class;
  // its 3 skills and chant editors render in the center panel.
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
      card.dataset.cls = id;
      card.style.color = def.color;
      card.style.gridArea = AREA[id];
      card.style.backgroundImage = worldBackground(id);
      card.style.backgroundSize = 'cover, cover, cover';
      card.style.backgroundPosition = 'center, center, center';
      card.style.backgroundRepeat = 'no-repeat';
      let sprite = '';
      if (sw) {
        const dur = (sw.frames / 9).toFixed(2); // ≈9fps, close to in-game 10
        sprite = `background-image:url(${sw.url});background-size:${sw.frames * 96}px 96px;animation:walk${sw.frames} ${dur}s steps(${sw.frames}) infinite`;
      }
      // Solo endless best, once the player has ever seen the ending — a quiet
      // nudge that there's more game past the campaign, without spoiling/
      // cluttering the card for anyone who hasn't unlocked it yet.
      const record = isEndlessUnlocked() ? loadRecord(id, 'solo') : null;
      const recordLine = record ? `<div class="crecord">無盡最佳・第 ${record.wave} 波</div>` : '';
      card.innerHTML = `
        <div class="sprite-box"><div class="walk-sprite" style="${sprite}"></div><div class="fx"></div></div>
        <div class="cname" style="color:${def.color}">${escapeHtml(CHAR_NAMES[id])}</div>
        <div class="cworld">◈ ${escapeHtml(WORLD_NAME[id])}</div>${recordLine}
      `;
      card.addEventListener('click', () => {
        if (id === this.classId) return;
        this.classId = id;
        this.selectedSkill = CLASSES[id].spells[0];
        this.renderShowcase();
      });
      host.appendChild(card);
    }
    this.renderCenterSkills();
  }

  // The selected character's 3 skills + chant editors, in the center panel.
  private renderCenterSkills(): void {
    const host = this.root.querySelector<HTMLElement>('#center-skills');
    if (!host) return;
    const id = this.classId;
    const def = CLASSES[id];
    const selected = this.selectedSkill && def.spells.includes(this.selectedSkill)
      ? this.selectedSkill
      : def.spells[0];
    this.selectedSkill = selected;
    host.style.color = def.color;
    const skills = def.spells
      .map((s) => {
        const k = SKILL_INFO[s];
        const phrase = chantFor(s, k.name); // custom chant or default name
        const ico = `<span class="skill-ico" style="color:${def.color}">${skillIconSvg(s)}</span>`;
        // One compact line per skill (icon + chant phrase + edit) so all 3 + name
        // + start buttons fit a short landscape phone without clipping. The full
        // effect/stats live on the in-game skill bar.
        return `<li class="skill${s === selected ? ' selected' : ''}" data-spell="${s}" title="查看技能說明"><div class="chant-row"><span style="display:flex;align-items:center;gap:6px;min-width:0">${ico}<span class="chant">「${escapeHtml(phrase)}」</span></span><button class="edit-chant" data-edit="${s}" title="改詠唱詞">改</button></div></li>`;
      })
      .join('');
    const info = SKILL_INFO[selected];
    host.innerHTML = `<div class="cs-head" style="color:${def.color}">${escapeHtml(CHAR_NAMES[id])} · ${escapeHtml(def.displayName)}</div><ul class="skills">${skills}</ul><div class="skill-detail"><div class="sd-title" style="color:${def.color}">${escapeHtml(info.name)}</div><div class="sd-effect">${escapeHtml(info.effect)}</div><div class="sd-stats">${escapeHtml(info.stats)}</div><div class="sd-body">${escapeHtml(info.detail)}</div></div>`;
    host.querySelectorAll<HTMLElement>('.skill').forEach((row) => {
      row.addEventListener('click', () => {
        this.selectedSkill = row.dataset.spell as SpellId;
        this.renderCenterSkills();
      });
    });
    // per-skill "改" buttons: edit the chant phrase. Saved to localStorage;
    // applies to practice + game. stopPropagation so the click stays in-panel.
    host.querySelectorAll<HTMLButtonElement>('.edit-chant').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const sid = b.dataset.edit as SpellId;
        const cur = chantFor(sid, SKILL_INFO[sid].name);
        this.showInputModal({
          title: `設定「${SKILL_INFO[sid].name}」的詠唱詞`,
          sub: '留空 = 還原預設',
          placeholder: SKILL_INFO[sid].name,
          initial: cur,
          submitLabel: '儲存',
          onSubmit: (next) => {
            setChant(sid, next);
            this.renderCenterSkills();
          },
        });
      });
    });
  }

  private effectiveName(): string {
    const n = this.name.trim();
    return n.length ? n : '召喚師';
  }

  // --- Solo ----------------------------------------------------------------
  private startSolo(): void {
    const session = new LocalSession(this.classId);
    this.hide();
    this.onStart(session, this.classId, true, true); // solo is always its own host
  }

  // 週挑戰: same solo path, but seeded from THIS week's id (weeklyRng()) and
  // starting directly in endless mode (enterEndless via startInEndless) so
  // it's not gated behind clearing the campaign first — everyone can jump
  // straight into a fair, comparable "how far this week" run.
  private startWeeklyChallenge(): void {
    const session = new LocalSession(this.classId, weeklyRng(), true);
    this.hide();
    this.onStart(session, this.classId, true, true, false, true, this.effectiveName());
  }

  // Direct solo endless (unseeded, unlike the weekly challenge) — once a
  // player has cleared the campaign once, re-clearing all 4 chapters every
  // session just to reach endless was a repeating tax on returning players.
  // Only ever shown once isEndlessUnlocked() (gated in renderSetup's markup).
  private startEndless(): void {
    const session = new LocalSession(this.classId, Math.random, true);
    this.hide();
    this.onStart(session, this.classId, true, true);
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
        onChat: (from, text) => this.pushChat(from, text),
        onReturnToLobby: () => this.returnFromGame(),
        onClose: () => this.handleDisconnect(),
      },
      url,
    );
    this.client = client;
    this.showConnecting();
    client.connect();
  }

  private doJoinByCode(presetCode?: string): void {
    if (presetCode) {
      this.joinRoomByCode(presetCode);
      return;
    }
    this.showInputModal({
      title: '輸入房間代碼',
      sub: '跟隊友要 4 碼房間代碼',
      placeholder: '例如 A1B2',
      initial: '',
      submitLabel: '加入',
      onSubmit: (value) => {
        const roomCode = value.trim().toUpperCase();
        if (roomCode) this.joinRoomByCode(roomCode);
      },
    });
  }

  private joinRoomByCode(roomCode: string): void {
    this.lastJoinAttemptCode = roomCode;
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
        onChat: (from, text) => this.pushChat(from, text),
        onReturnToLobby: () => this.returnFromGame(),
        onClose: () => this.handleDisconnect(),
      },
      url,
    );
    this.client = client;
    this.showConnecting();
    client.connect();
  }

  // Builds a ?join=CODE link off the current URL (preserving ?server= etc. so
  // an HTTPS-hosted page's explicit ws server still carries over to whoever
  // clicks it), copies it, and flashes the button label to confirm.
  private async copyInviteLink(btn: HTMLButtonElement): Promise<void> {
    return this.copyRoomLink(btn, 'join');
  }

  // A ?watch=CODE link — for a 5th+ friend who just wants to spectate instead
  // of waiting for a player slot.
  private async copyWatchLink(btn: HTMLButtonElement): Promise<void> {
    return this.copyRoomLink(btn, 'watch');
  }

  private async copyRoomLink(btn: HTMLButtonElement, param: 'join' | 'watch'): Promise<void> {
    const url = new URL(window.location.href);
    url.searchParams.set(param, this.roomCode);
    const link = url.toString();
    const original = btn.textContent;
    const label = param === 'join' ? '一起玩' : '觀戰';
    // Native share sheet first (one tap straight to any chat app on mobile —
    // same pattern shareCard.ts's shareOrDownloadCard() already uses for the
    // post-run result card). navigator.share cancelling/erroring falls
    // through to the plain clipboard-copy path, same as before.
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ url: link, title: '真。AI。咏唱魔法', text: `來${label}!對著麥克風喊出技能名稱施法` });
        return;
      } catch {
        // cancelled or unsupported for this data shape — fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      btn.textContent = '已複製!';
    } catch {
      // Clipboard API unavailable (insecure context / permission denied) —
      // fall back to a manual-copy prompt so the link isn't just lost.
      window.prompt('複製這個連結給隊友:', link);
    }
    setTimeout(() => {
      btn.textContent = original;
    }, 1600);
  }

  private beginNetGame(client: NetClient): void {
    const session = new NetSession(client);
    this.hide();
    this.onStart(session, this.classId, false, this.isHost);
  }

  // --- Spectate: read-only observer, never a player slot ---------------------
  private doSpectate(roomCode: string): void {
    const url = resolveServerUrl();
    const client = new NetClient(
      {
        onOpen: () => client.spectate(this.effectiveName(), roomCode),
        onSpectating: (m) => {
          this.client = client;
          this.roomCode = m.roomCode;
          this.members = m.players;
          this.isSpectating = true;
          if (m.status === 'lobby') this.renderSpectateWaiting();
          else this.beginSpectateGame(client);
        },
        onLobby: (players) => {
          this.members = players;
          if (this.roomCode) this.renderSpectateWaiting();
        },
        onStarted: () => this.beginSpectateGame(client),
        onError: (code) => this.handleNetError(code),
        onPeerLeft: () => {
          /* refresh via onLobby */
        },
        onChat: (from, text) => this.pushChat(from, text),
        onReturnToLobby: () => this.returnFromGame(),
        onClose: () => this.handleDisconnect(),
      },
      url,
    );
    this.client = client;
    this.showConnecting();
    client.connect();
  }

  // The game hasn't started yet — nothing to watch, just show who's in the
  // room so the spectator knows they're in the right place.
  private renderSpectateWaiting(): void {
    const slots: string[] = [];
    for (let i = 0; i < 4; i++) {
      const m = this.members[i];
      slots.push(
        m ? this.playerSlot(m, i === 0, false) : '<div class="pslot empty"><div class="empty-mark">＋</div>等待玩家加入…</div>',
      );
    }
    this.root.innerHTML = `
      <h1>觀戰中</h1>
      <div class="sub">代碼 <b class="code-inline">${escapeHtml(this.roomCode)}</b> · 等待房主開始遊戲…(${this.members.length}/4)</div>
      <div class="room-grid">${slots.join('')}</div>
      <div class="btns"><button id="btn-leave">離開觀戰</button></div>
    `;
    this.root.querySelector('#btn-leave')!.addEventListener('click', () => {
      this.client?.leave();
      this.teardownClient();
      this.roomCode = '';
      this.renderSetup();
    });
  }

  private beginSpectateGame(client: NetClient): void {
    const session = new SpectatorSession(client);
    this.hide();
    // classId is never read for a spectator (see main.ts); isHost is always
    // false (a spectator never gets host-only buttons).
    this.onStart(session, this.classId, false, false, true);
  }

  // main.ts registers how to tear the running game down (Phaser / loop / overlays).
  setReturn(fn: () => void): void {
    this.returnFn = fn;
  }

  // Server sent everyone back to the room (all died). Tear down the game and
  // re-show the room — the ws connection + room membership are kept alive.
  private returnFromGame(): void {
    this.returnFn?.();
    this.returnFn = null;
    this.selfReady = false;
    this.root.style.display = '';
    if (this.isSpectating) this.renderSpectateWaiting();
    else if (this.roomCode) this.renderRoom();
    else this.renderSetup();
  }

  private handleNetError(code: ErrorCode): void {
    // A 'bad-message' while already in a room is non-fatal (e.g. an older server
    // that doesn't understand 'chat') — ignore it instead of kicking the player
    // out of the room.
    if (code === 'bad-message' && this.roomCode) return;
    // Otherwise a real lobby/room error: drop back to setup; solo stays available.
    this.teardownClient();
    this.roomCode = '';
    if (code === 'already-started' && this.lastJoinAttemptCode) {
      const watchCode = this.lastJoinAttemptCode;
      this.renderSetup(ERROR_TEXT[code], { label: '改為旁觀這場遊戲', onClick: () => this.doSpectate(watchCode) });
      return;
    }
    this.renderSetup(ERROR_TEXT[code] ?? '發生未知錯誤');
  }

  private handleDisconnect(): void {
    // hide() (called on entering an active match) sets display:none on this
    // root — a disconnect while actually playing must undo that (and tear
    // down the running game, same teardown returnFromGame() already uses for
    // the graceful "everyone died" path), or the freshly-rendered error
    // message renders into an invisible DOM node behind a frozen game canvas,
    // and the player just sees what looks like a crash with no explanation.
    if (this.returnFn) {
      this.returnFn();
      this.returnFn = null;
    }
    this.root.style.display = '';
    // If we never made it into a room, this is a failed connection.
    if (!this.roomCode) {
      this.renderSetup('無法連線到伺服器(請確認網址 / 伺服器是否啟動)。你仍可選擇「單機」。');
    } else {
      // Lost connection (in the lobby, or mid-match — both land here).
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
  // The free-tier server's cold start has been measured at 90-200+s in
  // practice — not the "數秒" the copy used to claim. Under-promising here
  // plus a live elapsed counter matters more than shortening the actual wait:
  // a visible, honestly-labelled ticking number reads as "working", a static
  // "should be quick" message that blows past its own estimate reads as
  // "broken", even though the underlying wait is identical either way.
  private showConnecting(): void {
    this.root.innerHTML = `
      <h1>連線中…</h1>
      <div class="sub">正在喚醒免費伺服器,冷啟動可能要 1-2 分鐘,請耐心等候…(已等待 <span id="connect-elapsed">0</span> 秒)</div>
      <div class="btns"><button id="btn-cancel">取消</button></div>
    `;
    this.root.querySelector('#btn-cancel')!.addEventListener('click', () => this.renderSetup());
    const startedAt = Date.now();
    const tick = (): void => {
      const el = document.getElementById('connect-elapsed');
      if (!el) return; // navigated away from this screen — self-clear
      el.textContent = String(Math.floor((Date.now() - startedAt) / 1000));
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  private renderRoom(): void {
    const selfId = this.client?.selfId;
    // Four PLAYER seats: filled by joined members (live), the rest "waiting".
    const slots: string[] = [];
    for (let i = 0; i < 4; i++) {
      const m = this.members[i];
      slots.push(
        m
          ? this.playerSlot(m, i === 0, m.id === selfId)
          : '<div class="pslot empty"><div class="empty-mark">＋</div>等待玩家加入…</div>'
      );
    }
    // The local player picks only THEIR own character (compact chips).
    const chips = CLASS_ORDER.map(
      (id) =>
        `<button class="chip${id === this.classId ? ' on' : ''}" data-pick="${id}" style="--cc:${CLASSES[id].color}">${escapeHtml(CHAR_NAMES[id])}</button>`
    ).join('');

    this.root.innerHTML = `
      <h1>房間大廳</h1>
      <div class="sub">代碼 <b class="code-inline">${escapeHtml(this.roomCode)}</b> · 把代碼給隊友,加入後會即時出現在席位(${this.members.length}/4)
        · <button id="btn-copy-invite" class="link-btn promote" type="button">分享邀請連結</button>
        · <button id="btn-copy-watch" class="link-btn" type="button">複製旁觀連結</button>
      </div>
      <div class="room-body">
      <div class="room-grid">${slots.join('')}</div>
      <div class="room-bar">
        <div class="picker"><span class="picker-label">選你的角色</span>${chips}</div>
        <div class="chat">
          <div class="chat-log" id="chat-log">${this.chatLogHtml()}</div>
          <div class="chat-row">
            <input id="chat-input" type="text" maxlength="200" placeholder="跟隊友討論選哪隻…(Enter 送出)" />
            <button id="chat-voice" type="button" title="語音輸入" aria-label="語音輸入"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
            <button id="chat-send" type="button">送出</button>
          </div>
        </div>
        <div class="hint">小技巧:遊戲中和隊友一起喊「共鳴」(或按 4),同步呼喚可觸發全隊祝福</div>
        <div class="hint">小技巧:不同職業組隊有羈絆加成,職業越多元加成越高,四職業全上陣加成最大</div>
        <div class="hint">小技巧:同一隻怪連續被不同元素命中會觸發反應(沸騰/爆燃/凍鎖/淨化),隊友輪流打同一目標傷害更高</div>
        <div class="btns">
          ${
            this.isHost
              ? `<button id="btn-start" class="primary">開始(${this.members.length} 人)</button>`
              : `<button id="btn-ready">${this.selfReady ? '取消準備' : '準備'}</button>`
          }
          <button id="btn-practice-open" class="practice-open" title="開麥克風練習詠唱">練習</button>
          <button id="btn-leave">離開房間</button>
        </div>
        <div class="error" id="lobby-error"></div>
      </div>
      </div>
      ${this.practiceModalHtml()}
      ${this.inputModalHtml()}
    `;

    this.root.querySelector('#btn-copy-invite')!.addEventListener('click', (e) => {
      this.copyInviteLink(e.currentTarget as HTMLButtonElement);
    });
    this.root.querySelector('#btn-copy-watch')!.addEventListener('click', (e) => {
      this.copyWatchLink(e.currentTarget as HTMLButtonElement);
    });

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

    // Self character picker (chips) → tell the server (setClass), update own seat.
    this.root.querySelectorAll<HTMLButtonElement>('.picker .chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pick as ClassId;
        if (id === this.classId) return;
        this.classId = id;
        this.client?.setClass(id);
        const self = selfId ? this.members.find((m) => m.id === selfId) : undefined;
        if (self) self.classId = id;
        this.renderRoom();
      });
    });
    // Room chat: type or dictate, Enter/送出 to send (server relays back to all).
    const chatInput = this.root.querySelector<HTMLInputElement>('#chat-input');
    const sendChat = () => {
      const t = chatInput?.value.trim();
      if (!t) return;
      this.client?.sendChat(t);
      if (chatInput) chatInput.value = '';
    };
    this.root.querySelector('#chat-send')?.addEventListener('click', sendChat);
    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
    });
    this.root.querySelector('#chat-voice')?.addEventListener('click', () => this.dictateChat());
    const log = this.root.querySelector('#chat-log');
    if (log) log.scrollTop = log.scrollHeight;

    // Keep the chant-practice mic so a waiting player can warm up.
    this.wirePractice();
    this.wireInputModal();
  }

  private chatLogHtml(): string {
    return this.chatLog
      .map((c) => `<div class="chat-line"><b>${escapeHtml(c.from)}</b> ${escapeHtml(c.text)}</div>`)
      .join('');
  }

  // Incoming chat (server-relayed, incl. our own echo) → buffer + append live.
  private pushChat(from: string, text: string): void {
    this.chatLog.push({ from, text });
    if (this.chatLog.length > 80) this.chatLog.shift();
    const log = this.root.querySelector('#chat-log');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.innerHTML = `<b>${escapeHtml(from)}</b> ${escapeHtml(text)}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  // One-shot voice dictation into the chat input (frees the practice mic first).
  private dictateChat(): void {
    this.stopPractice();
    const input = this.root.querySelector<HTMLInputElement>('#chat-input');
    if (!this.chatVoice) this.chatVoice = new WebSpeechVoiceInput('zh-TW');
    this.chatVoice.onTranscript((text) => {
      if (input) { input.value = text; input.focus(); }
      this.chatVoice?.stop();
    });
    this.chatVoice.start();
  }

  // One room seat: a joined player's chosen character (sprite + name + role +
  // world + skills) + their player name and host/ready badge.
  private playerSlot(m: LobbyPlayerView, isHostMember: boolean, isSelf: boolean): string {
    const def = CLASSES[m.classId];
    const sw = SHEET_WALKERS[m.classId];
    let sprite = '';
    if (sw) {
      const dur = (sw.frames / 9).toFixed(2);
      sprite = `background-image:url(${sw.url});background-size:${sw.frames * 96}px 96px;animation:walk${sw.frames} ${dur}s steps(${sw.frames}) infinite`;
    }
    const skills = def.spells
      .map(
        (s) =>
          `<span class="ps-skill"><span class="skill-ico" style="color:${def.color};width:16px;height:16px;display:inline-block">${skillIconSvg(s)}</span>${escapeHtml(chantFor(s, SKILL_INFO[s].name))}</span>`
      )
      .join('');
    const badge = isHostMember
      ? '<span class="badge host">房主</span>'
      : m.ready
        ? '<span class="badge ready">已準備</span>'
        : '<span class="badge wait">等待中</span>';
    return `<div class="pslot${isSelf ? ' self' : ''}" style="background-image:${worldBackground(m.classId)};background-size:cover,cover,cover;background-position:center,center,center;background-repeat:no-repeat;color:${def.color}">
      <div class="pslot-top"><span class="pslot-name">${escapeHtml(m.name)}${isSelf ? ' (你)' : ''}</span>${badge}</div>
      <div class="sprite-box"><div class="walk-sprite" style="${sprite}"></div></div>
      <div class="cname" style="color:${def.color}">${escapeHtml(CHAR_NAMES[m.classId])}</div>
      <div class="crole">${escapeHtml(def.displayName)} · ${escapeHtml(WORLD_NAME[m.classId])}</div>
      <div class="pslot-skills">${skills}</div>
    </div>`;
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
