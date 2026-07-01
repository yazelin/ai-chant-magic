import { World, CONFIG, activeClassBonds } from '@acm/shared';

// Top-centre HUD: a segmented level-progress bar (one "level" = boss.every waves,
// ending in that level's boss), the current wave filling by how much of it is
// cleared; a "下一波 N" countdown during the break; and — while a boss is alive
// — a prominent fixed boss HP bar visible from anywhere on the map.
const SEGS = CONFIG.boss.every;
// Boss name by world.levelId — keep in lockstep with shared/world.ts's
// spawnBoss() element choice (and MAX_LEVEL_ID) as new worlds ship.
const BOSS_NAMES = ['史萊姆王', '冰靈女王', '雷靈王', '聖杯女王'];

const STYLE = `
#wavehud { position: fixed; top: 6px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  z-index: 61; pointer-events: none; font-family: system-ui, sans-serif; }
#wavehud .wlabel { font-size: 12px; color: #c7cbdb; text-shadow: 0 1px 2px #000; }
#wavehud .segs { display: flex; gap: 3px; }
#wavehud .seg { width: 64px; height: 9px; border-radius: 4px; background: #2a2a44;
  overflow: hidden; box-shadow: inset 0 0 0 1px #44446a; position: relative; }
#wavehud .seg.boss { box-shadow: inset 0 0 0 1px #ffd24d; }
#wavehud .seg > i { display: block; height: 100%; width: 0; background: #b06cff; }
#wavehud .seg.boss > i { background: #ffd24d; }
#wavehud .count { font-size: 22px; font-weight: 800; color: #ffd24d; text-shadow: 0 2px 4px #000; }
#wavehud .bond { font-size: 11px; color: #ffd24d; text-shadow: 0 1px 2px #000; display: none; }
#wavehud .bossbar { display: none; flex-direction: column; align-items: center; gap: 2px; margin-top: 2px; }
#wavehud .bossbar .bl { font-size: 13px; font-weight: 800; color: #ffd24d; text-shadow: 0 1px 3px #000; letter-spacing: 1px; }
#wavehud .bossbar .bbar { width: min(620px, 86vw); height: 16px; border-radius: 8px;
  background: #2a1420; box-shadow: inset 0 0 0 2px #d23c6b; overflow: hidden; }
#wavehud .bossbar .bbar > i { display: block; height: 100%; width: 100%;
  background: linear-gradient(#ff5a86, #c0203f); transition: width .12s linear; }
`;

export class WaveHud {
  private root: HTMLElement;
  private label: HTMLElement;
  private segEls: HTMLElement[] = [];
  private segBoxEls: HTMLElement[] = []; // outer .seg divs (toggle the gold "boss" highlight)
  private count: HTMLElement;
  private bond: HTMLElement;
  private bossBox: HTMLElement;
  private bossFill: HTMLElement;
  private bossLabel: HTMLElement;
  // within-wave progress tracking
  private trackedWave = -1;
  private waveTotal = 0;
  // boss hp tracking (first-seen hp = full, like the enemy bars)
  private bossId: number | null = null;
  private bossMax = 0;

  constructor() {
    if (!document.getElementById('wavehud-style')) {
      const s = document.createElement('style');
      s.id = 'wavehud-style';
      s.textContent = STYLE;
      document.head.appendChild(s);
    }
    this.root = document.createElement('div');
    this.root.id = 'wavehud';
    const segs = '<div class="segs">' +
      Array.from({ length: SEGS }, (_, i) =>
        `<div class="seg${i === SEGS - 1 ? ' boss' : ''}"><i></i></div>`).join('') +
      '</div>';
    this.root.innerHTML =
      `<div class="wlabel"></div>${segs}<div class="count"></div><div class="bond"></div>` +
      `<div class="bossbar"><div class="bl">史萊姆王</div><div class="bbar"><i></i></div></div>`;
    (document.getElementById('game-chrome') ?? document.body).appendChild(this.root);
    this.label = this.root.querySelector('.wlabel') as HTMLElement;
    this.segBoxEls = Array.from(this.root.querySelectorAll('.seg')) as HTMLElement[];
    this.segEls = Array.from(this.root.querySelectorAll('.seg > i')) as HTMLElement[];
    this.count = this.root.querySelector('.count') as HTMLElement;
    this.bond = this.root.querySelector('.bond') as HTMLElement;
    this.bossBox = this.root.querySelector('.bossbar') as HTMLElement;
    this.bossFill = this.root.querySelector('.bossbar .bbar > i') as HTMLElement;
    this.bossLabel = this.root.querySelector('.bossbar .bl') as HTMLElement;
  }

