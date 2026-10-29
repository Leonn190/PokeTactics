/** Smooth per-unit interpolation between immutable, authoritative snapshots. */
type Position = { x: number; y: number };
type MovingUnit = Position & { id: string; dig?: { phase: string } | null };
type Track = { from: Position; to: Position; receivedAt: number; duration: number };
const clamp = (min: number, max: number, n: number) => Math.max(min, Math.min(max, n));

export class UnitInterpolator {
  private battle = '';
  private lastArrival = 0;
  private tracks = new Map<string, Track>();
  reset(): void { this.battle = ''; this.lastArrival = 0; this.tracks.clear(); }

  sync(battleId: string, units: readonly MovingUnit[], now: number): void {
    if (battleId !== this.battle) { this.reset(); this.battle = battleId; }
    const duration = this.lastArrival ? clamp(.05, .16, (now - this.lastArrival) / 1000) : .085;
    this.lastArrival = now;
    const ids = new Set<string>();
    for (const unit of units) {
      ids.add(unit.id);
      const previous = this.tracks.get(unit.id);
      const current = previous ? this.position(unit.id, now)! : { x: unit.x, y: unit.y };
      // Large relocation / first sight should not tween across the entire battlefield.
      const jump = !unit.dig && Math.hypot(unit.x - current.x, unit.y - current.y) > 3;
      const target = { x: unit.x, y: unit.y };
      this.tracks.set(unit.id, { from: jump ? target : current, to: target, receivedAt: now,
        duration: jump || !previous ? 0 : duration });
    }
    for (const id of this.tracks.keys()) if (!ids.has(id)) this.tracks.delete(id);
  }

  position(id: string, now: number): Position | null {
    const track = this.tracks.get(id);
    if (!track) return null;
    if (!track.duration) return track.to;
    const fraction = clamp(0, 1, (now - track.receivedAt) / (track.duration * 1000));
    return {
      x: track.from.x + (track.to.x - track.from.x) * fraction,
      y: track.from.y + (track.to.y - track.from.y) * fraction
    };
  }
}
