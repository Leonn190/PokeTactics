/** Shared travelling VFX: elemental regular shots and piercing flames. */
import type { CombatEffect } from '../../../server/types';
import { paintBasicProjectile } from '../render/projectiles';
type Point = { x: number; y: number };
const PI2 = Math.PI * 2;
export function renderTravelEffects(ctx: CanvasRenderingContext2D, fx: CombatEffect, from: Point, to: Point, t: number, cellScale: number): boolean {
      if(fx.kind==='wind-tornado'){
        // Current server position is authoritative; visual spin is cosmetic.
        const radius=cellScale*.28,angle=fx.time*11;
        ctx.save();ctx.translate(from.x,from.y-cellScale*.3);
        ctx.strokeStyle='#d7f9ff';ctx.fillStyle='#80e5e53b';ctx.shadowColor='#92e6ff';ctx.shadowBlur=11;
        for(let i=0;i<3;i++){
          const r=radius*(.5+i*.33);
          ctx.lineWidth=3.5-i*.65;
          ctx.beginPath();ctx.ellipse(0,-i*6,r,r*.47,angle+i*1.5,0,Math.PI*1.6);ctx.stroke();
        }
        ctx.beginPath();ctx.ellipse(0,-8,radius*.8,radius*1.45,0,0,Math.PI*2);ctx.fill();
        ctx.restore();return true;
      }
      if(fx.kind==='psychic-shot'){
        const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t-cellScale*.28;
        const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy)||1;
        ctx.save();ctx.strokeStyle='#d5a8ff';ctx.fillStyle='#f5e2ff';ctx.shadowColor='#a66bff';ctx.shadowBlur=17;ctx.lineWidth=Math.max(2,cellScale*.055);
        ctx.beginPath();ctx.moveTo(x-dx/length*cellScale*.38,y-dy/length*cellScale*.38);ctx.lineTo(x,y);ctx.stroke();
        ctx.beginPath();ctx.arc(x,y,Math.max(3,cellScale*.10),0,PI2);ctx.fill();ctx.restore();return true;
      }
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
