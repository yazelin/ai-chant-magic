import { World, Player, CLASSES, CONFIG, SPELLS, ClassId } from '@acm/shared';
import { VoiceStatus } from '../voice/recognizer';
import { skillIconSvg } from '../ui/skillIcons';
import {
  loadRecord,
  saveRecordIfBetter,
  markEndlessUnlocked,
  type EndlessBucket,
  type EndlessRecord,
} from '../session/endlessRecords';
import { renderShareCard, shareOrDownloadCard, type ShareCardStats } from './shareCard';
import { fetchLeaderboard, currentWeekId } from '../session/weeklyChallenge';

// Short mic-pill labels (the long permission instruction shows as a .note below).
const MIC_LABEL: Record<VoiceStatus, string> = {
  idle: '麥克風待命',
  listening: '聆聽中',
  unsupported: '不支援語音',
  denied: '麥克風被拒',
  error: '語音異常',
};

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

// Boss name by world.levelId — keep in lockstep with wavehud.ts's copy and
// shared/world.ts's spawnBoss() element choice as new worlds ship.
const BOSS_NAMES = ['史萊姆王', '冰靈女王', '雷靈王', '聖杯女王'];

// Endless-mode milestone flavour text, keyed by the exact wave (milestones only
// ever land on multiples of 10); anything past the last entry falls back.
const MILESTONE_FLAVOR: Record<number, string> = {
  10: '熱身結束', 20: '漸入佳境', 30: '深淵漸近', 40: '傳說在望', 50: '無盡深處',
};
function milestoneFlavor(wave: number): string {
  return MILESTONE_FLAVOR[wave] ?? '深淵不見底';
}

function endlessBucket(world: World): EndlessBucket {
  return world.players.filter((p) => p.connected).length > 1 ? 'party' : 'solo';
}

