import { describe, it, expect } from 'vitest';
import { sub, scale, len, dist, normalize } from '../src/vec';

describe('vec', () => {
  it('sub subtracts components', () => {
    expect(sub({ x: 5, y: 7 }, { x: 2, y: 3 })).toEqual({ x: 3, y: 4 });
  });
  it('scale multiplies', () => {
    expect(scale({ x: 2, y: -3 }, 2)).toEqual({ x: 4, y: -6 });
  });
  it('len computes magnitude', () => {
    expect(len({ x: 3, y: 4 })).toBe(5);
  });
  it('dist computes distance', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it('normalize returns unit vector', () => {
    const n = normalize({ x: 0, y: 10 });
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
  });
  it('normalize of zero vector returns zero', () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
