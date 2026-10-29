/** Coin layer uses cached static sprites only for Pokémon; coins remain cheap vector circles. */
const PI2 = Math.PI * 2;
export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = '#ffd77d';
  ctx.fillStyle = '#e6b74a'; ctx.strokeStyle = '#fff0a2'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y - 10, 10, 0, PI2); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0; ctx.font = '800 14px Inter'; ctx.fillStyle = '#694b1b'; ctx.textAlign = 'center';
  ctx.fillText('1', x, y - 5); ctx.restore();
}
