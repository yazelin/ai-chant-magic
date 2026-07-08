import Phaser from 'phaser';
import { GameScene } from './render/GameScene';
import { Hud } from './render/hud';
import { IncantationOverlay } from './render/incantation';
import {
  matchSpell,
  matchesAny,
  RESONANCE_ALIASES,
  ClassId,
  classSpellSet,
  SPELLS,
  CLASSES,
} from '@acm/shared';
import { GameSession } from './session/GameSession';
import { Lobby } from './ui/Lobby';
import { SkillBar } from './ui/skillbar';
import { WaveHud } from './render/wavehud';
import { initPwaInstall, hidePwaInstall } from './pwaInstall';
import { chantsAsExtra, chantFor } from './customChants';
import { FallbackVoiceInput } from './voice/recognizer';
import { initAudio, sfxWave, sfxDeath } from './audio/sfx';
import { MusicEngine } from './audio/music';
import { setupTrainingDummy } from './dev/trainingDummy';
import { submitScore } from './session/weeklyChallenge';
import {
  hasSeenVoiceHint,
  markVoiceHintSeen,
  hasSeenControlsHint,
  markControlsHintSeen,
} from './session/onboarding';

// Boot into the lobby. The lobby decides Local (single-player) vs Net
// (connected, already `started`) and hands us a GameSession + the self class id.
// Both modes drive the same GameScene; voice casting and the 1/2/3 test keys
// work identically (they all route through session.sendCast).
function startGame(
  session: GameSession,
  classId: ClassId,
  solo = false,
  isHost = false,
  spectator = false,
  weeklyChallenge = false,
  playerName = '',
): void {
  // Reveal the in-game chrome (HUD / mode / mic) now that we are leaving lobby.
  // NOTE: '' would fall back to the stylesheet's `#game-chrome{display:none}`,
  // leaving the canvas at 0x0 — must set an explicit display.
  // Full-bleed play view (CSS .playing): canvas fills the viewport, info rows
  // overlay on top without blocking touch.
  const chrome = document.getElementById('game-chrome');
  if (chrome) chrome.classList.add('playing');
  hidePwaInstall(); // install affordance is home-only
  // Hide the lobby panel so it doesn't sit above the game.
  const lobbyEl = document.getElementById('lobby');
  if (lobbyEl) lobbyEl.style.display = 'none';
  // A spectator has no local player to cast for — no skill bar, no charge
  // overlay, no mic pill, no voice recognizer (see below).
  const micEl = document.getElementById('mic-status');
  if (micEl) micEl.style.display = spectator ? 'none' : '';

  const scene = new GameScene(session);

  // Dev-only 訓練假人: ?dummy=1 (see Lobby.ts) plants a stationary, unkillable
  // target next to the solo player and a debug panel to inject any elemental
  // aura onto it directly — lets a real spell cast be the second, mismatched
  // hit that triggers a genuine reaction, without hunting a real swarm for two
  // hits to land on the same enemy. import.meta.env.DEV keeps it out of prod.
  if (import.meta.env.DEV && solo && new URLSearchParams(location.search).has('dummy')) {
    setupTrainingDummy(session);
  }

  // RESIZE: the canvas fills the viewport with NO letterbox on any screen.
  // GameScene's camera (bounds = arena, follows the local player, zoom-to-fill)
  // turns the fixed 960x640 world into a screen-filling, player-centered view.
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    // Opaque backbuffer (NOT transparent) — additive-blend VFX (fire glow, bursts)
    // need it or they render their bounding box. The dreamscape sky is drawn
    // in-scene by GameScene instead of via a transparent canvas + CSS gradient.
    backgroundColor: '#0a0f1a',
    scale: { mode: Phaser.Scale.RESIZE },
    scene,
  });
  // Scale.RESIZE listens to the window 'resize' event, but a phone rotation
  // sometimes fires that event with the browser chrome/viewport still mid-
  // transition (stale dimensions) — Phaser can end up sized for the old
  // orientation and never re-check. orientationchange fires once the OS has
  // committed to the new orientation; a short delay past that lets the
  // browser settle its own layout before forcing Phaser to recompute against
  // whatever the DOM actually reports at that point.
  window.addEventListener('orientationchange', () => {
    setTimeout(() => game.scale.refresh(), 300);
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

  // Counts voice-recognized casts/resonance this run (incremented below,
  // where the transcript recognizer actually matches one) — the share card
  // had zero reference to this being a voice game at all; read via a getter
  // (not passed as a value) since the recognizer callback that increments it
  // is wired up further down, after `hud` already exists.
  let voiceCastCount = 0;

  // Solo gets a 重來 button on the game-over banner (mobile has no R key).
  // Endless mode's decision buttons (victory screen) are host-gated for net
  // play; solo is always its own host (see Lobby.startSolo).
  const hud = new Hud(
    solo,
    () => scene.restart(),
    () => session.enterEndless(),
    () => session.skipToLobby(),
    isHost,
    () => session.endEndless(),
    weeklyChallenge,
    () => voiceCastCount,
    () => {
      teardownGame();
      lobby.returnHome();
    },
    // `voice` is declared further down (closure, same pattern as
    // teardownGame/voiceCastCount above) — this only ever runs on a button
    // click well after it's initialized. A denied permission that the player
    // has since fixed in browser settings just needs another start()
    // attempt, not a full page reload.
    () => voice?.start(),
  );
  // A spectator has no local player, so a skill bar / chant-charge overlay
  // would just show nothing useful — skip creating them entirely.
  // Tappable — the only way to cast at all when voice is unavailable for any
  // reason (unsupported/broken recognizer, denied mic permission, or genuinely
  // offline, since Web Speech API and any cloud STT fallback both require
  // network either way).
  const skillbar = spectator
    ? null
    : new SkillBar(
        (spell) => session.sendCast(spell),
        () => session.sendResonance(),
      );
  const wavehud = new WaveHud();
  const incantation = spectator ? null : new IncantationOverlay();
  const music = new MusicEngine();

  // First-match-ever onboarding: teach that this is a VOICE game before the
  // player has a chance to default to muscle-memory number keys and never
  // discover it. Once per browser, not once per match (see onboarding.ts).
  const showingVoiceHint = !spectator && !hasSeenVoiceHint();
  if (showingVoiceHint) {
    hud.showVoiceHint(classId);
    markVoiceHintSeen();
  }
  // Sequenced after the voice hint (same toast slot, 6s each) so a
  // first-timer isn't left assuming spells always fly wherever they last
  // aimed by accident — see project memory on the "冰精靈固定方向" report.
  if (!spectator && !hasSeenControlsHint()) {
    setTimeout(() => hud.showControlsHint(), showingVoiceHint ? 6200 : 0);
    markControlsHintSeen();
  }

  // HUD refresh loop (decoupled from Phaser so game-over text updates even when
  // idle). Reads whatever World the session exposes (local sim or interpolated
  // snapshot), so the party panel renders all players in both modes.
  // Wave/gameover SFX are detected here (this loop already tracks both for music);
  // hit/hurt/kill SFX live in GameScene off per-frame hp deltas.
  let prevWave = -1;
  let prevStatus = '';
  const loopId = setInterval(() => {
    const w = session.getWorld();
    if (w) {
      hud.render(w, session.getSelfId());
      skillbar?.update(w, session.getSelfId());
      wavehud.update(w);
      // 惠惠 chant easter egg: drive the incantation overlay from the local
      // pyro's 爆裂 charge (0 / non-pyro → hidden).
      const self = w.players.find((p) => p.id === session.getSelfId());
      const charge = self?.classId === 'pyro' ? self.pyroCharge ?? 0 : 0;
      incantation?.update(charge, Date.now());
      // New-wave fanfare (skip the very first observation = game start).
      if (prevWave >= 0 && w.wave > prevWave && w.status === 'playing') sfxWave();
      prevWave = w.wave;
      // Game-over sting on the transition into gameover.
      if (w.status === 'gameover' && prevStatus !== 'gameover') {
        sfxDeath();
        // 週挑戰: submit this run's result the moment the run ends. Best-effort
        // (submitScore swallows its own errors) — a failed/offline submission
        // must never block or alter the normal game-over screen.
        if (weeklyChallenge && self) {
          void submitScore({
            classId,
            name: playerName || self.name,
            wave: w.wave,
            kills: w.score - w.endlessKillBase,
          });
        }
      }
      prevStatus = w.status;
      // Adaptive music intensity: calm early, escalates with the wave; calm again
      // once the run has ended, win or lose. (Bar-aligned switch inside MusicEngine.)
      music.start(); // idempotent + no-op until the AudioContext exists (any gesture)
      const ended = w.status === 'gameover' || w.status === 'victory';
      const intensity = ended ? 0 : w.wave >= 7 ? 3 : w.wave >= 5 ? 2 : w.wave >= 3 ? 1 : 0;
      music.setIntensity(intensity);
    }
  }, 100);

  // Restart (solo only; NetSession/SpectatorSession.restart is a no-op) — skip
  // wiring the key at all for a spectator, since there's nothing to restart.
  if (!spectator) {
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'r') scene.restart();
    });
  }

  // Voice → spell casting (restricted to the chosen class's loadout). A
  // spectator has no class/spells of their own, so skip the recognizer
  // entirely rather than requesting a mic permission for nothing.
  const allowed = classSpellSet(classId);
  // Vocabulary hint for the Groq fallback (see voice/groqRecognizer.ts) —
  // default + custom chants for THIS class, biasing Whisper toward these
  // specific short phrases (and toward Traditional script generally, since
  // the hint text itself already is). Web Speech API ignores this entirely;
  // it's only read if/when FallbackVoiceInput actually switches to Groq.
  const promptHint = CLASSES[classId].spells.map((s) => chantFor(s, SPELLS[s].displayName)).join(',');
  const voice = spectator ? null : new FallbackVoiceInput('zh-TW', promptHint);
  voice?.onStatusChange((s, message) => hud.setMicStatus(s, message));
  voice?.onTranscript((text) => {
    // 共鳴詠唱 is checked first — it's not a class spell (no loadout/cooldown
    // gating), so it must never be shadowed by a class's own alias matching.
    if (matchesAny(text, RESONANCE_ALIASES)) {
      hud.setHeard(text, '共鳴詠唱');
      session.sendResonance();
      voiceCastCount++;
      return;
    }
    const spell = matchSpell(text, { allowed, extra: chantsAsExtra() });
    hud.setHeard(text, spell ? SPELLS[spell].displayName : null);
    if (spell) {
      session.sendCast(spell);
      voiceCastCount++;
    }
  });

  // Browsers require a user gesture before mic access AND before audio can
  // play; the first click both starts the recognizer and resumes the SFX
  // AudioContext. initAudio() is idempotent + guarded, so calling it here is safe.
  window.addEventListener(
    'click',
    () => {
      initAudio();
      voice?.start();
    },
    { once: true },
  );

  // Shared teardown (loop / music / mic / Phaser / overlay DOM) — used both by
  // net play's server-driven "everyone back to the room lobby" event, and by
  // solo's "回到首頁" button (added because solo previously had NO way back to
  // the home screen once an endless/週挑戰 run had ever started: restart()
  // re-enters endless immediately when startInEndless is set, and skipToLobby()
  // is a no-op for LocalSession).
  function teardownGame(): void {
    clearInterval(loopId);
    music.stop();
    voice?.stop();
    game.destroy(true);
    chrome?.classList.remove('playing');
    ['skillbar', 'wavehud', 'gameover', 'victory', 'level-clear-toast', 'endless-quit', 'incantation'].forEach(
      (id) => document.getElementById(id)?.remove(),
    );
  }

  if (!solo) {
    lobby.setReturn(teardownGame);
  }
}

const lobby = new Lobby(startGame);
initPwaInstall();
