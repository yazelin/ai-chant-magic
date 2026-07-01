import { Vec2, World, SpellId, ClassId } from '@acm/shared';
import { GameSession } from './GameSession';
import { NetClient } from '../net/NetClient';
import { emptyWorld } from '../net/interp';

// Read-only observer session: samples the exact same interpolated snapshot
// buffer NetSession does, but every mutating method is a deliberate no-op —
// a spectator's client should never be ABLE to move/cast/etc, not just rely
// on its UI never wiring up the controls (the server also rejects these with
// 'spectator-readonly', but this is the client-side half of that guarantee).
export class SpectatorSession implements GameSession {
  private worldCb: (w: World) => void = () => {};
  private lastWorld: World = emptyWorld();

  constructor(private client: NetClient) {}

  start(): void {
    this.worldCb(this.getWorld());
  }

  sendMove(_dir: Vec2): void {
    /* read-only — a spectator never moves anyone */
  }

  sendFace(_angle: number): void {
    /* read-only */
  }

  sendCast(_spell: SpellId): void {
    /* read-only */
  }

  getWorld(): World {
    this.lastWorld = this.client.buffer.sample();
    return this.lastWorld;
  }

  // Never matches any player id, so nothing renders as "you are this player"
  // (the party HUD, aim reticle, etc. all key off getSelfId() matching a
  // world.players[].id) — correct for someone who isn't playing.
  getSelfId(): string {
    return this.client.selfId;
  }

  onWorld(cb: (w: World) => void): void {
    this.worldCb = cb;
  }

  tick(_dt: number): void {
    this.worldCb(this.getWorld());
  }

  restart(_classId: ClassId): void {
    /* nothing to restart — a spectator doesn't own a run */
  }

  enterEndless(): void {
    /* host-only action; a spectator has no such button */
  }

  endEndless(): void {
    /* host-only action */
  }

  skipToLobby(): void {
    /* host-only action */
  }
}
