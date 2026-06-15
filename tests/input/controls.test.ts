import { describe, it, expect } from 'vitest';
import { moveDirFromKeys, facingFromMouse } from '../../src/input/controls';

describe('moveDirFromKeys', () => {
  it('returns zero when no keys are held', () => {
    expect(moveDirFromKeys(new Set())).toEqual({ x: 0, y: 0 });
  });
  it('maps w to up (negative y)', () => {
    expect(moveDirFromKeys(new Set(['w']))).toEqual({ x: 0, y: -1 });
  });
  it('supports arrow keys', () => {
    expect(moveDirFromKeys(new Set(['arrowright']))).toEqual({ x: 1, y: 0 });
  });
  it('normalizes diagonals to unit length', () => {
    const d = moveDirFromKeys(new Set(['w', 'd']));
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
  });
  it('cancels opposite keys', () => {
    expect(moveDirFromKeys(new Set(['a', 'd']))).toEqual({ x: 0, y: 0 });
  });
});

describe('facingFromMouse', () => {
  it('points right when mouse is to the right', () => {
    expect(facingFromMouse({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
  });
  it('points down when mouse is below', () => {
    expect(facingFromMouse({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
  });
});
