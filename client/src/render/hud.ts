import { World, Player, CLASSES } from '@acm/shared';
import { VoiceStatus } from '../voice/recognizer';
import { skillIconSvg } from '../ui/skillIcons';

// A small per-spell cooldown pip for the party panel (so players can see each
// other's cooldowns): coloured when ready, greyscale + dimmed while cooling.
function cdPips(p: Player, now: number): string {
  return CLASSES[p.classId].spells
    .map((id) => {
      const cooling = (p.cooldowns?.[id] ?? 0) - now > 0.05;
      const f = cooling ? 'filter:grayscale(1) brightness(0.55);opacity:.7' : '';
      return `<span style="display:inline-block;width:15px;height:15px;color:${CLASSES[p.classId].color};${f}">${skillIconSvg(id)}</span>`;
    })
    .join('');
}

const MIC_LABEL: Record<VoiceStatus, string> = {
  idle: '麥克風:未啟動',
  listening: '麥克風:聆聽中',
  unsupported: '麥克風:此瀏覽器不支援語音(請用 Chrome/Edge)',
  denied: '麥克風:權限被拒,請允許麥克風',
  error: '麥克風:語音發生問題',
};

export class Hud {
  private hud: HTMLElement;
  private mic: HTMLElement;
  private heard: HTMLElement;

  constructor() {
    this.hud = document.getElementById('hud')!;
    this.mic = document.getElementById('mic-status')!;
    // "Last heard" line: shows exactly what speech recognition transcribed and
    // whether it matched a spell — the fastest way to debug why a spell name
    // isn't firing (the transcript rarely equals what you think you said).
    this.heard = document.createElement('div');
    this.heard.id = 'heard';
    this.heard.style.cssText =
      'font-size:13px;color:#8a8ca0;min-height:18px;max-width:90vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    this.mic.parentElement?.appendChild(this.heard);
  }

  setMicStatus(s: VoiceStatus, message?: string): void {
    this.mic.textContent = message && message.length > 0 ? `麥克風:${message}` : MIC_LABEL[s];
  }

  // Show the latest recognized transcript and whether it mapped to a spell.
  setHeard(text: string, matchedSpellName: string | null): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (matchedSpellName) {
      this.heard.style.color = '#ffb15a';
      this.heard.textContent = `聽到:「${trimmed}」 → ${matchedSpellName} ✓`;
    } else {
      this.heard.style.color = '#8a8ca0';
      this.heard.textContent = `聽到:「${trimmed}」 → 未對應法術`;
    }
  }

  render(world: World, selfId: string | null = null): void {
    // Party panel: one entry per connected player (name / class / hp / state) plus
    // small cooldown pips so everyone can see each other's skill cooldowns.
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
    const party = world.players
      .filter((p) => p.connected)
      .map((p) => {
        const cls = CLASSES[p.classId].displayName;
        const me = p.id === selfId ? '★' : '';
        let line: string;
        if (!p.alive) line = `${me}${esc(p.name)}(${cls}):陣亡`;
        else if (p.downed) {
          const pct = Math.round(Math.max(0, Math.min(1, p.reviveProgress)) * 100);
          line = `${me}${esc(p.name)}(${cls}):倒地 ${pct}%`;
        } else {
          const charge = p.classId === 'pyro' ? ` 爆裂×${p.pyroCharge ?? 0}` : '';
          line = `${me}${esc(p.name)}(${cls}):HP ${Math.ceil(p.hp)}/${p.maxHp}${charge}`;
        }
        const pips = p.alive && !p.downed ? ` <span style="vertical-align:middle">${cdPips(p, world.time)}</span>` : '';
        return `<span style="white-space:nowrap">${line}${pips}</span>`;
      })
      .join(' <span style="opacity:.4">｜</span> ');

    const head =
      world.status === 'gameover'
        ? `遊戲結束 — 撐到第 ${world.wave} 波,擊殺 ${world.score}(按 R 重來)`
        : `第 ${world.wave} 波 ｜ 隊伍擊殺 ${world.score}`;

    this.hud.innerHTML = `${esc(head)} <span style="opacity:.4">｜</span> ${party}`;
  }
}
