export const CONFIG = {
  arenaWidth: 960,
  arenaHeight: 640,
  player: { speed: 200, maxHp: 100, radius: 14 },
  shield: { duration: 2.5 },
  heal: { amount: 30 },
  contactDps: 20,               // damage/sec while an enemy touches the player
  fireball: { speed: 420, damage: 30, radius: 8, ttl: 1.5, explosionRadius: 60, explosionDamage: 30 },
  frost: { speed: 360, damage: 18, radius: 6, ttl: 1.2, slowDuration: 2, spread: 0.25, count: 3 },
  thunder: { range: 500, width: 28, damage: 55 },
  enemy: { baseSpeed: 60, radius: 12, baseHp: 30, hpPerWave: 5, speedPerWave: 4 },
  wave: { baseCount: 6, perWave: 3, baseCadence: 1.2, cadenceDecay: 0.05, minCadence: 0.4, breakTime: 2 },
} as const;
