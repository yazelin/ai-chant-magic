import { ClassId } from '@acm/shared';

// Walk-cycle spritesheets for the four mages — 128x128 cells, side-view facing
// LEFT, feet near the bottom. Made with tools/sprite-forge. Shared by GameScene
// (in-game animation) and the lobby (card preview animation) so the frame counts
// never drift. idleFrame = the most feet-together frame (shown when standing).
export interface WalkSheet {
  url: string;
  anim: string;
  frames: number;
  idleFrame: number;
}

export const SHEET_WALKERS: Partial<Record<ClassId, WalkSheet>> = {
  pyro:   { url: new URL('../assets/pyro-walk.png', import.meta.url).href,   anim: 'pyro-walk',   frames: 8, idleFrame: 0 },
  cryo:   { url: new URL('../assets/cryo-walk.png', import.meta.url).href,   anim: 'cryo-walk',   frames: 5, idleFrame: 4 },
  storm:  { url: new URL('../assets/storm-walk.png', import.meta.url).href,  anim: 'storm-walk',  frames: 5, idleFrame: 4 },
  warden: { url: new URL('../assets/warden-walk.png', import.meta.url).href, anim: 'warden-walk', frames: 5, idleFrame: 3 },
};

export const sheetWalkerKey = (c: ClassId) => `${c}-walk`; // texture key per class
