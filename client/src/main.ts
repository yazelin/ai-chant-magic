import Phaser from 'phaser';
import { GameScene } from './render/GameScene';
import { Hud } from './render/hud';
import {
  CONFIG,
  matchSpell,
  CastMode,
  JUMON,
  ClassId,
  CLASSES,
  classSpellSet,
  SPELLS,
} from '@acm/shared';
import { LocalSession } from './session/LocalSession';
import { WebSpeechVoiceInput } from './voice/recognizer';

const CLASS_ORDER: ClassId[] = ['pyro', 'cryo', 'storm', 'warden'];

// Minimal Phase A class picker. Full lobby (room codes / multiplayer) is Phase B.
function showClassPicker(onPick: (c: ClassId) => void): void {
  const host = document.getElementById('class-picker')!;
  host.innerHTML = '<span>選擇職業:</span>';
  for (const id of CLASS_ORDER) {
    const def = CLASSES[id];
    const btn = document.createElement('button');
    btn.textContent = def.displayName;
    btn.title = def.spells.map((s) => SPELLS[s].displayName).join(' / ');
    btn.style.borderColor = def.color;
    btn.style.color = def.color;
    btn.addEventListener('click', () => {
      host.style.display = 'none';
      onPick(id);
    });
    host.appendChild(btn);
  }
}

function startGame(classId: ClassId): void {
  const session = new LocalSession(classId);
  const scene = new GameScene(session);

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: CONFIG.arenaWidth,
    height: CONFIG.arenaHeight,
    backgroundColor: '#0b0b14',
    scene,
  });

  const hud = new Hud(classId);

  // HUD refresh loop (decoupled from Phaser so game-over text updates even when idle).
  setInterval(() => {
    const w = session.getWorld();
    if (w) hud.render(w);
  }, 100);

  // Mode toggle
  const modeSelect = document.getElementById('mode') as HTMLSelectElement;
  let mode: CastMode = (modeSelect.value as CastMode) ?? 'mueisho';
  modeSelect.addEventListener('change', () => {
    mode = modeSelect.value as CastMode;
  });

  // Restart
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r') scene.restart();
  });

  // Voice → spell casting (restricted to the chosen class's loadout).
  const allowed = classSpellSet(classId);
  const voice = new WebSpeechVoiceInput('zh-TW');
  voice.onStatusChange((s, message) => hud.setMicStatus(s, message));
  voice.onTranscript((text) => {
    const spell = matchSpell(text, { mode, jumon: JUMON, allowed });
    if (spell) session.sendCast(spell);
  });

  // Browsers require a user gesture before mic access; start on first click.
  window.addEventListener('click', () => voice.start(), { once: true });
}

showClassPicker(startGame);
