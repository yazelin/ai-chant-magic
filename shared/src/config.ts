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
  // 爆裂魔法 scales with 惠惠's charge: per-cast explosionDamage = explosionDamage*charge,
  // radius = min(maxRadius, baseRadius + perChargeRadius*charge), cooldown = baseCd + cdPerCharge*charge.
  firestorm: { speed: 300, radius: 10, ttl: 1.1, explosionRadius: 190, explosionDamage: 70,
               baseRadius: 150, perChargeRadius: 40, maxRadius: 360, baseCd: 2, cdPerCharge: 1 },
  chant: { chargePerCast: 1 },                          // each 詠唱 adds this much 爆裂 charge
  mend: { rate: 12, duration: 3 },                      // 精靈自癒: self HoT
  repulse: { damage: 25, radius: 140, knockback: 100 }, // 電磁斥力: dmg + shove enemies outward
  frost:    { speed: 360, radius: 6, ttl: 1.2, damage: 18, slowDuration: 2, spread: 0.25, count: 3 },
  frostnova: { radius: 150, damage: 20, slowDuration: 2.5 },
  thunder:  { range: 2200, width: 28, damage: 55, maxBounces: 2, bounceFalloff: 0.8 },
  chain:    { range: 260, jumpRange: 170, maxJumps: 4, damage: 34, falloff: 0.8 },
  holybolt: { damage: 14, radius: 120 },
  enemy: { baseSpeed: 60, radius: 12, baseHp: 30, hpPerWave: 5, speedPerWave: 4 },
  wave: { baseCount: 6, perWave: 3, baseCadence: 1.2, cadenceDecay: 0.05, minCadence: 0.4, breakTime: 2, scaleExp: 1.4,
          spawnRadius: 680, spawnRadiusJitter: 240 }, // enemies appear this far from a player (just off-screen)
  effectTtl: { beam: 0.12, chain: 0.18, nova: 0.3, blast: 0.35, aura: 0.4 },
} as const;
