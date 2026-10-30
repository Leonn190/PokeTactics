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

export function drawContactShadow(ctx: CanvasRenderingContext2D, x: number, y: number,
  radius: number, profile: {mode?: 'earth';scale?:number;opacity?:number;offsetX?:number;offsetY?:number} = {},
  height = 0): void {
  const scale = profile.scale ?? 1, faded = Math.max(.1,1-Math.min(1,height)*.4);
  const xx = x + (profile.offsetX || 0), yy = y + (profile.offsetY || 0);
  ctx.save(); ctx.globalAlpha *= (profile.opacity ?? 1) * faded;
  if (profile.mode === 'earth') {
    // Diglett/Dugtrio have a dark soil rim integrated into the ground, not a hovering shadow.
    ctx.fillStyle = '#37251baf';ctx.beginPath();ctx.ellipse(xx,yy+1,radius*scale*1.28,radius*.25,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle = '#94724d7a';ctx.lineWidth = 1.5;ctx.stroke();
  } else {
    const image = shadowTexture(radius * scale * (1 - Math.min(.28,height*.13)));
    ctx.drawImage(image, xx-image.width/2, yy+1.5-image.height/2);
  }
  ctx.restore();
}
