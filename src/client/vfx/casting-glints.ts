/** Low-cost elemental preparation VFX, drawn from the same combat snapshot clock.
 * No GPU filters, per-attack objects or independently scheduled timers. */
import { ELEMENTS, getStageData } from '../../../server/data';
import type { CombatUnit } from '../../../server/types';
type Actor = Pick<CombatUnit,'family'|'stage'> & {animation?: CombatUnit['animation']};
const PI2 = Math.PI * 2;
const quiet = new Set(['Idle','Walk','Hover','Sleep','Rotate']);
export function drawCastingGlints(ctx: CanvasRenderingContext2D, x: number, y: number, unit: Actor,
  cell: number, time: number): void {
  const a=unit.animation;
  if (!a || a.role !== 'charged' || quiet.has(a.name) || a.elapsed >= a.duration) return;
  const type = getStageData(unit.family,unit.stage).chargedType;
  const shade = ELEMENTS[type].color;
  const t=Math.min(1,a.elapsed/Math.max(.01,a.duration));
  const pulse=Math.sin(t*Math.PI);
  if(pulse<.03) return;
  const kind=unit.family;
  const count=kind==='pikachu'||kind==='jolteon'||kind==='voltorb'?7:kind==='mew'||kind==='eevee'||kind==='staryu'?6:4;
  const base=cell*(kind==='magikarp'?.33:kind==='voltorb'?.36:.43);
  ctx.save();ctx.globalAlpha=.35+.46*pulse;ctx.strokeStyle=shade;ctx.fillStyle=shade;
  ctx.lineWidth=1.4;
  for(let i=0;i<count;i++){
    const angle=i*PI2/count+time*(kind==='staryu'?2.8:1.4)*(i%2?1:-1);
    const spread=base*(.7+.25*Math.sin(time*4+i*3));
    const px=x+Math.cos(angle)*spread;
    const py=y-cell*.38+Math.sin(angle)*spread*.57;
    ctx.beginPath();
    if(type==='electric'){
      ctx.moveTo(px-3,py-4);ctx.lineTo(px+2,py-1);ctx.lineTo(px-2,py+4);
      ctx.stroke();
    }else if(type==='fire'||type==='grass'||type==='water'||type==='ice'){
      ctx.ellipse(px,py,2.2+1.2*pulse,3.6,angle,0,PI2);ctx.fill();
    }else{
      ctx.arc(px,py,2.1+1.2*pulse,0,PI2);ctx.fill();
    }
  }
  if(kind==='voltorb'||kind==='staryu'||kind==='mew'){
    ctx.globalAlpha=.32*pulse;ctx.lineWidth=1.7;
    ctx.beginPath();ctx.arc(x,y-cell*.38,base*(.7+.32*pulse),0,PI2);ctx.stroke();
  }
  if(kind==='magikarp'&&a.name==='Hop'){
    ctx.globalAlpha=.5*pulse;
    ctx.beginPath();ctx.ellipse(x,y-2,cell*(.23+.18*t),cell*(.06+.04*t),0,0,PI2);ctx.stroke();
  }
  ctx.restore();
}
