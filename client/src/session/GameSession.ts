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
  // Continue past the campaign instead of ending — only meaningful from a
  // 'victory' world. Solo mutates the world directly; net play sends the
  // enterEndless message and waits for the server's own snapshot to reflect it.
  enterEndless(): void;
  // End an in-progress endless run on demand (same effect as a party wipe).
  endEndless(): void;
  // Host-only, net-play-only: skip the victory decision window and return
  // everyone to the lobby immediately. Meaningless for solo (no lobby to
  // return to — restart() is the solo equivalent), so it's a no-op there.
  skipToLobby(): void;
}
