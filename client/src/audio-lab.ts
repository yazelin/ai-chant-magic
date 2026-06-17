// Dev-only audio lab (served by Vite dev at /audio-lab.html; not in the prod
// build). Imports the REAL sfx.ts / music.ts so what you hear is what ships.
import {
  initAudio, sfxCast, sfxFireball, sfxExplosion,
  sfxHit, sfxHurt, sfxHeal, sfxZap, sfxFrost, sfxShield, sfxWave, sfxDeath,
} from './audio/sfx';
import { MusicEngine } from './audio/music';

const SFX: Array<[string, () => void]> = [
  ['施法 cast', sfxCast],
  ['火球 fireball', sfxFireball],
  ['爆炸 explosion', () => sfxExplosion(false)],
  ['大爆炸 big', () => sfxExplosion(true)],
  ['命中/擊殺 hit', sfxHit],
  ['受擊 hurt', sfxHurt],
  ['回血 heal', sfxHeal],
  ['電擊 zap', sfxZap],
  ['冰 frost', sfxFrost],
  ['護盾 shield', sfxShield],
  ['升波 wave', sfxWave],
  ['死亡 death', sfxDeath],
];

const sfxHost = document.getElementById('sfx')!;
for (const [label, fn] of SFX) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { initAudio(); fn(); });
  sfxHost.appendChild(b);
}

const music = new MusicEngine();
const state = document.getElementById('music-state')!;
const TRACKS = ['0 暗潮', '1 獵殺', '2 肅殺', '3 狂亂'];

document.getElementById('m-start')!.addEventListener('click', () => {
  initAudio(); music.start(); state.textContent = '播放中(強度 0 暗潮)';
});
document.getElementById('m-stop')!.addEventListener('click', () => {
  music.stop(); state.textContent = '已停止';
});

const intHost = document.getElementById('intensity')!;
TRACKS.forEach((label, lvl) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => {
    initAudio(); music.start(); music.setIntensity(lvl);
    state.textContent = `播放中(強度 ${label})`;
    intHost.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
  });
  intHost.appendChild(b);
});
