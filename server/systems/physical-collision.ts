import type { Battle, CombatUnit } from '../types';
import { collisionRadius } from '../data';

const radius = (unit:CombatUnit) => collisionRadius(unit.family,unit.stage);
const solid = (unit:CombatUnit) => unit.hp>0 && !unit.ghost && !unit.dig && !unit.charge && !unit.leap && !unit.fear && !unit.hitmonAction && !(unit.synergy?.flight || unit.synergy?.intangibleUntil && unit.synergy.intangibleUntil>unit.itemNow);

/** Predict a safe next step without moving or mutating the other units. */
export function clearStep(battle:Battle, unit:CombatUnit, x:number,y:number):boolean {
 const ownRadius=radius(unit);
 return !battle.units.some(other=>other!==unit && solid(other) &&
   (other.x-x)**2+(other.y-y)**2 < (radius(other)+ownRadius+.014)**2);
}

/** Separate only actual intersections. No persistent forces/jitter when bodies are resting. */
export function resolveBodies(battle:Battle, bounds:{minX:number;maxX:number;minY:number;maxY:number}):void {
 const units=battle.units.filter(solid).sort((a,b)=>a.id.localeCompare(b.id));
 // Unit size stays unchanged throughout this collision resolution.
 const radii=units.map(radius);
 for(let pass=0;pass<2;pass++) {
   let moved=false;
   for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){
     const a=units[i],b=units[j];
     let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
     const penetration=radii[i]+radii[j]-d;
     if(penetration<=.002)continue;
     if(d<.000001){const angle=(i*47+j*19)%7*Math.PI/3.5;dx=Math.cos(angle);dy=Math.sin(angle);d=1;}
     const nx=dx/d,ny=dy/d;
     const first=Math.min(.10,penetration/2);
     const ax=Math.max(bounds.minX+radii[i],Math.min(bounds.maxX-radii[i],a.x-nx*first));
     const ay=Math.max(bounds.minY+radii[i],Math.min(bounds.maxY-radii[i],a.y-ny*first));
     const remainder=Math.min(.20,Math.max(0,penetration- Math.hypot(ax-a.x,ay-a.y)));
     b.x=Math.max(bounds.minX+radii[j],Math.min(bounds.maxX-radii[j],b.x+nx*remainder));
     b.y=Math.max(bounds.minY+radii[j],Math.min(bounds.maxY-radii[j],b.y+ny*remainder));
     a.x=ax;a.y=ay;moved=true;
   }
   if(!moved)break;
 }
}
