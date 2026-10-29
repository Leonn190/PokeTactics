/** Shared travelling VFX: elemental regular shots and piercing flames. */
import type { CombatEffect } from '../../../server/types';
import { paintBasicProjectile } from '../render/projectiles';
type Point = { x: number; y: number };
const PI2 = Math.PI * 2;
export function renderTravelEffects(ctx: CanvasRenderingContext2D, fx: CombatEffect, from: Point, to: Point, t: number, cellScale: number): boolean {
      if (fx.kind === 'basic-projectile') {
        paintBasicProjectile(ctx, fx.basicType || 'normal', from, to, t, cellScale);
        return true;
      }
      if (fx.kind === 'piercing-flame') {
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t - cellScale * .23;
        const dx = to.x - from.x, dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        ctx.save();
        ctx.shadowBlur = 17; ctx.shadowColor = '#ff5516';
        for (let i = 3; i >= 0; i--) {
          const behind = i * (cellScale * .095);
          const px = x - dx / length * behind, py = y - dy / length * behind;
          const radius = 5.5 + (3-i) * 1.35;
          ctx.globalAlpha = (4-i)/4 * .88;
          ctx.fillStyle = i % 2 ? '#ff8e31' : '#fff0a1';
          ctx.beginPath(); ctx.arc(px, py, radius, 0, PI2); ctx.fill();
        }
        ctx.restore();
        return true;
      }
  return false;
}