  update(world: World): void {
    const wave = Math.max(1, world.wave);
    // Each level restarts its own wave count at a transition (see world.ts), so
    // the chapter number is world.levelId directly, not derived from wave.
    const level = world.levelId + 1;
    const inBlock = (wave - 1) % SEGS; // 0..SEGS-1, last = boss wave

    // within-wave progress from spawnQueue + alive enemies (recorded at wave start)
    const alive = world.enemies.length;
    const remaining = world.spawnQueue + alive;
    if (world.wave !== this.trackedWave) {
      this.trackedWave = world.wave;
      this.waveTotal = Math.max(1, remaining);
    }
    if (remaining > this.waveTotal) this.waveTotal = remaining;
    const breaking = world.breakTimer > 0;
    const waveFrac = breaking ? 1 : Math.max(0, Math.min(1, 1 - remaining / this.waveTotal));

    if (world.endless) {
      const runScore = world.score - world.endlessKillBase;
      this.label.textContent = `無盡模式　第 ${wave} 波　擊殺 ${runScore}`;
    } else {
      this.label.textContent = `關卡 ${level}　第 ${wave} 波　擊殺 ${world.score}`;
    }

    // 職業搭配羈絆 — mirrors the sim's in-fight gating (connected/alive/not
    // downed) so the readout always matches what's actually boosting damage.
    // Hidden with 0 active pairs (solo, or a same-class party) — nothing to show.
    const present = new Set(
      world.players.filter((p) => p.connected && p.alive && !p.downed).map((p) => p.classId),
    );
    const bonds = activeClassBonds(present);
    if (bonds.length > 0) {
      const pct = Math.round(bonds.length * CONFIG.classBond.bonusPerPair * 100);
      this.bond.textContent = `羈絆 +${pct}%(${bonds.map((b) => b.name).join('、')})`;
      this.bond.style.display = 'block';
    } else {
      this.bond.style.display = 'none';
    }
    // The last segment's gold "boss wave" highlight only means something in the
    // campaign (a fixed every-5th wave); endless's elite cadence drifts
    // (5/4/3), so it's just a plain progress readout there.
    const lastIdx = this.segEls.length - 1;
    if (lastIdx >= 0) this.segBoxEls[lastIdx]?.classList.toggle('boss', !world.endless);
    for (let i = 0; i < this.segEls.length; i++) {
      const f = i < inBlock ? 1 : i === inBlock ? waveFrac : 0;
      this.segEls[i].style.width = `${Math.round(f * 100)}%`;
    }
    this.count.textContent = breaking ? `下一波 ${Math.ceil(world.breakTimer)}` : '';
    this.count.style.display = breaking ? 'block' : 'none'; // don't reserve space when idle

    // Fixed boss HP bar — a singleton readout that only makes sense in the
    // campaign (exactly one boss at a time). Endless can field up to 3 elites
    // at once (see CONFIG.elite cadence), so this stays hidden there; elites
    // get their own per-enemy hp bar/label in GameScene instead.
    const boss = world.endless ? undefined : world.enemies.find((e) => e.boss);
    if (boss) {
      if (boss.id !== this.bossId) { this.bossId = boss.id; this.bossMax = boss.hp; }
      if (boss.hp > this.bossMax) this.bossMax = boss.hp;
      this.bossBox.style.display = 'flex';
      const frac = Math.max(0, Math.min(1, boss.hp / this.bossMax));
      this.bossFill.style.width = `${frac * 100}%`;
      const name = BOSS_NAMES[world.levelId] ?? BOSS_NAMES[0];
      this.bossLabel.textContent = `${name}　${Math.ceil(Math.max(0, boss.hp))} / ${Math.round(this.bossMax)}`;
    } else {
      this.bossBox.style.display = 'none';
      this.bossId = null;
    }
  }
}
