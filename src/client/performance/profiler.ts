/** F3 overlay. One lightweight DOM write per 400ms, never one per frame. */
export class PerformanceProfiler {
  private node: HTMLPreElement;
  private enabled = false;
  private frames: number[] = [];
  private last = 0;
  private previous = 0;
  private snapshotCount = 0;
  constructor() {
    this.node = document.createElement('pre');
    this.node.style.cssText = 'position:fixed;z-index:99999;left:12px;top:12px;margin:0;padding:11px 14px;background:#071618e8;color:#c9f7d3;border:1px solid #5b8b7a;border-radius:8px;font:12px/1.5 monospace;pointer-events:none;white-space:pre;display:none';
    document.body.appendChild(this.node);
    window.addEventListener('keydown', event => {
      if (event.key !== 'F3') return;
      event.preventDefault();
      this.enabled = !this.enabled;
      this.node.style.display = this.enabled ? 'block' : 'none';
      if (this.enabled) { this.last = 0; this.previous = 0; this.frames.length = 0; this.snapshotCount = 0; }
    });
  }
  snapshot(): void { if (this.enabled) this.snapshotCount++; }
  frame(now: number, renderMs: number, units: number, effects: number, scale: number): void {
    if (!this.enabled) return;
    if (this.previous) {
      this.frames.push(now - this.previous);
      if (this.frames.length > 180) this.frames.shift();
    }
    this.previous = now;
    if (now - this.last < 400) return;
    const times = this.frames;
    const ordered = [...times].sort((a, b) => a - b);
    const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    const p95 = ordered.length ? ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * .95))] : 0;
    const snapshotsPerSecond = this.last ? this.snapshotCount / Math.max(.001, (now - this.last) / 1000) : 0;
    this.node.textContent = `PokéTactics · F3
FPS médio: ${mean ? (1000 / mean).toFixed(1) : '—'}
Frame médio: ${mean.toFixed(1)} ms
P95 frame: ${p95.toFixed(1)} ms
Desenho: ${renderMs.toFixed(1)} ms
Pokémon: ${units}  Efeitos: ${effects}
Snapshots/s: ${snapshotsPerSecond.toFixed(1)}
Escala interna: ${scale.toFixed(2)}x`;
    this.snapshotCount = 0;
    this.last = now;
  }
}
