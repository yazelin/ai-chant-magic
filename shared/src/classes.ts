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
