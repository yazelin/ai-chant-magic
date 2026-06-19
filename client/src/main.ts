import Phaser from 'phaser';
import { GameScene } from './render/GameScene';
import { Hud } from './render/hud';
import { IncantationOverlay } from './render/incantation';
import {
  matchSpell,
  ClassId,
  classSpellSet,
  SPELLS,
} from '@acm/shared';
import { GameSession } from './session/GameSession';
import { Lobby } from './ui/Lobby';
import { SkillBar } from './ui/skillbar';
import { WaveHud } from './render/wavehud';
import { chantsAsExtra } from './customChants';
import { WebSpeechVoiceInput } from './voice/recognizer';
import { initAudio, sfxWave, sfxDeath } from './audio/sfx';
import { MusicEngine } from './audio/music';

// Boot into the lobby. The lobby decides Local (single-player) vs Net
// (connected, already `started`) and hands us a GameSession + the self class id.
// Both modes drive the same GameScene; voice casting and the 1/2/3 test keys
// work identically (they all route through session.sendCast).
function startGame(session: GameSession, classId: ClassId, solo = false): void {
  // Reveal the in-game chrome (HUD / mode / mic) now that we are leaving lobby.
  // NOTE: '' would fall back to the stylesheet's `#game-chrome{display:none}`,
  // leaving the canvas at 0x0 — must set an explicit display.
  // Full-bleed play view (CSS .playing): canvas fills the viewport, info rows
  // overlay on top without blocking touch.
  const chrome = document.getElementById('game-chrome');
  if (chrome) chrome.classList.add('playing');
  // Hide the lobby panel so it doesn't sit above the game.
  const lobbyEl = document.getElementById('lobby');
  if (lobbyEl) lobbyEl.style.display = 'none';

  const scene = new GameScene(session);

  // RESIZE: the canvas fills the viewport with NO letterbox on any screen.
  // GameScene's camera (bounds = arena, follows the local player, zoom-to-fill)
  // turns the fixed 960x640 world into a screen-filling, player-centered view.
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    // Opaque backbuffer (NOT transparent) — additive-blend VFX (fire glow, bursts)
    // need it or they render their bounding box. The dreamscape sky is drawn
    // in-scene by GameScene instead of via a transparent canvas + CSS gradient.
    backgroundColor: '#0a0f1a',
    scale: { mode: Phaser.Scale.RESIZE },
    scene,
  });

  // Fullscreen button: request fullscreen on the WHOLE chrome container (canvas +
  // all DOM overlays), NOT the canvas — so the HUD/skill bar/etc. stay visible.
  // (The best mobile fullscreen is still installing as a PWA; iOS Safari doesn't
  // support element fullscreen, so the button is a no-op there.)
  const fsBtn = document.getElementById('fs-btn');
  fsBtn?.addEventListener('click', () => {
    const el = chrome as (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }) | null;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else if (el) {
      void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch?.(() => {});
    }
  });

  // Solo gets a 重來 button on the game-over banner (mobile has no R key).
  const hud = new Hud(solo, () => scene.restart());
  const skillbar = new SkillBar();
  const wavehud = new WaveHud();
  const incantation = new IncantationOverlay();
  const music = new MusicEngine();

  // HUD refresh loop (decoupled from Phaser so game-over text updates even when
  // idle). Reads whatever World the session exposes (local sim or interpolated
  // snapshot), so the party panel renders all players in both modes.
  // Wave/gameover SFX are detected here (this loop already tracks both for music);
  // hit/hurt/kill SFX live in GameScene off per-frame hp deltas.
  let prevWave = -1;
  let prevStatus = '';
  setInterval(() => {
    const w = session.getWorld();
    if (w) {
      hud.render(w, session.getSelfId());
      skillbar.update(w, session.getSelfId());
      wavehud.update(w);
      // 惠惠 chant easter egg: drive the incantation overlay from the local
      // pyro's 爆裂 charge (0 / non-pyro → hidden).
      const self = w.players.find((p) => p.id === session.getSelfId());
      const charge = self?.classId === 'pyro' ? self.pyroCharge ?? 0 : 0;
      incantation.update(charge, Date.now());
      // New-wave fanfare (skip the very first observation = game start).
      if (prevWave >= 0 && w.wave > prevWave && w.status === 'playing') sfxWave();
      prevWave = w.wave;
      // Game-over sting on the transition into gameover.
      if (w.status === 'gameover' && prevStatus !== 'gameover') sfxDeath();
      prevStatus = w.status;
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
