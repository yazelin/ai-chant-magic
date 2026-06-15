import Phaser from 'phaser';
import { GameScene } from './render/GameScene';
import { Hud } from './render/hud';
import { CONFIG } from './sim/config';
import { WebSpeechVoiceInput } from './voice/recognizer';
import { matchSpell, CastMode } from './voice/matcher';
import { JUMON } from './sim/spells';

const scene = new GameScene();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: CONFIG.arenaWidth,
  height: CONFIG.arenaHeight,
  backgroundColor: '#141422',
  scene,
});

const hud = new Hud();

// HUD refresh loop (decoupled from Phaser so game-over text updates even when idle)
setInterval(() => {
  const w = scene.getWorld?.();
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
  if (e.key.toLowerCase() === 'r') scene.restart?.();
});

// Voice → spell casting
const voice = new WebSpeechVoiceInput('zh-TW');
voice.onStatusChange((s, message) => hud.setMicStatus(s, message));
voice.onTranscript((text) => {
  const spell = matchSpell(text, { mode, jumon: JUMON });
  if (spell) scene.queueCast(spell);
});

// Browsers require a user gesture before mic access; start on first click.
window.addEventListener(
  'click',
  () => voice.start(),
  { once: true }
);
