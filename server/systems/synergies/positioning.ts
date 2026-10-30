import type { Battle,CombatUnit } from '../../types';
export function randomIndex(seed:number,count:number,salt=0):number {
 let x=(seed^Math.imul(salt+1,0x9e3779b9))>>>0;
 x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;
 return count?(x>>>0)%count:0;
}
export function validLanding(battle:Battle,unit:CombatUnit,x:number,y:number):boolean {
 const quad=battle.participants.length>2;
 const side=quad ? (battle.participants.indexOf(unit.playerId)<2?-1:1):0;
 const minX=quad?(side<0?-8.25:.25):-3.95,maxX=quad?(side<0?-.25:8.25):3.95;
 // In the standard two-side arena, preserve the original home half on voluntary flight.
 if(!quad && (unit.row<=3?y>-.15:y<.15))return false;
 return x>=minX&&x<=maxX&&y>=-3.62&&y<=3.62 &&
   !battle.units.some(u=>u!==unit&&u.hp>0&&Math.hypot(u.x-x,u.y-y)<.75);
}
export function landingPositions(battle:Battle,unit:CombatUnit,backOnly=false):Array<{x:number;y:number}> {
 const same=battle.units.filter(u=>u.playerId===unit.playerId);
 const points=same.map(u=>({x:u.x,y:u.y}));
 // Distinct home slots projected from board; preserve arena topology and participant offsets.
 const upper=unit.row<=3;
 for(let row=0;row<4;row++)for(let col=0;col<7;col++){
   const worldRow=upper?3-row:row+4;
   const x=(col-3)*1.04+(worldRow%2?.26:-.26)+(battle.participants.length>2?(battle.participants.indexOf(unit.playerId)<2?-4.35:4.35):0);
   const y=(worldRow-3.5)*.91;
   points.push({x,y});
 }
 return points.filter(p=>validLanding(battle,unit,p.x,p.y)).sort((a,b)=>backOnly ?
   (upper?a.y-b.y:b.y-a.y)||a.x-b.x : a.y-b.y||a.x-b.x);
}
/** Respects occupied units, stops at wall, and never teleports through blockers. */
export function pushTarget(battle:Battle,source:CombatUnit,target:CombatUnit,steps:number):{moved:number;wall:boolean}{
 const d=Math.hypot(target.x-source.x,target.y-source.y)||1;
 const dx=(target.x-source.x)/d,dy=(target.y-source.y)/d;
 let moved=0,wall=false;
 for(let i=0;i<steps;i++){
   const x=target.x+dx*.93,y=target.y+dy*.93;
   if(!validLanding(battle,target,x,y)){
     const quad=battle.participants.length>2,limit=quad?8.25:3.95;
     wall=Math.abs(x)>limit || Math.abs(y)>3.62;
     break;
   }
   target.x=x;target.y=y;moved++;
 }
 return {moved,wall};
}