function fmtMMSS(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

const GOLD_BTN =
  'pointer-events:auto;cursor:pointer;background:var(--accent);color:#1a1030;border:none;' +
  'border-radius:10px;padding:9px 22px;font:800 16px system-ui;';
const PLAIN_BTN =
  'pointer-events:auto;cursor:pointer;background:transparent;color:#c7cbdb;border:1px solid #666;' +
  'border-radius:10px;padding:9px 22px;font:700 14px system-ui;';

// Small cooldown pips (party panel): coloured when ready, grey while cooling.
function cdPips(p: Player, now: number): string {
  return CLASSES[p.classId].spells
    .map((id) => {
      const cooling = (p.cooldowns?.[id] ?? 0) - now > 0.05;
      const f = cooling ? 'filter:grayscale(1) brightness(0.55);opacity:.7' : '';
      return `<span style="display:inline-block;width:14px;height:14px;color:${CLASSES[p.classId].color};${f}">${skillIconSvg(id)}</span>`;
    })
    .join('');
}

// HP-bar fill colour: green → orange → red as it drops.
function hpColor(frac: number): string {
  if (frac > 0.5) return 'linear-gradient(#46d66a,#1f9e44)';
  if (frac > 0.25) return 'linear-gradient(#ffc34d,#e08a1a)';
  return 'linear-gradient(#ff6a6a,#c0203f)';
}

export class Hud {
  private hud: HTMLElement;
  private mic: HTMLElement;
  private heard: HTMLElement;
  private gameover: HTMLElement;
  private victory: HTMLElement;
  private levelClear: HTMLElement;
  private endlessQuit: HTMLElement;
  private heardTimer: ReturnType<typeof setTimeout> | null = null;
  private levelClearTimer: ReturnType<typeof setTimeout> | null = null;
  private goShown = false;
  private victoryShown = false;
  private levelClearShown = false;
  // Endless-mode bookkeeping: the run's starting best (snapshotted once so the
  // record-break toast compares against a fixed target, not a moving one —
  // records are only persisted at death), and the victory-screen decision
  // countdown's start time (kept separate from the DOM rebuild so the
  // countdown text can update every render() without dropping button handlers).
  private endlessWasActive = false;
  private endlessPriorBest: EndlessRecord | null = null;
  private endlessRecordBrokenShown = false;
  private endlessLastToastWave = -1;
  // 共鳴詠唱 toast — effect ids already toasted, so a still-fading effect
  // (ttl>0 across several render() polls) doesn't re-trigger the toast.
  private seenResonanceFx = new Set<number>();
  private victoryEnteredAt: number | null = null;
  // Player ids seen connected so far — lets render() detect a connected→
  // disconnected transition (a teammate's tab closed/crashed mid-match) and
  // toast it once, instead of the player just silently vanishing from the
  // party panel with zero explanation.
  private seenConnected = new Set<string>();

  constructor(
    private solo = false,
    private onRestart: () => void = () => {},
    private onEnterEndless: () => void = () => {},
    private onSkipToLobby: () => void = () => {},
    private isHost = false,
    private onEndEndless: () => void = () => {},
    private weeklyChallenge = false,
    private getVoiceCasts: () => number = () => 0,
  ) {
    this.hud = document.getElementById('hud')!;
    this.mic = document.getElementById('mic-status')!;
    this.heard = document.getElementById('heard')!;
    // Centred game-over banner (hidden until status flips).
    this.gameover = document.createElement('div');
    this.gameover.id = 'gameover';
    this.gameover.style.cssText =
      'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:6;pointer-events:none;display:none;' +
      'text-align:center;font:800 22px system-ui,sans-serif;color:#fff;text-shadow:0 2px 8px #000;' +
      'background:rgba(16,16,34,0.82);border:1px solid var(--accent);border-radius:14px;padding:18px 28px;';
    (document.getElementById('game-chrome') ?? document.body).appendChild(this.gameover);
    // Centred victory banner (campaign complete) — same shape as gameover, gold
    // accent instead of the default so it reads as a win rather than a loss.
    this.victory = document.createElement('div');
    this.victory.id = 'victory';
    this.victory.style.cssText =
      'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:6;pointer-events:none;display:none;' +
      'text-align:center;font:800 22px system-ui,sans-serif;color:#fff;text-shadow:0 2px 8px #000;' +
      'background:rgba(16,16,34,0.82);border:1px solid #ffd24d;border-radius:14px;padding:18px 28px;';
    (document.getElementById('game-chrome') ?? document.body).appendChild(this.victory);
    // Level-clear toast (campaign boss down) / endless-mode milestone+record
    // toast: non-blocking, top-centre, auto-fades. Same DOM slot for both —
    // they never fire at the same time (levelCleared never happens once endless).
    this.levelClear = document.createElement('div');
    this.levelClear.id = 'level-clear-toast';
    this.levelClear.style.cssText =
      'position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:6;pointer-events:none;display:none;' +
      'text-align:center;font:800 20px system-ui,sans-serif;color:#ffd24d;text-shadow:0 2px 8px #000;' +
      'background:rgba(16,16,34,0.82);border:1px solid #ffd24d;border-radius:14px;padding:12px 24px;';
    (document.getElementById('game-chrome') ?? document.body).appendChild(this.levelClear);
    // Small always-visible "quit early" affordance during an endless run — the
    // only other ways out are an actual party wipe or reloading the page.
    // Host-only (matches endEndless's server-side gate), so it's never shown
    // to someone whose click would just silently error.
    this.endlessQuit = document.createElement('button');
    this.endlessQuit.id = 'endless-quit';
    this.endlessQuit.textContent = '結束挑戰';
    this.endlessQuit.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:61;display:none;pointer-events:auto;cursor:pointer;' +
      'background:rgba(16,16,34,0.82);color:#c7cbdb;border:1px solid #666;border-radius:8px;' +
      'padding:5px 10px;font:700 12px system-ui;';
    this.endlessQuit.addEventListener('click', () => {
      if (window.confirm('確定要結束這輪無盡模式嗎?')) this.onEndEndless();
    });
    (document.getElementById('game-chrome') ?? document.body).appendChild(this.endlessQuit);
  }

  // First-match onboarding: without this, a player who reaches for 1/2/3 out
  // of muscle memory (very common instinct from any other action game) can
  // finish an entire session — even in a room with friends — without ever
  // discovering this is a voice game. main.ts calls this once per browser
  // (see session/onboarding.ts's hasSeenVoiceHint gate), not once per match.
  showVoiceHint(classId: ClassId): void {
    const spells = CLASSES[classId].spells.map((id) => `「${SPELLS[id].displayName}」`).join('/');
    this.showToast(`喊出 ${spells} 施法(或按 1/2/3)`, 6000);
  }

  setMicStatus(s: VoiceStatus, message?: string): void {
    this.mic.className = s; // CSS colours the pill/dot by state
    const note =
      (s === 'denied' || s === 'unsupported') && message
        ? `<div class="note">${esc(message)}</div>`
        : '';
    this.mic.innerHTML = `<span class="pill"><span class="dot"></span>${MIC_LABEL[s]}</span>${note}`;
  }

  // Last recognized transcript → a brief bottom-centre toast (auto-fades).
  setHeard(text: string, matchedSpellName: string | null): void {
    const t = text.trim();
    if (!t) return;
    this.heard.textContent = matchedSpellName ? `「${t}」 → ${matchedSpellName} ✓` : `「${t}」 → 未對應`;
    this.heard.style.color = matchedSpellName ? '#ffd24d' : 'var(--muted)';
    if (this.heardTimer) clearTimeout(this.heardTimer);
    this.heardTimer = setTimeout(() => { this.heard.textContent = ''; }, 2600);
  }

  // Shared by the campaign level-clear toast and the endless milestone/record
  // toast — same DOM slot, same auto-fade timer.
  private showToast(text: string, ms: number): void {
    this.levelClear.textContent = text;
    this.levelClear.style.display = 'block';
    if (this.levelClearTimer) clearTimeout(this.levelClearTimer);
    this.levelClearTimer = setTimeout(() => { this.levelClear.style.display = 'none'; }, ms);
  }

  // Self first, same ordering used for the party panel — the roster shown on
  // the share card.
  private rosterFor(world: World, selfId: string | null): { name: string; classId: Player['classId'] }[] {
    return world.players
      .filter((p) => p.connected)
      .sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : 0))
      .map((p) => ({ name: p.name, classId: p.classId }));
  }

  // The share card previously had zero reference to the game's own voice
  // hook — the one artifact designed to travel into a friend's chat had no
  // sign this was a voice game at all. 0 casts (keyboard-only run) omits the
  // clause rather than showing a deflating "語音咏唱 0 次".
  private voiceCastSuffix(): string {
    const n = this.getVoiceCasts();
    return n > 0 ? ` · 語音咏唱 ${n} 次` : '';
  }

  private shareResult(stats: ShareCardStats): void {
    const canvas = renderShareCard(stats);
    void shareOrDownloadCard(canvas);
  }

  // 週挑戰: fetch this week's top 10 for the run's class and render it into
  // the gameover banner's placeholder. Fire-and-forget from render() — if the
  // banner has already been dismissed/rebuilt by the time this resolves, the
  // querySelector below simply finds nothing and no-ops.
  private async loadWeeklyLeaderboard(classId: Player['classId']): Promise<void> {
    const entries = await fetchLeaderboard(classId);
    const box = this.gameover.querySelector('#go-leaderboard');
    if (!box) return;
    if (entries.length === 0) {
      box.innerHTML = '本週排行榜:目前還沒有紀錄,你是第一個!';
      return;
    }
    const rows = entries
      .slice(0, 10)
      .map((e, i) => `<div>${i + 1}. ${esc(e.name)} — 第 ${e.wave} 波(擊殺 ${e.kills})</div>`)
      .join('');
    box.innerHTML = `<div style="font-weight:700;color:#ffd24d;margin-bottom:2px">本週排行榜 Top ${Math.min(10, entries.length)}</div>${rows}`;
  }

  render(world: World, selfId: string | null = null): void {
    // Game-over banner — built once on the status flip (so its 重來 button keeps
    // a live click handler instead of being recreated every tick).
    if (world.status === 'gameover' && !this.goShown) {
      this.goShown = true;
      // Don't let a still-fading endless toast visually collide with the banner.
      if (this.levelClearTimer) clearTimeout(this.levelClearTimer);
      this.levelClear.style.display = 'none';
      this.levelClearShown = false;

      this.gameover.style.display = 'block';
      const hint = this.solo
        ? `<button id="go-restart" style="margin-top:12px;${GOLD_BTN}">重來</button>`
        : '<div style="font-size:13px;color:#9aa0b5;margin-top:10px">等所有人都倒下…回到房間</div>';
      const shareBtn = `<div><button id="go-share" style="margin-top:8px;${PLAIN_BTN}">分享戰報</button></div>`;

      let shareStats: ShareCardStats;
      if (world.endless) {
        const bucket = endlessBucket(world);
        const self = world.players.find((p) => p.id === selfId);
        const runWave = world.wave;
        const runScore = world.score - world.endlessKillBase;
        const survived = fmtMMSS(world.time - world.endlessTimeBase);
        let recordLine = '';
        if (self) {
          const prior = loadRecord(self.classId, bucket);
          const saved = saveRecordIfBetter(self.classId, bucket, { wave: runWave, score: runScore });
          if (!prior) recordLine = `本次紀錄:第 ${runWave} 波(此組合首次挑戰)`;
          else if (saved) recordLine = `新紀錄!超越前次第 ${prior.wave} 波`;
          else recordLine = `本次第 ${runWave} 波,尚未超越最佳第 ${prior.wave} 波(差 ${prior.wave - runWave} 波)`;
        }
        // 週挑戰: same run/gameover shape as regular endless (both start via
        // enterEndless), just with a leaderboard section appended — fetched
        // async after the innerHTML is set, so a slow/offline request never
        // blocks the game-over screen itself from showing immediately.
        const leaderboardBox = this.weeklyChallenge
          ? '<div id="go-leaderboard" style="margin-top:10px;font-size:12px;color:#9aa0b5;text-align:left;max-width:220px">本週排行榜載入中…</div>'
          : '';
        this.gameover.innerHTML =
          `無盡深淵・力竭倒下<div style="font-size:14px;font-weight:600;color:#c7cbdb;margin:6px 0">撐到第 ${runWave} 波 · 擊殺 ${runScore} · 存活 ${survived}</div>` +
          `<div style="font-size:13px;font-weight:700;color:#ffd24d;margin-top:2px">${recordLine}</div>${hint}${shareBtn}${leaderboardBox}`;
        shareStats = {
          title: '無盡深淵・力竭倒下',
          statLine:
            `撐到第 ${runWave} 波 · 擊殺 ${runScore} · 存活 ${survived}${this.voiceCastSuffix()}` +
            (this.weeklyChallenge ? ` · 本週挑戰 ${currentWeekId()}` : ''),
          recordLine: recordLine || undefined,
          players: this.rosterFor(world, selfId),
        };
        if (this.weeklyChallenge && self) this.loadWeeklyLeaderboard(self.classId);
      } else {
        this.gameover.innerHTML = `遊戲結束<div style="font-size:14px;font-weight:600;color:#c7cbdb;margin:6px 0">撐到第 ${world.wave} 波 · 擊殺 ${world.score}</div>${hint}${shareBtn}`;
        shareStats = {
          title: '遊戲結束',
          statLine: `撐到第 ${world.wave} 波 · 擊殺 ${world.score}${this.voiceCastSuffix()}`,
          players: this.rosterFor(world, selfId),
        };
      }
      this.gameover.querySelector('#go-restart')?.addEventListener('click', () => this.onRestart());
      this.gameover.querySelector('#go-share')?.addEventListener('click', () => this.shareResult(shareStats));
    } else if (world.status !== 'gameover' && this.goShown) {
      this.goShown = false;
      this.gameover.style.display = 'none';
    }

    // Victory banner — every implemented level cleared. Built once on the
    // status flip. Offers "keep going in endless mode" alongside restart/lobby.
    if (world.status === 'victory' && !this.victoryShown) {
      this.victoryShown = true;
      this.victoryEnteredAt = Date.now();
      markEndlessUnlocked(); // seeing the ending once is enough to unlock it forever
      this.victory.style.display = 'block';
      const mins = Math.floor(world.time / 60);
      const secs = Math.floor(world.time % 60).toString().padStart(2, '0');

      const bucket = endlessBucket(world);
      const self = world.players.find((p) => p.id === selfId);
      const record = self ? loadRecord(self.classId, bucket) : null;
      const recordLine = record
        ? `歷代最佳:第 ${record.wave} 波・擊殺 ${record.score}(${bucket === 'solo' ? '單人' : '小隊'})`
        : '尚無紀錄,成為第一位撐過無盡深淵的人';

      let action: string;
      if (this.solo) {
        action =
          `<div style="display:flex;gap:8px;justify-content:center;margin-top:12px">` +
          `<button id="victory-endless" style="${GOLD_BTN}">挑戰無盡模式</button>` +
          `<button id="victory-restart" style="${PLAIN_BTN}">重來</button></div>`;
      } else if (this.isHost) {
        action =
          `<div style="display:flex;gap:8px;justify-content:center;margin-top:12px">` +
          `<button id="victory-endless" style="${GOLD_BTN}">挑戰無盡模式</button>` +
          `<button id="victory-skip" style="${PLAIN_BTN}">返回大廳</button></div>`;
      } else {
        action =
          `<div style="font-size:13px;color:#9aa0b5;margin-top:10px">房主可開啟無盡模式,` +
          `<span id="victory-countdown">${CONFIG.transition.victoryDecisionSec}</span> 秒內未選擇將自動返回房間</div>`;
      }

      const shareBtn = `<div><button id="victory-share" style="margin-top:8px;${PLAIN_BTN}">分享戰報</button></div>`;
      this.victory.innerHTML =
        `全破!四個世界都已淨化<div style="font-size:14px;font-weight:600;color:#c7cbdb;margin:6px 0">總耗時 ${mins}:${secs} · 擊殺 ${world.score}</div>` +
        `<div style="font-size:12px;color:#ffd24d;margin-top:2px">${recordLine}</div>` +
        `<div style="font-size:12px;color:#9aa0b5;margin-top:4px">感謝遊玩——非官方同人二創,非商業作品</div>${action}${shareBtn}`;
      this.victory.querySelector('#victory-endless')?.addEventListener('click', () => this.onEnterEndless());
      this.victory.querySelector('#victory-restart')?.addEventListener('click', () => this.onRestart());
      this.victory.querySelector('#victory-skip')?.addEventListener('click', () => this.onSkipToLobby());
      const victoryShareStats: ShareCardStats = {
        title: '全破!四個世界都已淨化',
        statLine: `總耗時 ${mins}:${secs} · 擊殺 ${world.score}${this.voiceCastSuffix()}`,
        recordLine: record ? `無盡模式最佳:第 ${record.wave} 波・擊殺 ${record.score}` : undefined,
        players: this.rosterFor(world, selfId),
      };
      this.victory.querySelector('#victory-share')?.addEventListener('click', () => this.shareResult(victoryShareStats));
    } else if (world.status !== 'victory' && this.victoryShown) {
      this.victoryShown = false;
      this.victoryEnteredAt = null;
      this.victory.style.display = 'none';
    }
    // Keep the non-host decision countdown live without rebuilding the banner
    // (rebuilding on every tick would drop the button handlers and flicker).
    if (world.status === 'victory' && !this.solo && !this.isHost && this.victoryEnteredAt !== null) {
      const remain = Math.ceil(
        CONFIG.transition.victoryDecisionSec - (Date.now() - this.victoryEnteredAt) / 1000,
      );
      const el = this.victory.querySelector('#victory-countdown');
      if (el) el.textContent = String(Math.max(0, remain));
    }

    // Level-clear toast (campaign) — fires once on the levelCleared flip.
    if (world.levelCleared && !this.levelClearShown) {
      this.levelClearShown = true;
      const bossName = BOSS_NAMES[world.levelId] ?? BOSS_NAMES[0];
      this.showToast(`${bossName} 討伐!世界已淨化`, 4000);
    } else if (!world.levelCleared && this.levelClearShown) {
      this.levelClearShown = false;
      this.levelClear.style.display = 'none';
    }

    // Endless-mode milestone / record-break toast — same DOM slot as the
    // level-clear toast, which is permanently idle once world.endless is true.
    if (world.endless && world.status === 'playing') {
      if (!this.endlessWasActive) {
        // Just (re-)entered this tick — snapshot the run's starting best so the
        // record-break toast compares against a fixed target, not one that
        // moves as this very run's own attempts get persisted elsewhere. Fires
        // for every connected client (state-driven, not tied to who clicked
        // the button), so non-host players see it too as soon as their next
        // snapshot reflects it.
        this.endlessWasActive = true;
        const self = world.players.find((p) => p.id === selfId);
        this.endlessPriorBest = self ? loadRecord(self.classId, endlessBucket(world)) : null;
        this.endlessRecordBrokenShown = false;
        this.endlessLastToastWave = -1;
        this.showToast('無盡模式啟動!', 4000);
      }
      if (world.wave > 0 && world.wave !== this.endlessLastToastWave) {
        const brokeRecord =
          !this.endlessRecordBrokenShown &&
          this.endlessPriorBest !== null &&
          world.wave > this.endlessPriorBest.wave;
        if (brokeRecord) {
          this.endlessRecordBrokenShown = true;
          this.endlessLastToastWave = world.wave;
          this.showToast(`超越歷史紀錄!目前第 ${world.wave} 波`, 5000);
        } else if (world.wave % 10 === 0) {
          this.endlessLastToastWave = world.wave;
          const survived = fmtMMSS(world.time - world.endlessTimeBase);
          this.showToast(`第 ${world.wave} 波達成・${milestoneFlavor(world.wave)}・已撐 ${survived}`, 4000);
        }
      }
    } else if (!world.endless && this.endlessWasActive) {
      this.endlessWasActive = false;
    }
    this.endlessQuit.style.display =
      world.endless && world.status === 'playing' && (this.solo || this.isHost) ? 'block' : 'none';

    // 共鳴詠唱 toast — fires once per resonance effect (rare/celebratory;
    // reuses the same toast slot as milestones/endless entry).
    let sawResonanceFx = false;
    for (const fx of world.effects) {
      if (fx.kind !== 'resonance') continue;
      sawResonanceFx = true;
      if (this.seenResonanceFx.has(fx.id)) continue;
      this.seenResonanceFx.add(fx.id);
      this.showToast('共鳴詠唱!全隊獲得祝福', 3000);
    }
    if (sawResonanceFx && this.seenResonanceFx.size > 8) {
      // Prune stale ids so this set doesn't grow unbounded across a long session.
      const liveIds = new Set(world.effects.filter((e) => e.kind === 'resonance').map((e) => e.id));
      for (const id of this.seenResonanceFx) if (!liveIds.has(id)) this.seenResonanceFx.delete(id);
    }

    // Player status panels — self first. A disconnected teammate is kept
    // (not filtered out) and shown as "已離開" instead of just vanishing —
    // silently dropping the panel read as "did the game break?" with zero
    // explanation. The first render() that observes a connected→disconnected
    // transition also fires a toast (self is never toasted for their own
    // connection — that's the "連線中斷" screen's job, not this one's).
    for (const p of world.players) {
      if (p.connected) this.seenConnected.add(p.id);
      else if (p.id !== selfId && this.seenConnected.delete(p.id)) {
        this.showToast(`${p.name} 已離開`, 3000);
      }
    }
    const players = world.players.sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : 0));
    this.hud.innerHTML = players.map((p) => this.panel(p, p.id === selfId, world.time)).join('');
  }

  private panel(p: Player, isSelf: boolean, now: number): string {
    const def = CLASSES[p.classId];
    const head = `<div class="pname">${isSelf ? '★ ' : ''}${esc(p.name)} <span class="prole">${def.displayName}</span></div>`;
    if (!p.connected) {
      return `<div class="pstat dim" style="border-left-color:${def.color}"><div class="pbody">${head}<div class="prole">已離開</div></div></div>`;
    }
    if (!p.alive) {
      return `<div class="pstat dim" style="border-left-color:${def.color}"><div class="pbody">${head}<div class="prole">已陣亡</div></div></div>`;
    }
    if (p.downed) {
      const pct = Math.round(Math.max(0, Math.min(1, p.reviveProgress)) * 100);
      return `<div class="pstat" style="border-left-color:${def.color}"><div class="pbody">${head}<div class="prole" style="color:#ff9a9a">倒地 ${pct}%</div></div></div>`;
    }
    const frac = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const bar = `<div class="phpbar"><i style="width:${frac * 100}%;background:${hpColor(frac)}"></i><b>${Math.ceil(p.hp)} / ${p.maxHp}</b></div>`;
    const charge = p.classId === 'pyro' ? `<div class="pcharge">爆裂充能 ×${p.pyroCharge ?? 0}</div>` : '';
    return `<div class="pstat" style="border-left-color:${def.color}"><div class="pbody">${head}${bar}${charge}<div class="pcds">${cdPips(p, now)}</div></div></div>`;
  }
}
