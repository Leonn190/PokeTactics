/** Temporary occupied cells and team-directional hex edges.
 * Uses physical arena coordinates and logical battle time; no DOM, no FPS coupling. */
import { collisionRadius, gridXY, getStageData, ATTACKS } from '../data';
import type { Battle, CombatUnit, ArenaObstacle } from '../types';

const dist2=(x:number,y:number,px:number,py:number)=>(x-px)**2+(y-py)**2;
function closestParameter(ax:number,ay:number,bx:number,by:number,px:number,py:number):number {
 const dx=bx-ax,dy=by-ay,ss=dx*dx+dy*dy;
 return ss?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/ss)):0;
}
function collisionParameter(ax:number,ay:number,bx:number,by:number,cx:number,cy:number,radius:number):number|null {
 const t=closestParameter(ax,ay,bx,by,cx,cy);
 return dist2(ax+(bx-ax)*t,ay+(by-ay)*t,cx,cy)<radius*radius?t:null;
}
function crossing(ax:number,ay:number,bx:number,by:number,cx:number,cy:number,dx:number,dy:number):number|null {
 const ux=bx-ax,uy=by-ay,vx=dx-cx,vy=dy-cy,den=ux*vy-uy*vx;
 if(Math.abs(den)<1e-9)return null;
 const nx=cx-ax,ny=cy-ay;
 const t=(nx*vy-ny*vx)/den, s=(nx*uy-ny*ux)/den;
 return t>0.00001&&t<=1&&s>=0&&s<=1?t:null;
}
export function firstObstacle(battle:Battle,team:string,ax:number,ay:number,bx:number,by:number,radius=0):{obstacle:ArenaObstacle;t:number}|null {
 let first:{obstacle:ArenaObstacle;t:number}|null=null;
 for(const obs of battle.obstacles){
  if(obs.until<=battle.elapsed)continue;
  let t:number|null=null;
  if(obs.kind==='pillar')t=collisionParameter(ax,ay,bx,by,obs.x,obs.y,.41+radius);
  else if(obs.ownerId!==team)t=crossing(ax,ay,bx,by,obs.ax,obs.ay,obs.bx,obs.by);
  if(t!==null && (!first||t<first.t))first={obstacle:obs,t};
 }
 return first;
}
export function blocksStep(battle:Battle,unit:CombatUnit,x:number,y:number):boolean {
 return firstObstacle(battle,unit.playerId,unit.x,unit.y,x,y,collisionRadius(unit.family,unit.stage)*.8)!==null;
}
/** Every change to geometry invalidates cached route plans. */
export function expireObstacles(battle:Battle):void {
 const length=battle.obstacles.length;
 battle.obstacles=battle.obstacles.filter(o=>o.until>battle.elapsed);
 if(length!==battle.obstacles.length)battle.obstacleVersion=(battle.obstacleVersion||0)+1;
}
export function summonWalls(battle:Battle,unit:CombatUnit,duration:number):void {
 const foe=battle.units.filter(u=>u.playerId!==unit.playerId&&u.hp>0)
  .sort((a,b)=>dist2(a.x,a.y,unit.x,unit.y)-dist2(b.x,b.y,unit.x,unit.y)||a.id.localeCompare(b.id))[0];
 const angle=foe?Math.atan2(foe.y-unit.y,foe.x-unit.x):Math.PI/2;
 const directions=Array.from({length:6},(_,i)=>i*Math.PI/3);
 directions.sort((a,b)=>Math.cos(b-angle)-Math.cos(a-angle)||a-b);
 battle.obstacles=battle.obstacles.filter(o=>o.sourceId!==unit.id||o.kind!=='wall');
 directions.slice(0,2).forEach((a,index)=>{
  const nx=Math.cos(a),ny=Math.sin(a),px=-ny,py=nx,midX=unit.x+nx*.54,midY=unit.y+ny*.54;
  battle.obstacles.push({id:`${battle.id}:${unit.id}:wall:${index}:${unit.metrics.casts}`,ownerId:unit.playerId,sourceId:unit.id,kind:'wall',x:midX,y:midY,
   ax:midX-px*.52,ay:midY-py*.52,bx:midX+px*.52,by:midY+py*.52,createdAt:battle.elapsed,until:battle.elapsed+duration});
 });
 battle.obstacleVersion=(battle.obstacleVersion||0)+1;
}
/** Opposing territory positions are based only on public preparation coordinates. */
export function summonPreparedPillars(battle:Battle,deal:(battle:Battle,source:CombatUnit,target:CombatUnit,raw:number,magical:boolean,charged?:boolean)=>number):void {
 if(battle.pillarsSpawned)return;
 battle.pillarsSpawned=true;
 const multi=battle.participants.length>2;
 for(const mime of battle.units){
  if(mime.family!=='mr-mime'||mime.hp<=0)continue;
  const slot=battle.participants.indexOf(mime.playerId);
  const enemyTop=multi ? slot===0||slot===3 : slot===0;
  const offset=multi?(slot<2?-4.35:4.35):0;
  const marks=mime.mimePillars?.length===2?mime.mimePillars:[{col:2,row:1},{col:4,row:2}];
  for(let index=0;index<2;index++){
   const mark=marks[index];if(!mark||mark.col<0||mark.col>6||mark.row<0||mark.row>3)continue;
   const at=gridXY(mark.col,enemyTop?mark.row:7-mark.row);
   const x=at.x+offset,y=at.y;
   if(battle.obstacles.some(o=>o.kind==='pillar'&&dist2(o.x,o.y,x,y)<.4))continue;
   // Resolve occupation before making the pillar solid. A deterministic nearest open cell
   // is chosen, or the pillar is not materialized if there is no legal destination.
   const occupants=battle.units.filter(u=>u.hp>0&&dist2(u.x,u.y,x,y)<(.41+collisionRadius(u.family,u.stage))**2);
   const relocate=new Map<CombatUnit,{x:number;y:number}>();
   let possible=true;
   for(const occupied of occupants){
    const options=Array.from({length:8*7},(_,n)=>gridXY(n%7,Math.floor(n/7))).map(p=>({x:p.x+offset,y:p.y}))
      .sort((a,b)=>dist2(a.x,a.y,occupied.x,occupied.y)-dist2(b.x,b.y,occupied.x,occupied.y)||a.y-b.y||a.x-b.x);
    const candidate=options.find(pos=>dist2(pos.x,pos.y,x,y)>(.41+collisionRadius(occupied.family,occupied.stage))**2
      && !battle.obstacles.some(o=>o.kind==='pillar'&&dist2(o.x,o.y,pos.x,pos.y)<(.41+collisionRadius(occupied.family,occupied.stage))**2)
      && !battle.units.some(other=>other!==occupied&&other.hp>0&&dist2(other.x,other.y,pos.x,pos.y)<(.04+collisionRadius(occupied.family,occupied.stage)+collisionRadius(other.family,other.stage))**2)
      && ![...relocate.values()].some(other=>dist2(other.x,other.y,pos.x,pos.y)<.5));
    if(!candidate){possible=false;break;}
    relocate.set(occupied,candidate);
   }
   if(!possible)continue;
   for(const [occupied,pos] of relocate){occupied.x=pos.x;occupied.y=pos.y;
     const move=ATTACKS.moves[getStageData(mime.family,mime.stage).move];
     if(occupied.playerId!==mime.playerId)deal(battle,mime,occupied,(move.pillarDamageBase??25)+mime.stats.spa*(move.pillarSpaRatio??0.25),true,true);
   }
   const move=ATTACKS.moves[getStageData(mime.family,mime.stage).move];
   battle.obstacles.push({id:`${battle.id}:${mime.id}:pillar:${index}`,ownerId:mime.playerId,sourceId:mime.id,kind:'pillar',x,y,ax:x-.4,ay:y,bx:x+.4,by:y,createdAt:battle.elapsed,until:battle.elapsed+(move.pillarDuration??5)});
  }
 }
 if(battle.obstacles.length)battle.obstacleVersion=(battle.obstacleVersion||0)+1;
}
/** Small deterministic hex A*. Consulted only when a physical obstacle blocks engagement.
 * Replan on geometry version, changing target position, or after 0.55 logical seconds. */
