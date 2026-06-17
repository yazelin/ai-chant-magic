import { SpellId, SPELLS, CONFIG } from '@acm/shared';

// Per-skill display info for the lobby cards: a source-work-flavoured default
// name, a short effect line, and the concrete numbers pulled from CONFIG so the
// card always matches the live balance. Players can later override the cast
// phrase (stage 3); these names are just the defaults shown on the card.
export interface SkillInfo {
  name: string;
  effect: string;
  stats: string;
}

export const SKILL_INFO: Record<SpellId, SkillInfo> = {
  fireball:  { name: '火球術',          effect: '飛行火球,命中爆炸',     stats: `傷害 ${CONFIG.fireball.explosionDamage} · 冷卻 ${SPELLS.fireball.cooldown}s · 爆範圍 ${CONFIG.fireball.explosionRadius}` },
  firestorm: { name: '爆裂魔法',        effect: '超大範圍爆裂',           stats: `傷害 ${CONFIG.firestorm.explosionDamage} · 冷卻 ${SPELLS.firestorm.cooldown}s · 爆範圍 ${CONFIG.firestorm.explosionRadius}` },
  frost:     { name: '冰結',            effect: '三連冰錐,命中減速',     stats: `傷害 ${CONFIG.frost.damage}×${CONFIG.frost.count} · 冷卻 ${SPELLS.frost.cooldown}s · 減速 ${CONFIG.frost.slowDuration}s` },
  frostnova: { name: '冰霜新星',        effect: '自身周圍冰爆 + 減速',    stats: `傷害 ${CONFIG.frostnova.damage} · 冷卻 ${SPELLS.frostnova.cooldown}s · 範圍 ${CONFIG.frostnova.radius}` },
  thunder:   { name: '超電磁砲',        effect: '貫穿雷射',               stats: `傷害 ${CONFIG.thunder.damage} · 冷卻 ${SPELLS.thunder.cooldown}s · 射程 ${CONFIG.thunder.range}` },
  chain:     { name: '電擊鞭',          effect: '連鎖閃電,最多跳 4 個',  stats: `傷害 ${CONFIG.chain.damage} · 冷卻 ${SPELLS.chain.cooldown}s · 跳躍 ${CONFIG.chain.maxJumps}` },
  shield:    { name: '護盾',            effect: '自身護盾',               stats: `持續 ${CONFIG.shield.duration}s · 冷卻 ${SPELLS.shield.cooldown}s` },
  aegis:     { name: '永恆閃耀·聖盾',   effect: '全隊護盾',               stats: `持續 ${CONFIG.aegis.duration}s · 範圍 ${CONFIG.aegis.radius} · 冷卻 ${SPELLS.aegis.cooldown}s` },
  heal:      { name: '治療術',          effect: '治療範圍內隊友',         stats: `治療 ${CONFIG.heal.amount} · 範圍 ${CONFIG.heal.radius} · 冷卻 ${SPELLS.heal.cooldown}s` },
  holybolt:  { name: '聖光',            effect: '飛行聖光彈',             stats: `傷害 ${CONFIG.holybolt.damage} · 冷卻 ${SPELLS.holybolt.cooldown}s` },
};
