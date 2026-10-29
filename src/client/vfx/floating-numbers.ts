/** Shared damage/healing/trainer HP numbers, normalized animation progress [0..1]. */
export function renderFloatingNumber(ctx: CanvasRenderingContext2D, x: number, y: number,
  value: number, t: number, type: 'physical' | 'special' | 'true' | 'heal' | 'trainer'): void {
  if (value <= 0) return;
  const amount = Math.round(value);
  if (amount <= 0) return;
  const colors = { physical: '#ffd1a0', special: '#97d0ff', true: '#eab1ff', heal: '#80f2a4', trainer: '#ffffff' };
  const text = type === 'heal' ? `+${amount}` : type === 'trainer' ? `-${amount}` : String(amount);
  const size = Math.min(type === 'trainer' ? 32 : 35, 13 + Math.sqrt(amount) * 1.8);
  const fade = Math.max(0, Math.min(1, (1 - t) * 1.55));
  ctx.save(); ctx.globalAlpha = fade; ctx.font = `900 ${size}px 'Barlow Condensed',sans-serif`;
  ctx.textAlign = 'center'; ctx.strokeStyle = '#122027'; ctx.lineWidth = 3.5;
  const animatedY = y - t * 54;
  ctx.strokeText(text, x, animatedY); ctx.fillStyle = colors[type]; ctx.fillText(text, x, animatedY);
  ctx.restore();
}
