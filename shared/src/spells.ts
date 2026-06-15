import { SpellId } from './types';

export interface SpellDef {
  id: SpellId;
  displayName: string;      // shown in HUD (中文)
  aliases: string[];        // raw match terms (中文 + 英文); normalized at match time
  cooldown: number;         // seconds
  directional: boolean;     // true = fired along facing; false = self-target
}

export const SPELLS: Record<SpellId, SpellDef> = {
  fireball: { id: 'fireball', displayName: '火球術', aliases: ['火球術', '火球', 'fireball', 'fire'], cooldown: 1.2, directional: true },
  frost:    { id: 'frost',    displayName: '冰霜',   aliases: ['冰錐', '冰霜', '冰', 'frost', 'ice'], cooldown: 1.5, directional: true },
  thunder:  { id: 'thunder',  displayName: '雷擊',   aliases: ['雷擊', '閃電', '雷', 'thunder', 'lightning'], cooldown: 2.5, directional: true },
  shield:   { id: 'shield',   displayName: '護盾',   aliases: ['護盾', '結界', 'shield', 'guard'], cooldown: 6, directional: false },
  heal:     { id: 'heal',     displayName: '治療術', aliases: ['治療術', '治療', '治癒', '補血', 'heal', 'cure'], cooldown: 8, directional: false },
};

// Default incantation (呪文) required before a spell name in 詠唱(eishō) mode.
export const JUMON = '我命汝顯現';
