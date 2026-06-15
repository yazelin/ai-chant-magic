import { World } from '../sim/types';
import { SPELLS } from '../sim/spells';
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

  constructor() {
    this.hud = document.getElementById('hud')!;
    this.mic = document.getElementById('mic-status')!;
  }

  setMicStatus(s: VoiceStatus, message?: string): void {
    this.mic.textContent = message && message.length > 0 ? `麥克風:${message}` : MIC_LABEL[s];
  }

  render(world: World): void {
    const spellList = Object.values(SPELLS)
      .map((s) => s.displayName)
      .join('、');
    const status = world.status === 'gameover'
      ? `遊戲結束 — 撐到第 ${world.wave} 波,擊殺 ${world.score}(按 R 重來)`
      : `HP ${Math.ceil(world.player.hp)}/${world.player.maxHp} | 第 ${world.wave} 波 | 擊殺 ${world.score}`;
    this.hud.textContent = `${status} ｜ 可喊法術:${spellList}`;
  }
}
