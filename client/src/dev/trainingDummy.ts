// Dev-only 訓練假人 (training dummy) tool. Never ships to players (only wired
// up behind import.meta.env.DEV + ?dummy=1 — see main.ts/Lobby.ts).
//
// Verifying the elemental-reaction system live is hard through normal play:
// enemies wander, die, and cluster, so landing two different-element hits on
// the SAME enemy is unreliable to engineer by hand. This tool sidesteps that
// entirely — it freezes wave spawning, plants one stationary, unkillable
// target next to the local player, and lets the tester inject any element's
// aura onto it directly (bypassing spellcasting for the FIRST hit). The
// tester then casts their own class's one real spell as the second, mismatched
// hit — a genuine reaction through the real castSpell()/applyElementalHit()
// path, with the real ring/burst/label/sfx/wavehud counter all live.
import { CONFIG, Enemy, ReactionElement, World } from '@acm/shared';
import { GameSession } from '../session/GameSession';

const DUMMY_ID = -1;
const ELEMENTS: Array<{ key: ReactionElement; label: string }> = [
  { key: 'fire', label: '灌火' },
  { key: 'ice', label: '灌冰' },
  { key: 'storm', label: '灌雷' },
  { key: 'holy', label: '灌聖' },
];

// Idempotent: creates the dummy once, and re-heals it if a restart wiped the
// world out from under a stale reference. Also freezes normal wave spawning
// each call so a later wave never buries the dummy in a real swarm.
function ensureDummy(w: World, selfId: string): Enemy | undefined {
  const self = w.players.find((p) => p.id === selfId);
  if (!self) return undefined;
  w.breakTimer = 999;
  let dummy = w.enemies.find((e) => e.id === DUMMY_ID);
  if (!dummy) {
    dummy = {
      id: DUMMY_ID, pos: { x: self.pos.x + 60, y: self.pos.y },
      hp: 999999, speed: 0, slowUntil: 0,
      radius: CONFIG.enemy.radius, targetId: null, element: 'normal',
    };
    w.enemies.push(dummy);
  }
  return dummy;
}

export function setupTrainingDummy(session: GameSession): void {
  const spawnPoll = setInterval(() => {
    if (ensureDummy(session.getWorld(), session.getSelfId())) clearInterval(spawnPoll);
  }, 50);

  const panel = document.createElement('div');
  panel.id = 'dummy-panel';
  panel.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:80;display:flex;flex-direction:column;gap:6px;' +
    'font-family:system-ui,sans-serif;font-size:13px;';

  const status = document.createElement('div');
  status.style.cssText = 'color:#ffd24d;background:#0b0b14cc;padding:4px 8px;border-radius:6px;width:fit-content;';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;';
  for (const el of ELEMENTS) {
    const b = document.createElement('button');
    b.textContent = el.label;
    b.style.cssText =
      'padding:8px 12px;border-radius:8px;border:1px solid #33335a;background:#16162a;color:#e8e8f0;cursor:pointer;';
    b.addEventListener('click', () => {
      const w = session.getWorld();
      const dummy = ensureDummy(w, session.getSelfId());
      if (!dummy) return;
      dummy.auraElement = el.key;
      dummy.auraUntil = w.time + CONFIG.reaction.auraDuration;
    });
    row.appendChild(b);
  }
  panel.appendChild(status);
  panel.appendChild(row);
  document.body.appendChild(panel);

  setInterval(() => {
    const w = session.getWorld();
    const dummy = w.enemies.find((e) => e.id === DUMMY_ID);
    const active = dummy?.auraElement && w.time < (dummy.auraUntil ?? 0);
    const aura = active ? `${dummy!.auraElement}(剩 ${(dummy!.auraUntil! - w.time).toFixed(1)}s)` : '無';
    status.textContent = `訓練假人 · 殘留元素:${aura} · 反應次數:${w.reactionCount}`;
  }, 100);
}
