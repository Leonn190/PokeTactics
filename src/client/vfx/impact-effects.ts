/** Hit numbers, impact rings and collectible projectile landing effects. */
import { SPECIES } from '../../../server/data';
import type { CombatEffect } from '../../../server/types';
type Point = { x: number; y: number };
const PI2 = Math.PI * 2;
export function renderImpactEffects(ctx: CanvasRenderingContext2D, fx: CombatEffect, from: Point, to: Point, t: number, cellScale: number): boolean {
      if (fx.kind === 'trainer-hit') {
        const flight = Math.min(1, t / .78);
        // Projétil guiado; descreve um arco que converge para o avatar.
        const ease = flight * flight * (3 - 2 * flight);
        const x = from.x + (to.x - from.x) * ease + Math.sin(flight * Math.PI) * 9;
        const y = from.y + (to.y - from.y) * ease - Math.sin(flight * Math.PI) * 55 - 23;
        ctx.save(); ctx.shadowColor = SPECIES[fx.family].glow; ctx.shadowBlur = 22;
        ctx.fillStyle = '#fffce6'; ctx.strokeStyle = SPECIES[fx.family].glow; ctx.lineWidth = 3;
        ctx.globalAlpha = flight < 1 ? 1 : Math.max(0, 1 - (t - .78) / .22);
        ctx.beginPath(); ctx.arc(x, y, flight < 1 ? 7 : 10 + (t - .78) * 75, 0, PI2); ctx.fill(); ctx.stroke();
        ctx.restore(); return true;
      }
      if (fx.kind === 'damage') {
        // Flutua apenas sobre o Pokémon atingido. O projétil é desenhado separadamente.
        const p = to;
        const amount = Math.max(1, Math.round(fx.value));
        const size = Math.min(35, 13 + Math.sqrt(amount) * 1.8);
        const color = fx.damageType === 'physical' ? '#ffd1a0' : fx.damageType === 'special' ? '#97d0ff' : '#eab1ff';
        ctx.save(); ctx.globalAlpha = Math.min(1, (1 - t) * 1.55);
        ctx.font = `900 ${size}px 'Barlow Condensed',sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 3.5; ctx.strokeStyle = '#122027';
        const posY = p.y - cellScale * .4 - 24 - t * 54;
        ctx.strokeText(String(amount), p.x, posY); ctx.fillStyle = color; ctx.fillText(String(amount), p.x, posY);
        ctx.restore(); return true;
      }
      if (fx.kind === 'ball' || fx.kind === 'bone' || fx.kind === 'egg') {
        const arrival = fx.kind === 'bone' ? .78 : .83;
        const fly = Math.min(1,t/arrival);
        const x = from.x+(to.x-from.x)*fly, y = from.y+(to.y-from.y)*fly - 25*Math.sin(fly*Math.PI)-12;
        const color = fx.kind === 'egg' ? '#e8ffe6' : fx.kind === 'bone' ? '#edd9af' : SPECIES[fx.family].glow;
        ctx.save();ctx.globalAlpha = fly < 1 ? 1 : Math.max(0,1-(t-arrival)/(1-arrival));
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
