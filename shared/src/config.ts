export const CONFIG = {
  // Arena is larger than common screens so the camera (native zoom 1) simply
  // follows the player and fills any display without scaling sprites; enemies
  // spawn on a ring around the player (see wave.spawnRadius) so the big arena
  // doesn't hurt pacing.
  arenaWidth: 1920, arenaHeight: 1080,
  // contactHit = damage per contact hit; invulnTime = i-frames after a hit (one
  // hit per window no matter how many enemies touch you → survivable swarms).
  player: { speed: 200, maxHp: 100, radius: 14, contactHit: 12, invulnTime: 0.7 },
  shield: { duration: 2.5 }, aegis: { duration: 3, radius: 160 },
  heal: { rate: 10, duration: 4, radius: 150, cooldown: 7 }, // HoT: rate/sec over duration
  revive: { radius: 70, time: 3, hp: 40 },        // ally channels over `time` s
  bleedout: { time: 8 },                           // downed -> dead if not revived
  fireball: { speed: 420, radius: 8, ttl: 1.5, explosionRadius: 60, explosionDamage: 30 },
  // 爆裂魔法 scales with 惠惠's charge: damage = baseDamage + perChargeDamage*層,
  // radius = baseRadius + perChargeRadius*層 (NO cap), cooldown = baseCd + cdPerCharge*層.
  // explosionRadius is only the fallback if a projectile carries no per-cast value.
  firestorm: { speed: 300, radius: 10, ttl: 1.1, explosionRadius: 190,
               baseDamage: 50, perChargeDamage: 20,
               baseRadius: 150, perChargeRadius: 40, baseCd: 2, cdPerCharge: 1 },
  chant: { chargePerCast: 1 },                          // each 詠唱 adds this much 爆裂 charge
  mend: { rate: 12, duration: 3 },                      // 精靈自癒: self HoT
  repulse: { damage: 25, radius: 140, knockback: 100 }, // 電磁斥力: dmg + shove enemies outward
  frost:    { speed: 360, radius: 6, ttl: 1.2, damage: 18, slowDuration: 2, spread: 0.25, count: 3 },
  frostnova: { radius: 150, damage: 20, slowDuration: 2.5 },
  thunder:  { range: 2200, width: 28, damage: 55, maxBounces: 2, bounceFalloff: 0.8 },
  chain:    { range: 260, jumpRange: 170, maxJumps: 4, damage: 34, falloff: 0.8 },
  holybolt: { damage: 14, radius: 120 },
  enemy: { baseSpeed: 60, radius: 12, baseHp: 30, hpPerWave: 5, speedPerWave: 4 },
  // Per-element slime behaviour (phase 2). Damage to players is gated by i-frames.
  slime: {
    fire:  { explodeRadius: 85, explodeDamage: 14 },                                  // 死亡小爆炸,波及貼太近的玩家
    ice:   { slowDuration: 1.2, slowFactor: 0.5 },                                    // 命中後玩家短暫減速
    storm: { speedMul: 1.35, dashInterval: 2.6, telegraph: 0.4, dashSpeed: 430, dashTime: 0.3 }, // 快+突進(先蓄力telegraph)
    holy:  { hpMul: 2.2, healRadius: 130, healAmount: 8, healInterval: 1.5 },         // 肉+幫周圍史萊姆回血
  },
  // 史萊姆王(王怪):每 every 波出一隻,巨大/肉/慢,週期召喚小史萊姆;
  // 打掉它才能止住增援。swarmMul 縮減該波一般史萊姆量,讓 boss 當主角。
  boss: { every: 5, hpMul: 14, radiusMul: 2.6, speedMul: 0.55, summonInterval: 3.5, summonCount: 3, swarmMul: 0.5 },
  wave: { baseCount: 6, perWave: 3, baseCadence: 1.2, cadenceDecay: 0.05, minCadence: 0.4, breakTime: 2, scaleExp: 1.4,
          spawnRadius: 680, spawnRadiusJitter: 240 }, // enemies appear this far from a player (just off-screen)
  // 世界2(frostvale)signature enemy — a flicker instead of a walk: holds still,
  // then blinks blinkDist toward its target every blinkInterval (capped so it
  // never overshoots past the target).
  wraith: { blinkInterval: 1.6, blinkDist: 160 },
  // How long a cleared level lingers (boss corpse still on the ground, level-clear
  // toast visible) before advancing to the next level / ending the game. Matches
  // the client toast's own 4s auto-fade so the world flips right as it fades.
  // victoryDecisionSec is a separate, longer window: how long a multiplayer room
  // waits on the 'victory' screen for the host to pick endless-mode vs. lobby.
  transition: { delay: 4, victoryDecisionSec: 30 },
  // Endless mode curve/caps — see shared/src/world.ts's enemyStatWaveHp/
  // enemyStatWaveSpeed/spawnEndlessEnemy/beginWave. All of these only apply
  // when world.endless is true; the campaign's CONFIG.enemy/CONFIG.wave/
  // CONFIG.boss formulas are untouched.
  endless: {
    maxQueueBase: 60, maxQueuePerExtra: 15,   // per-wave spawn budget by party size
    maxAliveBase: 40, maxAlivePerExtra: 10,   // concurrent-enemy cap by party size
    hpCapWave: 40, hpSlopeAfterCap: 0.25,     // hp growth slows (not caps) after wave 40
    speedCapFrac: 0.85,                       // enemy walk speed never exceeds this % of player speed
    wraithShareStartWave: 6, wraithShareMaxWave: 16, wraithShareMax: 0.30, // wraith mix-in ramp
  },
  // Demoted campaign bosses mixed into endless-mode waves as "elite" mobs —
  // deliberately lighter than CONFIG.boss (14/2.6/0.55): an elite is a beefed-up
  // regular enemy the swarm carries, not a singular fight the party stops for.
  elite: { hpMul: 6, radiusMul: 2.0, speedMul: 0.8, summonInterval: 6, summonCount: 2, scoreBonus: 25 },
  effectTtl: { beam: 0.12, chain: 0.18, nova: 0.3, blast: 0.35, aura: 0.4 },
} as const;
