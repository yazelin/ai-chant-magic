// Tiny localStorage flag: has this browser already seen the "喊出技能名稱"
// onboarding hint? Once per browser, not once per match — a returning player
// doesn't need re-teaching every game.
const KEY = 'acm.onboarding.voiceHintSeen';
const CONTROLS_KEY = 'acm.onboarding.controlsHintSeen';

export function hasSeenVoiceHint(): boolean {
  return localStorage.getItem(KEY) === '1';
}

export function markVoiceHintSeen(): void {
  localStorage.setItem(KEY, '1');
}

export function hasSeenControlsHint(): boolean {
  return localStorage.getItem(CONTROLS_KEY) === '1';
}

export function markControlsHintSeen(): void {
  localStorage.setItem(CONTROLS_KEY, '1');
}
