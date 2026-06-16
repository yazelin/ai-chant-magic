import { Vec2, World, SpellId, ClassId } from '@acm/shared';

// A GameSession decouples rendering from where the World comes from. The local
// single-player implementation (LocalSession) runs the shared `step` in-process;
// NetSession (Phase B) feeds an interpolated snapshot world from the
// authoritative server. GameScene only ever talks to this interface.
export interface GameSession {
  start(): void;
  sendMove(dir: Vec2): void;
  sendFace(angle: number): void;
  sendCast(spell: SpellId): void;
  getWorld(): World;
  getSelfId(): string;
  onWorld(cb: (w: World) => void): void;
  // Advance one frame. LocalSession steps the sim by `dt`; NetSession flushes a
  // batched input message and re-samples the interpolation buffer (`dt` unused).
  tick(dt: number): void;
  // Restart the run. Meaningful for solo (rebuild a fresh world for the class);
  // a no-op for net play (the server owns lifecycle).
  restart(classId: ClassId): void;
}
