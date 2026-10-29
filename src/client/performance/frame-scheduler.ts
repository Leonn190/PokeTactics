/** Frame pacing is visual only; never changes authoritative combat ticks. */
export class FrameScheduler {
  private lastPaint = 0;
  constructor(private limit: number = 0) {}
  reset(): void { this.lastPaint = 0; }
  nextFrame(timestamp: number): number | null {
    if (!Number.isFinite(timestamp)) return null;
    if (!this.lastPaint) { this.lastPaint = timestamp; return 1 / 60; }
    const elapsed = timestamp - this.lastPaint;
    if (this.limit > 0 && elapsed < 1000 / this.limit - 0.5) return null;
    this.lastPaint = timestamp;
    // Avoid very large jumps after focus switches; logic ticks remain in the worker.
    return Math.max(0, Math.min(0.05, elapsed / 1000));
  }
}
