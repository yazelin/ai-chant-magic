import { SpellId, SPELLS, CONFIG } from '@acm/shared';

// Per-skill display info for the lobby cards: a source-work-flavoured default
// name, a short effect line, and the concrete numbers pulled from CONFIG so the
// card always matches the live balance. Players can later override the cast
// phrase (stage 3); these names are just the defaults shown on the card.
export interface SkillInfo {
  name: string;
  effect: string;
  stats: string;
  detail: string; // full description shown on hover
}

// How the spell is aimed, derived from its kind/directional for the tooltip.
export function castType(id: SpellId): string {
  const s = SPELLS[id];
  switch (s.kind) {
    case 'projectile':
    case 'hitscan':
      return '朝滑鼠方向';
    case 'aoe-self':
      return '以自身為中心';
    case 'chain':
      return '自動鎖定最近的敵人';
    case 'buff-self':
      return '施加於自身';
    case 'buff-allies':
    case 'heal-allies':
      return '自身周圍的隊友(含自己)';
    default:
      return s.directional ? '朝滑鼠方向' : '自身';
  }
}

export const SKILL_INFO: Record<SpellId, SkillInfo> = {
  fireball:  { name: '火球術',          effect: '飛行火球,命中爆炸',     stats: `傷害 ${CONFIG.fireball.explosionDamage} · 冷卻 ${SPELLS.fireball.cooldown}s · 爆範圍 ${CONFIG.fireball.explosionRadius}`, detail: '朝滑鼠方向射出一顆火球,飛行中撞到敵人即爆炸,對爆炸範圍內所有敵人造成傷害。射速快、冷卻短,是炎術士的主要輸出手段。' },
  firestorm: { name: '爆裂魔法',        effect: '超大範圍爆裂',           stats: `傷害 ${CONFIG.firestorm.explosionDamage} · 冷卻 ${SPELLS.firestorm.cooldown}s · 爆範圍 ${CONFIG.firestorm.explosionRadius}`, detail: '朝滑鼠方向射出緩速的爆裂核心,引發全場最大範圍與最高傷害的爆炸。代價是極長冷卻——惠惠的招牌一擊,一發入魂。' },
  frost:     { name: '冰霜新星',        effect: '三連冰錐,命中減速',     stats: `傷害 ${CONFIG.frost.damage}×${CONFIG.frost.count} · 冷卻 ${SPELLS.frost.cooldown}s · 減速 ${CONFIG.frost.slowDuration}s`, detail: `朝滑鼠方向同時射出 ${CONFIG.frost.count} 道冰錐(扇形散射),命中造成傷害並大幅減速敵人,適合風箏與壓制推進。` },
  frostnova: { name: '冰結',            effect: '自身範圍凍結敵人',       stats: `傷害 ${CONFIG.frostnova.damage} · 冷卻 ${SPELLS.frostnova.cooldown}s · 凍結 ${CONFIG.frostnova.slowDuration}s · 範圍 ${CONFIG.frostnova.radius}`, detail: '以自身為中心引爆冰霜,對範圍內所有敵人造成傷害並「完全凍結」——凍結期間敵人無法移動。被包圍時的解圍與控場核心。' },
  thunder:   { name: '超電磁砲',        effect: '貫穿雷射',               stats: `傷害 ${CONFIG.thunder.damage} · 冷卻 ${SPELLS.thunder.cooldown}s · 射程 ${CONFIG.thunder.range}`, detail: '朝滑鼠方向瞬發一道貫穿雷射,擊中直線上所有敵人。高傷、長射程、瞬發——御坂美琴的標誌絕招。' },
  chain:     { name: '電擊鞭',          effect: '連鎖閃電,最多跳 4 個',  stats: `傷害 ${CONFIG.chain.damage} · 冷卻 ${SPELLS.chain.cooldown}s · 跳躍 ${CONFIG.chain.maxJumps}`, detail: `從最近的敵人開始連鎖閃電,最多跳 ${CONFIG.chain.maxJumps} 個目標,每跳傷害遞減為 ${Math.round(CONFIG.chain.falloff * 100)}%。清成群雜兵的神技。` },
  shield:    { name: '護盾',            effect: '自身護盾',               stats: `持續 ${CONFIG.shield.duration}s · 冷卻 ${SPELLS.shield.cooldown}s`, detail: '為自身張開護盾,持續數秒,擋下期間受到的傷害。三系法師共通的自保技。' },
  aegis:     { name: '永恆閃耀·聖盾',   effect: '全隊護盾',               stats: `持續 ${CONFIG.aegis.duration}s · 範圍 ${CONFIG.aegis.radius} · 冷卻 ${SPELLS.aegis.cooldown}s`, detail: '揮舞聖旗,為範圍內所有隊友(含自己)張開聖盾。貞德的團隊保命寶具,危急時的最後防線。' },
  heal:      { name: '治療術',          effect: '治療範圍內隊友',         stats: `治療 ${CONFIG.heal.amount} · 範圍 ${CONFIG.heal.radius} · 冷卻 ${SPELLS.heal.cooldown}s`, detail: '治療範圍內所有存活隊友(含自己),恢復生命值。貞德的續航核心,讓隊伍站得更久。' },
  holybolt:  { name: '聖光',            effect: '自身範圍聖光爆',         stats: `傷害 ${CONFIG.holybolt.damage} · 冷卻 ${SPELLS.holybolt.cooldown}s · 範圍 ${CONFIG.holybolt.radius}`, detail: '以自身為中心爆發聖光,對周圍範圍內所有敵人造成傷害。冷卻極短,貞德站在隊伍中央邊奶邊脈衝輸出。' },
};
