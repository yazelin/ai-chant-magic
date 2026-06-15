import { Vec2, World, SpellId } from '@acm/shared';

// A GameSession decouples rendering from where the World comes from. The local
// single-player implementation (LocalSession) runs the shared `step` in-process;
// the future NetSession (Phase B) feeds an interpolated snapshot world from the
// authoritative server. GameScene only ever talks to this interface.
export interface GameSession {
  start(): void;
  sendMove(dir: Vec2): void;
  sendFace(angle: number): void;
  sendCast(spell: SpellId): void;
  getWorld(): World;
  getSelfId(): string;
  onWorld(cb: (w: World) => void): void;
}
