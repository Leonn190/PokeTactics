/** Visual-only frame pacing. Worker ticks and game clocks are never modified. */
export class FrameScheduler {
  private lastPaint = 0;
  private nextPaint = 0;
  constructor(private limit: number = 0) {}
  setLimit(limit: number): void {
    this.limit = Number.isFinite(limit) && limit > 0 ? Math.max(30, Math.min(120, Math.round(limit))) : 0;
    this.reset();
  }
  reset(): void { this.lastPaint = 0; this.nextPaint = 0; }
  nextFrame(timestamp: number): number | null {
    if (!Number.isFinite(timestamp)) return null;
    if (!this.lastPaint) {
      this.lastPaint = timestamp;
      this.nextPaint = timestamp + (this.limit ? 1000 / this.limit : 0);
      return 1 / 60;
    }
    if (this.limit) {
      if (timestamp < this.nextPaint - 0.25) return null;
      const period = 1000 / this.limit;
      // Accumulate the target phase: a 144 Hz monitor can approach a 120 FPS
      // average without locking to every other refresh (72 FPS).
      this.nextPaint += period;
      if (this.nextPaint < timestamp || this.nextPaint > timestamp + 250) this.nextPaint = timestamp + period;
    }
    const elapsed = timestamp - this.lastPaint;
    this.lastPaint = timestamp;
    return Math.max(0, Math.min(0.05, elapsed / 1000));
  }
}
