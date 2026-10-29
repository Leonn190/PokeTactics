import { RENDER_SETTINGS } from '../../../server/data';

export type Bounds = { left: number; right: number; top: number; bottom: number };
type Pending = { sprite: HTMLImageElement; key: string; sheetKey: string; sx: number; sy: number; fw: number; fh: number };

/** Pixel-accurate frame bounds calculated in small idle-time batches.
 * Avoids synchronous getImageData() while the battlefield is drawing. */
export class SpriteBoundsCache {
  private ready = new Map<string, Bounds>();
  private last = new Map<string, Bounds>();
  private queued = new Set<string>();
  private tasks: Pending[] = [];
  private scheduled = false;
  private canvas = document.createElement('canvas');
  private context = this.canvas.getContext('2d', { willReadFrequently: true })!;

  get(sprite: HTMLImageElement, key: string, sx: number, sy: number, fw: number, fh: number): Bounds {
    const ready = this.ready.get(key);
    if (ready) return ready;
    const sheetKey = key.slice(0, key.lastIndexOf(':', key.lastIndexOf(':') - 1));
    if (!this.queued.has(key) && sprite.complete && sprite.naturalWidth) {
      this.queued.add(key);
      this.tasks.push({ sprite, key, sheetKey, sx, sy, fw, fh });
      this.schedule();
    }
    const fb = RENDER_SETTINGS.spriteBoundsFallback;
    return this.last.get(sheetKey) || { left: fw*fb.left, right: fw*fb.right, top: fh*fb.top, bottom: fh*fb.bottom };
  }

  private schedule(): void {
    if (this.scheduled || !this.tasks.length) return;
    this.scheduled = true;
    const work = () => { this.scheduled = false; this.process(); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(work, { timeout: 800 });
    else window.setTimeout(work, 12);
  }

  private process(): void {
    const count = Math.min(RENDER_SETTINGS.spriteBoundsPerIdleTask, this.tasks.length);
    for (let n = 0; n < count; n++) {
      const task = this.tasks.shift()!;
      const { sprite, key, sheetKey, sx, sy, fw, fh } = task;
      try {
        if (this.canvas.width !== fw) this.canvas.width = fw;
        if (this.canvas.height !== fh) this.canvas.height = fh;
        this.context.clearRect(0, 0, fw, fh);
        this.context.drawImage(sprite, sx, sy, fw, fh, 0, 0, fw, fh);
        const pixels = this.context.getImageData(0, 0, fw, fh).data;
        let left = fw, right = 0, top = fh, bottom = 0;
        for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
          if (pixels[(y * fw + x) * 4 + 3] <= 16) continue;
          if (x < left) left = x;
          if (x + 1 > right) right = x + 1;
          if (y < top) top = y;
          if (y + 1 > bottom) bottom = y + 1;
        }
        const bounds = left >= fw ? { left: fw*.2, right: fw*.8, top: fh*.15, bottom: fh*.9 } : { left, right, top, bottom };
        this.ready.set(key, bounds); this.last.set(sheetKey, bounds);
      } catch { this.queued.delete(key); /* Safari image not decoded yet; try again on a later frame */ }
    }
    this.schedule();
  }
}
