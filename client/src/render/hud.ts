import { World, ClassId, SPELLS, CLASSES } from '@acm/shared';
import { VoiceStatus } from '../voice/recognizer';

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
  private selfClass: ClassId;

  constructor(selfClass: ClassId) {
    this.hud = document.getElementById('hud')!;
    this.mic = document.getElementById('mic-status')!;
    this.selfClass = selfClass;
  }

  setMicStatus(s: VoiceStatus, message?: string): void {
    this.mic.textContent = message && message.length > 0 ? `麥克風:${message}` : MIC_LABEL[s];
  }

  render(world: World): void {
    // Party panel: one line per connected player (name / class / hp / state).
    const party = world.players
      .filter((p) => p.connected)
      .map((p) => {
        const cls = CLASSES[p.classId].displayName;
        if (!p.alive) return `${p.name}(${cls}):陣亡`;
        if (p.downed) {
          const pct = Math.round(Math.max(0, Math.min(1, p.reviveProgress)) * 100);
          return `${p.name}(${cls}):倒地 ${pct}%`;
        }
        return `${p.name}(${cls}):HP ${Math.ceil(p.hp)}/${p.maxHp}`;
      })
      .join(' ｜ ');

    const spellHints = CLASSES[this.selfClass].spells
      .map((id, i) => `${i + 1} ${SPELLS[id].displayName}`)
      .join('、');

    const head =
      world.status === 'gameover'
        ? `遊戲結束 — 撐到第 ${world.wave} 波,擊殺 ${world.score}(按 R 重來)`
        : `第 ${world.wave} 波 ｜ 隊伍擊殺 ${world.score}`;

    this.hud.textContent = `${head} ｜ ${party} ｜ 你的法術:${spellHints}`;
  }
}