export function routeAround(battle:Battle,unit:CombatUnit,target:CombatUnit):{x:number;y:number}|null {
 const cached=unit.obstacleRoute;
 if(cached&&cached.version===(battle.obstacleVersion||0)&&cached.targetId===target.id
   && Math.hypot(cached.targetX-target.x,cached.targetY-target.y)<.6&&cached.expires>battle.elapsed){
  while(cached.points.length&&Math.hypot(cached.points[0].x-unit.x,cached.points[0].y-unit.y)<.15)cached.points.shift();
  if(cached.points[0])return cached.points[0];
 }
 const nodes:Array<{x:number;y:number;col:number;row:number}>=[];
 const offsets=battle.participants.length>2?[-4.35,4.35]:[0];
 for(const offset of offsets)for(let row=0;row<8;row++)for(let col=0;col<7;col++){
  const q=gridXY(col,row),x=q.x+offset,y=q.y;
  if(firstObstacle(battle,unit.playerId,x,y,x,y,collisionRadius(unit.family,unit.stage)*.7))continue;
  nodes.push({x,y,row,col});
 }
 if(!nodes.length)return null;
 const start=nodes.reduce((best,node,i)=>dist2(node.x,node.y,unit.x,unit.y)<dist2(nodes[best].x,nodes[best].y,unit.x,unit.y)?i:best,0);
 const goals=nodes.map((node,i)=>({i,dist:Math.hypot(node.x-target.x,node.y-target.y)}))
   .filter(o=>o.dist<=Math.max(.7,unit.range+.34)&&!firstObstacle(battle,unit.playerId,nodes[o.i].x,nodes[o.i].y,target.x,target.y))
   .sort((a,b)=>a.dist-b.dist||a.i-b.i);
 const goal=goals[0]?.i??nodes.reduce((best,node,i)=>dist2(node.x,node.y,target.x,target.y)<dist2(nodes[best].x,nodes[best].y,target.x,target.y)?i:best,0);
 const open=[start], g=new Array(nodes.length).fill(Infinity), prev=new Array(nodes.length).fill(-1),closed=new Set<number>();g[start]=0;
 while(open.length){
  open.sort((a,b)=>(g[a]+Math.hypot(nodes[a].x-nodes[goal].x,nodes[a].y-nodes[goal].y))-(g[b]+Math.hypot(nodes[b].x-nodes[goal].x,nodes[b].y-nodes[goal].y))||a-b);
  const i=open.shift()!;if(i===goal)break;if(closed.has(i))continue;closed.add(i);
  const here=nodes[i];
  for(let j=0;j<nodes.length;j++){
   if(i===j||closed.has(j))continue;
   const there=nodes[j], d=Math.hypot(there.x-here.x,there.y-here.y);
   if(d<.35||d>1.2||firstObstacle(battle,unit.playerId,here.x,here.y,there.x,there.y,.13))continue;
   const score=g[i]+d;
   if(score+1e-8>=g[j])continue;g[j]=score;prev[j]=i;if(!open.includes(j))open.push(j);
  }
 }
 if(start!==goal&&prev[goal]<0)return null;
 const path:number[]=[];let i=goal;
 while(i!==start&&i>=0&&path.length<nodes.length){path.unshift(i);i=prev[i];}
 const waypoints=path.map(i=>({x:nodes[i].x,y:nodes[i].y}));
 unit.obstacleRoute={version:battle.obstacleVersion||0,targetId:target.id,targetX:target.x,targetY:target.y,points:waypoints,expires:battle.elapsed+.55};
 return waypoints[0]||null;
}
