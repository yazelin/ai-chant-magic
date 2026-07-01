import { Vec2, World, SpellId } from '@acm/shared';
import { GameSession } from './GameSession';
import { NetClient } from '../net/NetClient';
import { emptyWorld } from '../net/interp';

// Networked session: wraps an already-connected NetClient that has reached the
// `started` state. Per spec §15.1 there is NO client-side prediction — getWorld()
// always returns the interpolated snapshot buffer (self included). Input is
// batched: the latest move/face plus any casts queued since the last tick are
// flushed as ONE `input` message per frame.
export class NetSession implements GameSession {
  private latestMove: Vec2 = { x: 0, y: 0 };
  private latestFace: number | null = null;
  private queuedCasts: SpellId[] = [];
  private resonanceDirty = false;
  private moveDirty = false;
  private faceDirty = false;
  private worldCb: (w: World) => void = () => {};
  private lastWorld: World = emptyWorld();

  constructor(private client: NetClient) {}

  start(): void {
    // The NetClient is already connected and the room has `started`; nothing to
    // do beyond pushing the initial (possibly empty) world to the renderer.
    this.worldCb(this.getWorld());
  }

  sendMove(dir: Vec2): void {
    this.latestMove = dir;
    this.moveDirty = true;
  }

  sendFace(angle: number): void {
    this.latestFace = angle;
    this.faceDirty = true;
  }

  sendCast(spell: SpellId): void {
    this.queuedCasts.push(spell);
  }

  sendResonance(): void {
    this.resonanceDirty = true;
  }

  getWorld(): World {
    this.lastWorld = this.client.buffer.sample();
    return this.lastWorld;
  }

  getSelfId(): string {
    return this.client.selfId;
  }

  onWorld(cb: (w: World) => void): void {
    this.worldCb = cb;
  }

  // Called by GameScene every Phaser frame. Flushes one batched input message,
  // re-samples the interpolation buffer, and notifies the renderer. `dt` is
  // unused (the server owns time), kept for GameSession.tick parity with Local.
  tick(_dt: number): void {
    const move = this.moveDirty ? this.latestMove : null;
    const face = this.faceDirty ? this.latestFace : null;
    const casts = this.queuedCasts;
    const resonance = this.resonanceDirty;
    if (move || face !== null || casts.length || resonance) {
      this.client.input(move, face, casts, resonance);
    }
    this.queuedCasts = [];
    this.moveDirty = false;
    this.faceDirty = false;
    this.resonanceDirty = false;

    this.worldCb(this.getWorld());
  }

  // GameScene's restart key is only meaningful for solo play; for net play the
  // server owns lifecycle, so this is a no-op (kept for interface symmetry).
  restart(): void {
    /* server-authoritative; no client restart */
  }

  // Server-authoritative: send the request and wait for the next snapshot to
  // reflect it (or an `error` if we're not the host / not in the right state —
  // see Hud's onError wiring). We never mutate the world ourselves.
  enterEndless(): void {
    this.client.enterEndless();
  }

  endEndless(): void {
    this.client.endEndless();
  }

  skipToLobby(): void {
    this.client.skipToLobby();
  }
}
