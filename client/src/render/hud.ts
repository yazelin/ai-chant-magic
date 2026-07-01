import { World, Player, CLASSES } from '@acm/shared';
import { VoiceStatus } from '../voice/recognizer';
import { skillIconSvg } from '../ui/skillIcons';

// Short mic-pill labels (the long permission instruction shows as a .note below).
const MIC_LABEL: Record<VoiceStatus, string> = {
  idle: '麥克風待命',
  listening: '聆聽中',
  unsupported: '不支援語音',
  denied: '麥克風被拒',
  error: '語音異常',
};

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

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
  private levelClear: HTMLElement;
  private heardTimer: ReturnType<typeof setTimeout> | null = null;
  private levelClearTimer: ReturnType<typeof setTimeout> | null = null;
  private goShown = false;
  private levelClearShown = false;

  constructor(
    private solo = false,
    private onRestart: () => void = () => {},
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
    // Level-clear toast (boss down): non-blocking, top-centre, auto-fades. Text
    // only for now — a scene transition/new level is future work (see roadmap).
    this.levelClear = document.createElement('div');
    this.levelClear.id = 'level-clear-toast';
    this.levelClear.style.cssText =
      'position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:6;pointer-events:none;display:none;' +
      'text-align:center;font:800 20px system-ui,sans-serif;color:#ffd24d;text-shadow:0 2px 8px #000;' +
      'background:rgba(16,16,34,0.82);border:1px solid #ffd24d;border-radius:14px;padding:12px 24px;';
    (document.getElementById('game-chrome') ?? document.body).appendChild(this.levelClear);
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

  render(world: World, selfId: string | null = null): void {
    // Game-over banner — built once on the status flip (so its 重來 button keeps
    // a live click handler instead of being recreated every tick).
    if (world.status === 'gameover' && !this.goShown) {
      this.goShown = true;
      this.gameover.style.display = 'block';
      const hint = this.solo
        ? '<button id="go-restart" style="pointer-events:auto;cursor:pointer;margin-top:12px;background:var(--accent);color:#1a1030;border:none;border-radius:10px;padding:9px 22px;font:800 16px system-ui;">重來</button>'
        : '<div style="font-size:13px;color:#9aa0b5;margin-top:10px">等所有人都倒下…回到房間</div>';
      this.gameover.innerHTML = `遊戲結束<div style="font-size:14px;font-weight:600;color:#c7cbdb;margin:6px 0">撐到第 ${world.wave} 波 · 擊殺 ${world.score}</div>${hint}`;
      this.gameover.querySelector('#go-restart')?.addEventListener('click', () => this.onRestart());
    } else if (world.status !== 'gameover' && this.goShown) {
      this.goShown = false;
      this.gameover.style.display = 'none';
    }
    // Level-clear toast — fires once on the levelCleared flip, auto-fades, resets
    // on restart (a fresh world has levelCleared back to false).
    if (world.levelCleared && !this.levelClearShown) {
      this.levelClearShown = true;
      this.levelClear.textContent = '史萊姆王 討伐!世界已淨化';
      this.levelClear.style.display = 'block';
      if (this.levelClearTimer) clearTimeout(this.levelClearTimer);
      this.levelClearTimer = setTimeout(() => { this.levelClear.style.display = 'none'; }, 4000);
    } else if (!world.levelCleared && this.levelClearShown) {
      this.levelClearShown = false;
      this.levelClear.style.display = 'none';
    }
    // Player status panels — self first.
    const players = world.players
      .filter((p) => p.connected)
      .sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : 0));
    this.hud.innerHTML = players.map((p) => this.panel(p, p.id === selfId, world.time)).join('');
  }

  private panel(p: Player, isSelf: boolean, now: number): string {
    const def = CLASSES[p.classId];
    const head = `<div class="pname">${isSelf ? '★ ' : ''}${esc(p.name)} <span class="prole">${def.displayName}</span></div>`;
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
