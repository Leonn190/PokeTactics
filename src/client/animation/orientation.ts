/** Traverse only the shortest 1..4 of the 8 PMD directions instead of 360 degrees. */
type Turn = { from: number; to: number; started: number; duration: number; delta: number };
export type OrientationFrame = { direction: number; rotate: { row: number; frame: number } | null };
const mod = (v: number) => (v + 8) % 8;
export class OrientationController {
  private tracks = new Map<string, Turn>();
  reset(): void { this.tracks.clear(); }
  prune(validIds: ReadonlySet<string>): void {
    for (const id of this.tracks.keys()) if (!validIds.has(id)) this.tracks.delete(id);
  }
  get(id: string, toDirection: number, now: number, canRotate: boolean): OrientationFrame {
    const to = mod(toDirection);
    let t = this.tracks.get(id);
    const current = t ? (now >= t.started + t.duration ? t.to : t.from) : 0;
    if (!t || t.to !== to) {
      const signed = mod(to - current + 4) - 4;
      t = { from: current, to, started: now, delta: signed, duration: Math.abs(signed) * .075 };
      this.tracks.set(id, t);
    }
    if (!canRotate || t.delta === 0 || now >= t.started + t.duration) {
      return { direction: t.to, rotate: null };
    }
    const steps = Math.abs(t.delta);
    const progress = Math.max(0, Math.min(1, (now - t.started) / t.duration));
    const taken = Math.min(steps, Math.floor(progress * steps));
    return { direction: mod(t.from + Math.sign(t.delta) * taken), rotate: {
      row: t.delta > 0 ? t.from : t.to,
      frame: t.delta > 0 ? taken : steps - taken
    } };
  }
}
