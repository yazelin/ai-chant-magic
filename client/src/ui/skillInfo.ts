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
    case 'heal-self':
      return '施加於自身';
    default:
      return s.directional ? '朝滑鼠方向' : '自身';
  }
}

export const SKILL_INFO: Record<SpellId, SkillInfo> = {
  fireball:  { name: '火球術',          effect: '飛行火球,命中爆炸',     stats: `傷害 ${CONFIG.fireball.explosionDamage} · 冷卻 ${SPELLS.fireball.cooldown}s · 爆範圍 ${CONFIG.fireball.explosionRadius}`, detail: '朝滑鼠方向射出一顆火球,飛行中撞到敵人即爆炸,對爆炸範圍內所有敵人造成傷害。射速快、冷卻短,是炎術士的主要輸出手段。' },
  firestorm: { name: '爆裂魔法',        effect: '超大範圍爆裂(隨充能放大)', stats: `傷害 ${CONFIG.firestorm.explosionDamage}×層 · 冷卻 ${CONFIG.firestorm.baseCd}+層 s · 範圍 ${CONFIG.firestorm.baseRadius}+${CONFIG.firestorm.perChargeRadius}×層(上限 ${CONFIG.firestorm.maxRadius})`, detail: `惠惠的招牌一擊。需先用詠唱疊「爆裂充能」,至少 1 層才放得出來;充能愈高愈猛:傷害 = ${CONFIG.firestorm.explosionDamage}×層數、範圍隨層數放大、冷卻 = ${CONFIG.firestorm.baseCd} + 層數 秒。放完清空所有充能。` },
  frost:     { name: '冰柱魔線',        effect: '三連冰錐,命中減速',     stats: `傷害 ${CONFIG.frost.damage}×${CONFIG.frost.count} · 冷卻 ${SPELLS.frost.cooldown}s · 減速 ${CONFIG.frost.slowDuration}s`, detail: `朝滑鼠方向同時射出 ${CONFIG.frost.count} 道冰錐(扇形散射),命中造成傷害並大幅減速敵人,適合風箏與壓制推進。` },
  frostnova: { name: '絕對零度',        effect: '自身範圍凍結敵人',       stats: `傷害 ${CONFIG.frostnova.damage} · 冷卻 ${SPELLS.frostnova.cooldown}s · 凍結 ${CONFIG.frostnova.slowDuration}s · 範圍 ${CONFIG.frostnova.radius}`, detail: '以自身為中心降至絕對零度,對範圍內所有敵人造成傷害並「完全凍結」——凍結期間敵人無法移動。被包圍時的解圍與控場核心。' },
  thunder:   { name: '超電磁砲',        effect: '貫穿雷射',               stats: `傷害 ${CONFIG.thunder.damage} · 冷卻 ${SPELLS.thunder.cooldown}s · 射程 ${CONFIG.thunder.range}`, detail: '朝滑鼠方向瞬發一道貫穿雷射,擊中直線上所有敵人。高傷、長射程、瞬發——御坂美琴的標誌絕招。' },
  chain:     { name: '電擊鞭',          effect: '連鎖閃電,最多跳 4 個',  stats: `傷害 ${CONFIG.chain.damage} · 冷卻 ${SPELLS.chain.cooldown}s · 跳躍 ${CONFIG.chain.maxJumps}`, detail: `從最近的敵人開始連鎖閃電,最多跳 ${CONFIG.chain.maxJumps} 個目標,每跳傷害遞減為 ${Math.round(CONFIG.chain.falloff * 100)}%。清成群雜兵的神技。` },
  shield:    { name: '護盾',            effect: '自身護盾',               stats: `持續 ${CONFIG.shield.duration}s · 冷卻 ${SPELLS.shield.cooldown}s`, detail: '為自身張開護盾,持續數秒,擋下期間受到的傷害。三系法師共通的自保技。' },
  aegis:     { name: '永恆閃耀·聖盾',   effect: '全隊護盾',               stats: `持續 ${CONFIG.aegis.duration}s · 範圍 ${CONFIG.aegis.radius} · 冷卻 ${SPELLS.aegis.cooldown}s`, detail: '揮舞聖旗,為範圍內所有隊友(含自己)張開聖盾。貞德的團隊保命寶具,危急時的最後防線。' },
  heal:      { name: '治療術',          effect: '範圍隊友持續回血',       stats: `每秒回 ${CONFIG.heal.rate} · 持續 ${CONFIG.heal.duration}s · 範圍 ${CONFIG.heal.radius} · 冷卻 ${SPELLS.heal.cooldown}s`, detail: `為範圍內所有存活隊友(含自己)附加持續回血:每秒恢復 ${CONFIG.heal.rate} 點、持續 ${CONFIG.heal.duration}s(共 ${CONFIG.heal.rate * CONFIG.heal.duration} 點),不是瞬補。貞德的續航核心。` },
  chant1:    { name: '黑暗',            effect: '蓄力,+1 爆裂充能',       stats: `+${CONFIG.chant.chargePerCast} 充能 · 無冷卻`, detail: '惠惠的中二詠唱(其一):喊「黑暗」即可,無冷卻、可一直喊,每次 +1 爆裂充能,本身不造成傷害。充能愈高,之後的爆裂魔法愈強。' },
  chant2:    { name: '深淵',            effect: '蓄力,+1 爆裂充能',       stats: `+${CONFIG.chant.chargePerCast} 充能 · 無冷卻`, detail: '惠惠的中二詠唱(其二):喊「深淵」即可,無冷卻、可一直喊,每次 +1 爆裂充能。跟「黑暗」一起無限疊,堆愈多爆裂愈猛。' },
  mend:      { name: '精靈自癒',        effect: '自身持續回血',           stats: `每秒回 ${CONFIG.mend.rate} · 持續 ${CONFIG.mend.duration}s · 冷卻 ${SPELLS.mend.cooldown}s`, detail: `愛蜜莉雅與准精靈契約的自我治癒:只補自己,每秒回 ${CONFIG.mend.rate} 點、持續 ${CONFIG.mend.duration}s(共 ${CONFIG.mend.rate * CONFIG.mend.duration} 點)。` },
  repulse:   { name: '電磁斥力',        effect: '自身範圍傷害 + 擊退',     stats: `傷害 ${CONFIG.repulse.damage} · 範圍 ${CONFIG.repulse.radius} · 擊退 ${CONFIG.repulse.knockback} · 冷卻 ${SPELLS.repulse.cooldown}s`, detail: '御坂用電磁力向外爆發斥力:對周圍敵人造成傷害並把牠們推開,製造安全距離、不讓怪貼身。類似護身的解圍技。' },
  holybolt:  { name: '聖光',            effect: '自身範圍聖光爆',         stats: `傷害 ${CONFIG.holybolt.damage} · 冷卻 ${SPELLS.holybolt.cooldown}s · 範圍 ${CONFIG.holybolt.radius}`, detail: '以自身為中心爆發聖光,對周圍範圍內所有敵人造成傷害。冷卻極短,貞德站在隊伍中央邊奶邊脈衝輸出。' },
};
