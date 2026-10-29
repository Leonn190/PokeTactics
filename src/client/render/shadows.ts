/** Cache the soft contact shadow rather than applying a Canvas blur for every
 * Pokémon on every animation frame. Size buckets keep memory bounded. */
const textures = new Map<number, HTMLCanvasElement>();

function shadowTexture(radius: number): HTMLCanvasElement {
  const key = Math.max(6, Math.round(radius / 2) * 2);
  let canvas = textures.get(key);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  const outer = key * 1.18;
  canvas.width = Math.ceil(outer * 2 + 16);
  canvas.height = Math.ceil(Math.max(3, key * .23) * 2 + 16);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#071a0f73';
  ctx.filter = 'blur(3px)';
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height / 2, outer, Math.max(3, key * .23), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = 'none';
  textures.set(key, canvas);
  return canvas;
}

export function drawContactShadow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const image = shadowTexture(radius);
  ctx.drawImage(image, x - image.width / 2, y + 1.5 - image.height / 2);
}
