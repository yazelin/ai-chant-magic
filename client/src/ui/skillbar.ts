import { World, ClassId, SpellId, CLASSES, SPELLS } from '@acm/shared';
import { skillIconSvg } from './skillIcons';

// Bottom-centre skill bar for the LOCAL player: one slot per loadout spell, each
// showing its glyph icon, hotkey, a radial cooldown sweep + remaining seconds,
// greyscale when unavailable, and (惠惠) a charge badge. Non-blocking overlay so
// touch passes through to the canvas. Built once per class, updated each tick.
interface Slot {
  root: HTMLElement;
  icon: HTMLElement;
  cd: HTMLElement; // conic sweep overlay
  num: HTMLElement; // remaining seconds
  badge: HTMLElement; // charge (pyro)
  spell: SpellId;
  total: number; // cooldown length of the in-progress cooldown (for ring fraction)
}

const STYLE = `
#skillbar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: flex; gap: 12px; z-index: 60; pointer-events: none; }
#skillbar .slot { position: relative; width: 58px; height: 58px; border-radius: 12px;
  background: rgba(20,20,38,0.78); border: 1px solid #33335a; box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
#skillbar .slot.ready { border-color: currentColor; box-shadow: 0 0 10px -2px currentColor; }
#skillbar .icon { position: absolute; inset: 9px; transition: filter .12s; }
#skillbar .slot.cooling .icon, #skillbar .slot.locked .icon { filter: grayscale(1) brightness(0.6); }
#skillbar .cd { position: absolute; inset: 0; border-radius: 12px; pointer-events: none; }
#skillbar .num { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font: 700 18px system-ui, sans-serif; color: #fff; text-shadow: 0 1px 3px #000; }
#skillbar .key { position: absolute; left: 4px; top: 2px; font: 700 11px system-ui, sans-serif; color: #9aa0b5; }
#skillbar .badge { position: absolute; right: -5px; top: -6px; min-width: 20px; height: 20px; padding: 0 4px;
  border-radius: 10px; background: #ff8c1a; color: #1a1208; font: 800 13px system-ui, sans-serif;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,0.5); }
`;

export class SkillBar {
  private root: HTMLElement;
  private slots: Slot[] = [];
  private cls: ClassId | null = null;

  constructor() {
    if (!document.getElementById('skillbar-style')) {
      const s = document.createElement('style');
      s.id = 'skillbar-style';
      s.textContent = STYLE;
      document.head.appendChild(s);
    }
    this.root = document.createElement('div');
    this.root.id = 'skillbar';
    // Live inside the in-game chrome so it only shows during play (hidden in lobby).
    (document.getElementById('game-chrome') ?? document.body).appendChild(this.root);
  }

  private build(cls: ClassId): void {
    this.root.innerHTML = '';
    this.slots = [];
    CLASSES[cls].spells.forEach((spell, i) => {
      const root = document.createElement('div');
      root.className = 'slot';
      root.style.color = CLASSES[cls].color;
      root.innerHTML =
        `<div class="icon">${skillIconSvg(spell)}</div>` +
        `<div class="cd"></div><div class="num"></div>` +
        `<div class="key">${i + 1}</div><div class="badge"></div>`;
      this.root.appendChild(root);
      this.slots.push({
        root,
        icon: root.querySelector('.icon') as HTMLElement,
        cd: root.querySelector('.cd') as HTMLElement,
        num: root.querySelector('.num') as HTMLElement,
        badge: root.querySelector('.badge') as HTMLElement,
        spell,
        total: SPELLS[spell].cooldown || 1,
      });
    });
    this.cls = cls;
  }

  update(world: World, selfId: string | null): void {
    const self = selfId ? world.players.find((p) => p.id === selfId) : undefined;
    if (!self) { this.root.style.display = 'none'; return; }
    this.root.style.display = 'flex';
    if (self.classId !== this.cls) this.build(self.classId);

    const charge = self.classId === 'pyro' ? self.pyroCharge ?? 0 : 0;
    for (const s of this.slots) {
      const ready = (self.cooldowns?.[s.spell] ?? 0);
      let remaining = Math.max(0, ready - world.time);
      // 爆裂魔法 also "locked" with no charge (can't cast even off cooldown).
      const locked = s.spell === 'firestorm' && charge < 1;

      // Track the in-progress cooldown length so the ring fraction is correct even
      // for 爆裂's dynamic cooldown (lengthens with charge).
      if (remaining > s.total) s.total = remaining;
      if (remaining <= 0.01) s.total = SPELLS[s.spell].cooldown || 1;

      const cooling = remaining > 0.05;
      s.root.classList.toggle('cooling', cooling);
      s.root.classList.toggle('locked', locked && !cooling);
      s.root.classList.toggle('ready', !cooling && !locked);

      if (cooling) {
        const deg = Math.min(360, 360 * (remaining / s.total));
        s.cd.style.background = `conic-gradient(rgba(0,0,0,0.6) ${deg}deg, transparent 0)`;
        s.num.textContent = remaining >= 1 ? Math.ceil(remaining).toString() : remaining.toFixed(1);
      } else {
        s.cd.style.background = 'transparent';
        s.num.textContent = '';
      }

      // 惠惠 charge badge on the 爆裂 slot (the consumer); hidden otherwise.
      if (s.spell === 'firestorm' && self.classId === 'pyro') {
        s.badge.style.display = 'flex';
        s.badge.textContent = `×${charge}`;
      } else {
        s.badge.style.display = 'none';
      }
    }
  }
}
