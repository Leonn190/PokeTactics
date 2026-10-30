import { gridXY } from '../data';
import type { Battle } from '../types';

/** Stateless, deterministic pseudo-random sampling. No wall-clock or global RNG. */
function mix32(value:number):number {
 let bits=value>>>0;
 bits^=bits>>>16;bits=Math.imul(bits,0x7feb352d);bits^=bits>>>15;
 bits=Math.imul(bits,0x846ca68b);bits^=bits>>>16;
 return bits>>>0;
}
export function meteorCenters(battle:Battle,serial:number,count:number):Array<{x:number;y:number}> {
 const quad=battle.participants.length>2;
 const used=new Set<number>(),result:Array<{x:number;y:number}>=[];
 const cells=56*(quad?2:1);
 for(let index=0;index<Math.min(Math.max(0,Math.floor(count)),cells);index++) {
   let candidate=mix32(battle.seed^Math.imul(serial+1,0x9e3779b9)^Math.imul(index+19,0x85ebca6b))%cells;
   while(used.has(candidate))candidate=(candidate+1)%cells;
   used.add(candidate);
   const slot=Math.floor(candidate/56);
   const cell=candidate%56;
   const xy=gridXY(cell%7,Math.floor(cell/7));
   result.push({x:xy.x+(quad?(slot===0?-4.35:4.35):0),y:xy.y});
 }
 return result;
}
export function withinCone(origin:{x:number;y:number},aim:{x:number;y:number},target:{x:number;y:number},range:number,angle:number):boolean {
 const dx=target.x-origin.x,dy=target.y-origin.y;
 const radius=Math.hypot(dx,dy),heading=Math.hypot(aim.x-origin.x,aim.y-origin.y);
 if(radius>range||heading<.001)return false;
 if(radius<.01)return true;
 const dot=(dx*(aim.x-origin.x)+dy*(aim.y-origin.y))/(radius*heading);
 return dot>=Math.cos(Math.max(1,Math.min(179,angle))*Math.PI/360);
}
