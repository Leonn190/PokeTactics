/** Standard basic-attack projectile: one visual profile per elemental type. */
import { ANIMATIONS } from '../../../server/data';
import type { Element } from '../../../server/types';

type Point = { x: number; y: number };
const PI2 = Math.PI * 2;
export function paintBasicProjectile(ctx: CanvasRenderingContext2D, type: Element, from: Point,
  to: Point, normalizedTime: number, cellScale: number): void {
  const profile = ANIMATIONS.projectilesByType[type];
  const progress = Math.min(1, normalizedTime / profile.arrival);
  const x = from.x + (to.x - from.x) * progress;
  const y = from.y + (to.y - from.y) * progress - cellScale * .2 - Math.sin(progress * Math.PI) * cellScale * .16;
  const r = Math.max(4, cellScale * .105);
  ctx.save();
  ctx.globalAlpha = profile.arrival >= 1 ? 1 : progress >= 1 ? Math.max(0, (1 - normalizedTime) / (1 - profile.arrival)) : 1;
  ctx.fillStyle = profile.color;
  ctx.strokeStyle = profile.trail;
  ctx.lineWidth = 2;
  ctx.shadowColor = profile.trail;
  ctx.shadowBlur = 9;
  const dx = to.x - from.x, dy = to.y - from.y;
  const magnitude = Math.hypot(dx, dy) || 1;
  ctx.beginPath(); ctx.moveTo(x - dx/magnitude * r * 2.4, y - dy/magnitude * r * 2.4);
  ctx.lineTo(x, y); ctx.stroke();
  ctx.beginPath();
  if (profile.shape === 'leaf' || profile.shape === 'drop') {
    ctx.ellipse(x, y, r * 1.25, r * .7, Math.atan2(dy, dx) + (profile.shape === 'drop' ? .3 : 0), 0, PI2);
  } else if (profile.shape === 'diamond') {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  } else if (profile.shape === 'spark') {
    ctx.moveTo(x, y - r * 1.4); ctx.lineTo(x + r * .35, y - r * .2);
    ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.4);
    ctx.lineTo(x - r * .35, y + r * .2); ctx.lineTo(x - r, y); ctx.closePath();
  } else if (profile.shape === 'flame') {
    ctx.moveTo(x - r, y + r); ctx.quadraticCurveTo(x - r, y - r, x + r * .3, y - r * 1.35);
    ctx.quadraticCurveTo(x + r * 1.3, y - r * .4, x + r, y + r); ctx.closePath();
  } else ctx.arc(x, y, r, 0, PI2);
  ctx.fill();
  ctx.restore();
}
