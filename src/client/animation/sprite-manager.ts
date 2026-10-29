/** Shared sheet cache with bounded memory and deduplicated in-flight loads. */
export class SpriteManager {
  private images = new Map<string, HTMLImageElement>();
  constructor(private maxSheets = 192) {}
  get(url: string): HTMLImageElement {
    const existing = this.images.get(url);
    if (existing) {
      // Touch only on demand; Map insertion order implements LRU eviction.
      this.images.delete(url);
      this.images.set(url, existing);
      return existing;
    }
    const image = new Image();
    image.decoding = 'async';
    this.images.set(url, image);
    image.src = url;
    // decode() is asynchronous, and errors must never block the render loop.
    image.addEventListener('load', () => { void image.decode?.().catch(() => {}); }, { once: true });
    while (this.images.size > this.maxSheets) {
      const oldest = this.images.keys().next().value;
      if (oldest === undefined) break;
      this.images.delete(oldest);
    }
    return image;
  }
  clear(): void { this.images.clear(); }
}
