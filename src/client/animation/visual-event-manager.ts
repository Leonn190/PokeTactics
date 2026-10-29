import type { UnitVisualEvent } from '../../../server/types';

/** One clock per logical event. Snapshots may arrive at 10Hz, the animation runs at display Hz. */
export class VisualEventManager {
  private started = new Map<string, number>();
  reset(): void { this.started.clear(); }
  sync(events: readonly UnitVisualEvent[], nowMs: number): void {
    const active = new Set<string>();
    for (const event of events) {
      active.add(event.id);
      if (!this.started.has(event.id)) this.started.set(event.id, nowMs - Math.max(0, event.age) * 1000);
    }
    for (const id of this.started.keys()) if (!active.has(id)) this.started.delete(id);
  }
  age(event: UnitVisualEvent, nowMs: number): number {
    const started = this.started.get(event.id);
    // Fallback for a snapshot that arrived before the sync callback.
    const elapsed = started === undefined ? event.age : (nowMs - started) / 1000;
    return Math.max(0, elapsed - (event.delay || 0));
  }
}
