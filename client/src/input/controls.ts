import { Vec2 } from '@acm/shared';

export function moveDirFromKeys(keys: Set<string>): Vec2 {
  let x = 0;
  let y = 0;
  if (keys.has('w') || keys.has('arrowup')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (x === 0 && y === 0) return { x: 0, y: 0 };
  const l = Math.hypot(x, y);
  return { x: x / l, y: y / l };
}

export function facingFromMouse(playerScreen: Vec2, mouse: Vec2): number {
  return Math.atan2(mouse.y - playerScreen.y, mouse.x - playerScreen.x);
}
