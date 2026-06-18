import Phaser from 'phaser';
import { GameScene } from './render/GameScene';
import { Hud } from './render/hud';
import { IncantationOverlay } from './render/incantation';
import {
  CONFIG,
  matchSpell,
  ClassId,
  classSpellSet,
  SPELLS,
} from '@acm/shared';
import { GameSession } from './session/GameSession';
import { Lobby } from './ui/Lobby';
import { chantsAsExtra } from './customChants';
import { WebSpeechVoiceInput } from './voice/recognizer';
import { initAudio } from './audio/sfx';
import { MusicEngine } from './audio/music';

// Boot into the lobby. The lobby decides Local (single-player) vs Net
// (connected, already `started`) and hands us a GameSession + the self class id.
// Both modes drive the same GameScene; voice casting and the 1/2/3 test keys
// work identically (they all route through session.sendCast).
function startGame(session: GameSession, classId: ClassId): void {
  // Reveal the in-game chrome (HUD / mode / mic) now that we are leaving lobby.
  // NOTE: '' would fall back to the stylesheet's `#game-chrome{display:none}`,
  // leaving the canvas at 0x0 — must set an explicit display.
  const chrome = document.getElementById('game-chrome');
  if (chrome) {
    chrome.style.display = 'flex';
    chrome.style.flexDirection = 'column';
    chrome.style.alignItems = 'center';
    chrome.style.gap = '8px';
  }
  // Hide the lobby panel so it doesn't sit above the game.
  const lobbyEl = document.getElementById('lobby');
  if (lobbyEl) lobbyEl.style.display = 'none';

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
  const incantation = new IncantationOverlay();
  const music = new MusicEngine();

  // HUD refresh loop (decoupled from Phaser so game-over text updates even when
  // idle). Reads whatever World the session exposes (local sim or interpolated
  // snapshot), so the party panel renders all players in both modes.
  setInterval(() => {
    const w = session.getWorld();
    if (w) {
      hud.render(w);
      // 惠惠 chant easter egg: drive the incantation overlay from the local
      // pyro's 爆裂 charge (0 / non-pyro → hidden).
      const self = w.players.find((p) => p.id === session.getSelfId());
      const charge = self?.classId === 'pyro' ? self.pyroCharge ?? 0 : 0;
      incantation.update(charge, Date.now());
      // Adaptive music intensity: calm early, escalates with the wave; calm again
      // on game over. (Bar-aligned switch handled inside MusicEngine.)
      music.start(); // idempotent + no-op until the AudioContext exists (any gesture)
      const intensity = w.status === 'gameover' ? 0 : w.wave >= 7 ? 3 : w.wave >= 5 ? 2 : w.wave >= 3 ? 1 : 0;
      music.setIntensity(intensity);
    }
  }, 100);

  // Restart (solo only; NetSession.restart is a no-op).
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r') scene.restart();
  });

  // Voice → spell casting (restricted to the chosen class's loadout).
  const allowed = classSpellSet(classId);
  const voice = new WebSpeechVoiceInput('zh-TW');
  voice.onStatusChange((s, message) => hud.setMicStatus(s, message));
  voice.onTranscript((text) => {
    const spell = matchSpell(text, { allowed, extra: chantsAsExtra() });
    hud.setHeard(text, spell ? SPELLS[spell].displayName : null);
    if (spell) session.sendCast(spell);
  });

  // Browsers require a user gesture before mic access AND before audio can
  // play; the first click both starts the recognizer and resumes the SFX
  // AudioContext. initAudio() is idempotent + guarded, so calling it here is safe.
  window.addEventListener(
    'click',
    () => {
      initAudio();
      voice.start();
    },
    { once: true },
  );
}

new Lobby(startGame);
