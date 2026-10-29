/** Visual extrapolation never mutates a snapshot or the authoritative simulation. */
export class SnapshotClock {
  private serial = -1;
  private arrivedAt = 0;
  reset(): void { this.serial = -1; this.arrivedAt = 0; }
  accept(serial: number, timestamp: number): boolean {
    if (!Number.isFinite(serial) || serial <= this.serial) return false;
    this.serial = serial;
    this.arrivedAt = timestamp;
    return true;
  }
  leadSeconds(timestamp: number, speed = 1): number {
    if (!this.arrivedAt) return 0;
    return Math.min(0.14, Math.max(0, (timestamp - this.arrivedAt) / 1000) * speed);
  }
}
