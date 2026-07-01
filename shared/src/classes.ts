import { ClassId, SpellId } from './types';

export interface ClassDef {
  id: ClassId;
  displayName: string;
  spells: SpellId[];
  shape: 'diamond' | 'hexagon' | 'triangle' | 'circle';
  color: string;
  hpMod: number;
  speedMod: number;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  pyro:   { id: 'pyro',   displayName: '炎術士', spells: ['chant1', 'chant2', 'firestorm'],   shape: 'diamond',  color: '#ff8c1a', hpMod: 1.0,  speedMod: 1.0 },
  cryo:   { id: 'cryo',   displayName: '冰精靈', spells: ['frost', 'frostnova', 'mend'],      shape: 'hexagon',  color: '#39c5e0', hpMod: 1.0,  speedMod: 1.0 },
  storm:  { id: 'storm',  displayName: '電擊使', spells: ['thunder', 'chain', 'repulse'],     shape: 'triangle', color: '#b06cff', hpMod: 0.95, speedMod: 1.08 },
  warden: { id: 'warden', displayName: '守護者', spells: ['heal', 'aegis', 'holybolt'],       shape: 'circle',   color: '#ffd24d', hpMod: 1.2,  speedMod: 0.95 },
};

export function classSpellSet(c: ClassId): Set<SpellId> {
  return new Set(CLASSES[c].spells);
}

// 職業搭配羈絆: a named flavour label per unordered class pair — purely
// cosmetic naming, the mechanical effect (a shared skill-power multiplier) is
// uniform across all 6 pairs (see shared/world.ts's classBondMultiplier).
// Gives players a reason to talk about "who should play what" before a run,
// without hand-tuning 6 different bespoke effects.
export interface ClassBond {
  pair: [ClassId, ClassId];
  name: string;
}

export const CLASS_BONDS: ClassBond[] = [
  { pair: ['pyro', 'cryo'], name: '冰火相濟' },
  { pair: ['pyro', 'storm'], name: '雷炎共振' },
  { pair: ['pyro', 'warden'], name: '庇護烈焰' },
  { pair: ['cryo', 'storm'], name: '凍雷交織' },
  { pair: ['cryo', 'warden'], name: '冰霜壁壘' },
  { pair: ['storm', 'warden'], name: '雷光聖盾' },
];

// Which bonds are active given the set of distinct classes currently present
// (the caller decides "present" — e.g. connected/alive/not-downed players only,
// matching every other party-wide buff's inFight gating).
export function activeClassBonds(classesPresent: Set<ClassId>): ClassBond[] {
  return CLASS_BONDS.filter((b) => classesPresent.has(b.pair[0]) && classesPresent.has(b.pair[1]));
}
