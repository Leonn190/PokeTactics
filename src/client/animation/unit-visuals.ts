import type { Family, UnitPosition, UnitVisualEvent } from '../../../server/types';

export type Portrait = { id: string; family: Family; stage: number; level: number; position: UnitPosition };
type Point = { x: number; y: number };
type DrawSprite = (x: number, y: number, pokemon: Portrait, opacity: number, scale: number) => void;
type DrawBall = (x: number, y: number, radius: number) => void;
const PI2 = Math.PI * 2;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (t: number) => t * t * (3 - 2 * t);

/** Reusable purchase / evolution / final-form fusion renderer (purely presentational). */
export function drawUnitVisualEvent(ctx: CanvasRenderingContext2D, event: UnitVisualEvent, age: number,
  destination: Point, trainer: Point, resolve: (position: UnitPosition) => Point,
  cellScale: number, drawSprite: DrawSprite, drawBall: DrawBall): void {
  if (!event.pokemon || event.kind === 'trainer-damage') return;
  const to = destination;
  const unit: Portrait = { id: event.unitId, ...event.pokemon };
  if (event.kind === 'summon') {
    const travel = clamp(age / .46), eased = ease(travel);
    if (age < .46) {
      const x = trainer.x + (to.x - trainer.x) * eased;
      const y = trainer.y - 17 + (to.y - trainer.y + 17) * eased - Math.sin(travel * Math.PI) * cellScale * .85;
      drawBall(x, y, 8);
    } else if (age < 1.02) {
      ctx.save();
      ctx.strokeStyle = '#eafeee'; ctx.lineWidth = 2.8;
      ctx.globalAlpha = clamp((1.02 - age) / .56) * .72;
      ctx.beginPath(); ctx.ellipse(to.x, to.y - 24, (age - .46) * 68, (age - .46) * 48, 0, 0, PI2); ctx.stroke();
      ctx.restore();
      const materialize = ease(clamp((age - .45) / .30));
      if (materialize > 0 && age < .78) drawSprite(to.x, to.y, unit, materialize, .79 + materialize * .21);
    }
    return;
  }
  const fusion = event.kind === 'fusion';
  const donors = event.sources || [];
  if (age < .69) {
    const progress = ease(clamp(age / .61));
    donors.forEach((source, i) => {
      if (fusion && source.id === event.unitId) return; // survivor stays in the arena
      const from = resolve(source.position);
      const x = from.x + (to.x - from.x) * progress + Math.sin(progress * Math.PI) * (i - (donors.length - 1) / 2) * cellScale * .22;
      const y = from.y + (to.y - from.y) * progress - Math.sin(progress * Math.PI) * cellScale * .23;
      const opacity = fusion ? 1 - ease(clamp((age - .36) / .33)) : 1 - ease(clamp((age - .51) / .18));
      if (opacity > 0) drawSprite(x, y, { id: source.id || `${event.id}:${i}`, ...source }, opacity, 1);
    });
  }
  const strength = clamp(1 - age / 1.16);
  ctx.save(); ctx.globalAlpha = strength * (fusion ? .65 : .8);
  ctx.strokeStyle = '#ffe5a5'; ctx.shadowColor = '#f8d176'; ctx.shadowBlur = 16; ctx.lineWidth = 2.8;
  for (let ring = 0; ring < (fusion ? 2 : 3); ring++) {
    const r = cellScale * (.20 + ring * .15 + age * .16);
    ctx.beginPath(); ctx.ellipse(to.x, to.y - 17, r, r * .48, 0, 0, PI2); ctx.stroke();
  }
  if (age >= .48 && age < .9) {
    ctx.fillStyle = '#fff3bd';
    const pulse = clamp(1 - Math.abs(age - .65) / .25);
    ctx.beginPath(); ctx.arc(to.x, to.y - 25, (fusion ? 21 : 30) * pulse, 0, PI2); ctx.fill();
  }
  ctx.restore();
  if (!fusion && age >= .63 && age < 1.15) {
    const show = ease(clamp((age - .63) / .32));
    drawSprite(to.x, to.y, unit, show, .81 + show * .19);
  }
  if (fusion && age >= .53 && age < 1.13) {
    ctx.save(); ctx.font = '800 15px Inter,sans-serif'; ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, (age - .53) * 5, (1.13 - age) * 4);
    ctx.lineWidth = 3; ctx.strokeStyle = '#142720'; ctx.fillStyle = '#e7f6b5';
    ctx.strokeText('+5 níveis', to.x, to.y - cellScale - 16 - (age - .53) * 16);
    ctx.fillText('+5 níveis', to.x, to.y - cellScale - 16 - (age - .53) * 16); ctx.restore();
  }
}
