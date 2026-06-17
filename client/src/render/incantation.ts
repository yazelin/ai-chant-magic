// Megumin chant easter egg: as 惠惠 stacks 爆裂 charge (黑暗/深淵), reveal the real
// KonoSuba explosion incantation line by line; on the explosion, flash the finale.
// Driven from the local pyro player's pyroCharge each HUD tick.
const LINES = [
  '比黑暗更漆黑者',
  '比闇夜更深沉者,以吾深紅交融',
  '覺醒之刻已至',
  '墜落於無謬之境的真理啊',
  '化作無形的扭曲,現身吧',
  '舞動吧、舞動吧、舞動吧',
  '渴求吾魔力奔湧、無可匹敵的崩壞之力',
  '讓一切現象歸於塵埃',
  '自深淵滾滾溢出吧',
];
const FINALE = '這是人類最強的攻擊魔法——爆裂——!!!';

export class IncantationOverlay {
  private el: HTMLElement;
  private prevCharge = 0;
  private finaleUntil = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'incantation';
    this.el.style.cssText = [
      'position:fixed', 'left:50%', 'top:14%', 'transform:translateX(-50%)',
      'max-width:90vw', 'text-align:center', 'pointer-events:none', 'z-index:50',
      'font-weight:800', 'letter-spacing:2px', 'display:none', 'transition:opacity .15s',
    ].join(';');
    document.body.appendChild(this.el);
  }

  // charge = local 惠惠's current 爆裂 charge; now = ms timestamp
  update(charge: number, now: number): void {
    if (this.prevCharge > 0 && charge === 0) this.finaleUntil = now + 2000; // just exploded
    this.prevCharge = charge;

    if (now < this.finaleUntil) {
      this.show(FINALE, true);
    } else if (charge > 0) {
      this.show(LINES[Math.min(charge, LINES.length) - 1], false);
    } else {
      this.el.style.display = 'none';
    }
  }

  private show(text: string, finale: boolean): void {
    this.el.textContent = text;
    this.el.style.display = 'block';
    this.el.style.color = finale ? '#ffd24d' : '#ff7a4d';
    this.el.style.fontSize = finale ? '34px' : '22px';
    this.el.style.textShadow = finale
      ? '0 0 18px #ff5a2a, 0 0 6px #fff'
      : '0 0 12px #ff5a2a';
  }
}
