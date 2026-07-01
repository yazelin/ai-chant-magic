import { SpellId } from './types';

export type SpellKind =
  | 'projectile'   // fired along facing, travels, collides
  | 'aoe-self'     // instant area centred on the caster
  | 'hitscan'      // instant ray along facing
  | 'chain'        // greedy nearest-enemy chain from the caster
  | 'buff-self'    // self-only buff (shield) / 惠惠 詠唱 charge
  | 'buff-allies'  // buff to nearby alive allies (aegis)
  | 'heal-allies'  // restore hp to nearby alive allies (heal)
  | 'heal-self';   // restore hp to the caster only (精靈自癒)

export interface SpellDef {
  id: SpellId;
  displayName: string;      // shown in HUD (中文)
  aliases: string[];        // raw match terms (中文 + 英文); normalized at match time
  cooldown: number;         // seconds
  kind: SpellKind;
  directional: boolean;     // true = aimed along facing; false = self/ally-target
}

export const SPELLS: Record<SpellId, SpellDef> = {
  fireball:  { id: 'fireball',  displayName: '火球術',   aliases: ['火球術', '火球', 'fireball', 'fire'],                cooldown: 1.2, kind: 'projectile',   directional: true },
  firestorm: { id: 'firestorm', displayName: '爆裂魔法', aliases: ['爆裂魔法', '爆裂', '火海', '火焰', '烈焰', '大火', '火燄', '烈焰風暴', 'firestorm', 'explosion', 'inferno', 'flame'], cooldown: 7, kind: 'projectile', directional: true },
  frost:     { id: 'frost',     displayName: '冰柱魔線', aliases: ['冰柱魔線', '冰柱', '冰錐', '冰霜', '冰', 'frost', 'ice', '賓住', '並註', '冰住', '賓柱', '賓住無限', '冰柱無限', '因住無限', '並祝無限', '編著魔線', '奔著魔線'], cooldown: 1.5, kind: 'projectile', directional: true },
  frostnova: { id: 'frostnova', displayName: '絕對零度', aliases: ['絕對零度', '絕對零', '凍結', '冰結', 'frostnova', 'freeze'], cooldown: 5, kind: 'aoe-self', directional: false },
  thunder:   { id: 'thunder',   displayName: '超電磁砲', aliases: ['超電磁砲', '電磁砲', '雷擊', '閃電', '雷', 'railgun', 'thunder', 'lightning'], cooldown: 2.5, kind: 'hitscan', directional: true },
  chain:     { id: 'chain',     displayName: '落雷',     aliases: ['落雷', '電擊鞭', '連鎖閃電', '閃電鏈', 'chain', 'chainlightning'], cooldown: 3, kind: 'chain', directional: false },
  shield:    { id: 'shield',    displayName: '護盾',     aliases: ['護盾', '護盾術', '盾牌', '護罩', '防護罩', '結界', 'shield', 'guard'], cooldown: 6, kind: 'buff-self', directional: false },
  aegis:     { id: 'aegis',     displayName: '聖盾',     aliases: ['聖盾', '神盾', '盛頓', '永恆閃耀', '永恆閃耀聖盾', '神聖護盾', 'aegis', 'barrier'], cooldown: 9, kind: 'buff-allies', directional: false },
  heal:      { id: 'heal',      displayName: '治療術',   aliases: ['治療術', '治療', '治癒', '補血', 'heal', 'cure'],   cooldown: 7,   kind: 'heal-allies',  directional: false },
  holybolt:  { id: 'holybolt',  displayName: '聖光',     aliases: ['聖光', '聖光術', 'holybolt', 'smite'],              cooldown: 1.0, kind: 'aoe-self',      directional: false },
  // 惠惠's kit: two no-cooldown chants stack 爆裂 charge; 爆裂魔法 consumes it.
  chant1:    { id: 'chant1',    displayName: '黑暗',     aliases: ['黑暗', '黑暗詠唱', '詠唱一', 'darkchant'],         cooldown: 0,   kind: 'buff-self',    directional: false },
  chant2:    { id: 'chant2',    displayName: '深淵',     aliases: ['深淵', '深淵詠唱', '詠唱二', 'abysschant'],        cooldown: 0,   kind: 'buff-self',    directional: false },
  mend:      { id: 'mend',      displayName: '精靈自癒', aliases: ['精靈自癒', '精靈治癒', '自癒', '精靈護佑', 'mend'],  cooldown: 8,   kind: 'heal-self',    directional: false },
  repulse:   { id: 'repulse',   displayName: '鐵砂之劍', aliases: ['鐵砂之劍', '鐵砂劍', '鐵砂', '沙鐵劍', 'ironsand'],  cooldown: 6,   kind: 'aoe-self',     directional: false },
};

// 共鳴詠唱 (resonance) is not a class spell — see ResonanceCommand in types.ts
// and CONFIG.resonance/updateResonance in world.ts. It's a shared call-and-
// response phrase every class can shout regardless of loadout, matched
// separately from SPELLS/matchSpell via matchesAny().
export const RESONANCE_ALIASES = ['共鳴詠唱', '共鳴', '同心協力', 'resonance', 'echo'];
