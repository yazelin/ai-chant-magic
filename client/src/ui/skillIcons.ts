import type { SpellId } from '@acm/shared';

// Symbolic skill glyphs (NO text — names/cooldown/charge are drawn by code on
// top). Each is stroke/fill `currentColor`, so a slot just sets its CSS color to
// the class accent; greyscale-on-cooldown is a CSS filter on the slot.
// viewBox 48x48, designed to read at ~28-56px.
const GLYPH: Record<SpellId, string> = {
  // pyro
  firestorm: '<circle cx="24" cy="24" r="7" fill="currentColor" stroke="none"/><path d="M24 3v7M24 38v7M3 24h7M38 24h7M10 10l5 5M33 33l5 5M38 10l-5 5M15 33l-5 5"/>',
  chant1: '<path d="M29 5a19 19 0 1 0 0 38 24 24 0 0 1 0-38z" fill="currentColor" stroke="none"/>',
  chant2: '<circle cx="24" cy="24" r="19"/><circle cx="24" cy="24" r="11.5"/><circle cx="24" cy="24" r="4" fill="currentColor" stroke="none"/>',
  // cryo
  frost: '<path d="M24 5l4.5 31-4.5 7-4.5-7zM12 12l3.2 24-3.2 5-3.2-5zM36 12l3.2 24-3.2 5-3.2-5z" fill="currentColor" stroke="none"/>',
  frostnova: '<path d="M24 3v42M5.5 13.5l37 21M42.5 13.5l-37 21" stroke-width="2.6"/><path d="M24 3l-4 5M24 3l4 5M24 45l-4-5M24 45l4-5" stroke-width="2.6"/>',
  mend: '<path d="M24 3l4.5 16 16 4.5-16 4.5L24 45l-4.5-17-16-4.5 16-4.5z" fill="currentColor" stroke="none"/>',
  // storm
  thunder: '<path d="M27 3L9 27h10l-4 18 20-27H24z" fill="currentColor" stroke="none"/>',
  chain: '<path d="M21 3L8 24h8l-3 17 15-23h-8z" fill="currentColor" stroke="none"/><path d="M39 13l-8 13h5l-2 13 9-17h-5z" fill="currentColor" stroke="none" opacity="0.65"/>',
  repulse: '<circle cx="24" cy="24" r="3.5" fill="currentColor" stroke="none"/><path d="M24 24L12 12M24 24l12-12M24 24L12 36M24 24l12 12"/><path d="M9 9v6M9 9h6M39 9v6M39 9h-6M9 39v-6M9 39h6M39 39v-6M39 39h-6"/>',
  // warden
  holybolt: '<circle cx="24" cy="24" r="8" fill="currentColor" stroke="none"/><path d="M24 2v6M24 40v6M2 24h6M40 24h6M9 9l4.5 4.5M34.5 34.5L39 39M39 9l-4.5 4.5M13.5 34.5L9 39"/>',
  aegis: '<path d="M24 4l17 6v12c0 12-8 19-17 23-9-4-17-11-17-23V10z"/><path d="M24 15v15M16.5 22.5h15" stroke-width="2.6"/>',
  heal: '<path d="M24 7v34M7 24h34" stroke-width="7"/>',
  // defined-but-unused (kept for type completeness / legacy)
  fireball: '<path d="M24 4c6 9 11 13 11 21a11 11 0 0 1-22 0c0-5 2-8 5-12 1 5 3 6 5 6-2-6-1-11 1-15z" fill="currentColor" stroke="none"/>',
  shield: '<path d="M24 4l17 6v12c0 12-8 19-17 23-9-4-17-11-17-23V10z"/>',
};

// Full <svg> markup for a spell glyph (inherits color via currentColor).
export function skillIconSvg(id: SpellId): string {
  return (
    '<svg viewBox="0 0 48 48" width="100%" height="100%" fill="none" ' +
    'stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
    GLYPH[id] +
    '</svg>'
  );
}
