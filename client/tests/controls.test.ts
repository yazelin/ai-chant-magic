import { describe, it, expect } from 'vitest';
import { moveDirFromKeys, facingFromMouse, touchMoveDir } from '../src/input/controls';

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

describe('touchMoveDir', () => {
  it('returns zero inside the deadzone', () => {
    expect(touchMoveDir({ x: 100, y: 100 }, { x: 104, y: 100 }, 8)).toEqual({ x: 0, y: 0 });
  });
  it('normalizes the drag vector outside the deadzone', () => {
    const d = touchMoveDir({ x: 100, y: 100 }, { x: 100, y: 160 }, 8);
    expect(d).toEqual({ x: 0, y: 1 }); // dragged straight down → move down
  });
  it('returns a unit vector for diagonal drags', () => {
    const d = touchMoveDir({ x: 0, y: 0 }, { x: 30, y: 30 });
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
  });
});
