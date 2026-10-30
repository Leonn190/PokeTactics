/** Hit numbers, impact rings and collectible projectile landing effects. */
import { SPECIES } from '../../../server/data';
import type { CombatEffect } from '../../../server/types';
import { renderFloatingNumber } from './floating-numbers';
type Point = { x: number; y: number };
const PI2 = Math.PI * 2;
export function renderImpactEffects(ctx: CanvasRenderingContext2D, fx: CombatEffect, from: Point, to: Point, t: number, cellScale: number): boolean {
      if (fx.kind === 'trainer-hit') {
        const flight = Math.min(1, t);
        // Projétil guiado; descreve um arco que converge para o avatar.
        const ease = flight * flight * (3 - 2 * flight);
        const x = from.x + (to.x - from.x) * ease + Math.sin(flight * Math.PI) * 9;
        const y = from.y + (to.y - from.y) * ease - Math.sin(flight * Math.PI) * 55 - 23;
        ctx.save(); ctx.shadowColor = SPECIES[fx.family].glow; ctx.shadowBlur = 22;
        ctx.fillStyle = '#fffce6'; ctx.strokeStyle = SPECIES[fx.family].glow; ctx.lineWidth = 3;
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, y, flight < 1 ? 7 : 10 + (t - .78) * 75, 0, PI2); ctx.fill(); ctx.stroke();
        ctx.restore(); return true;
      }
      if (fx.kind === 'damage') {
        renderFloatingNumber(ctx, to.x, to.y - cellScale * .4 - 24, fx.value, t, fx.damageType || 'physical');
        return true;
      }
      if (fx.kind === 'ball' || fx.kind === 'bone' || fx.kind === 'egg') {
        const arrival = 1; // Timed with the projectile's authoritative collision on the server.
        const fly = Math.min(1,t);
        const x = from.x+(to.x-from.x)*fly, y = from.y+(to.y-from.y)*fly - 25*Math.sin(fly*Math.PI)-12;
        const color = fx.kind === 'egg' ? '#e8ffe6' : fx.kind === 'bone' ? '#edd9af' : SPECIES[fx.family].glow;
        ctx.save();ctx.globalAlpha = 1;
        ctx.shadowColor=color;ctx.shadowBlur=13;ctx.fillStyle=color;ctx.strokeStyle='#fffbdc';ctx.lineWidth=2;
        if (fx.kind === 'bone') {
          ctx.translate(x,y);ctx.rotate(fly*14);ctx.fillRect(-12,-3,24,6);
          for(const dx of [-12,12]) for(const dy of [-4,4]) { ctx.beginPath();ctx.arc(dx,dy,4,0,PI2);ctx.fill(); }
        } else if (fx.kind === 'egg') {
          ctx.beginPath();ctx.ellipse(x,y,8,11,fly*2,0,PI2);ctx.fill();ctx.stroke();
        } else { ctx.beginPath();ctx.arc(x,y,10,0,PI2);ctx.fill();ctx.stroke(); }
        ctx.restore();return true;
      }
      if (fx.kind === 'impact') {
        ctx.save();ctx.globalAlpha=(1-t)*.75;ctx.strokeStyle=SPECIES[fx.family].glow;ctx.lineWidth=3;
        ctx.beginPath();ctx.ellipse(to.x,to.y-9,(fx.value || 1.65)*cellScale*(.4+t*.6),
          (fx.value || 1.65)*cellScale*(.18+t*.3),0,0,PI2);ctx.stroke();ctx.restore();return true;
      }
  return false;
}
