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
  if(!['mr-mime','mime-jr'].includes(mime.family)||mime.hp<=0)continue;
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
/** Route ordinary walking via physically traversable hex connections. The initial
 * position is a virtual node: a pushed unit may be between two hex centres.
 * Only ordinary movement uses this planner; special abilities keep their paths. */
export function routeAround(battle:Battle,unit:CombatUnit,target:CombatUnit,reach=unit.range):{x:number;y:number}|null {
 const radius=collisionRadius(unit.family,unit.stage);
 const solid=(other:CombatUnit)=>other.hp>0 && !other.ghost && !other.dig && !other.charge &&
   !other.leap && !other.fear && !other.hitmonAction &&
   !(other.synergy?.flight || (other.synergy?.intangibleUntil && other.synergy.intangibleUntil>battle.elapsed));
 const bodies=battle.units.filter(other=>other!==unit&&solid(other));
 const occupied=(x:number,y:number)=>bodies.some(other=>
   dist2(x,y,other.x,other.y)<(radius+collisionRadius(other.family,other.stage)+.025)**2);
 // Dijkstra must obey the same body footprints as clearStep. A free destination
 // can still be unreachable when the segment leading into it cuts through a unit.
 const clearLane=(from:{x:number;y:number},to:{x:number;y:number}):boolean=>{
  if(firstObstacle(battle,unit.playerId,from.x,from.y,to.x,to.y,radius*.8))return false;
  return !bodies.some(other=>{
   const required=radius+collisionRadius(other.family,other.stage)+.015;
   return collisionParameter(from.x,from.y,to.x,to.y,other.x,other.y,required)!==null;
  });
 };
 const cached=unit.obstacleRoute;
 if(cached && cached.version===(battle.obstacleVersion||0) && cached.targetId===target.id &&
   Math.hypot(cached.targetX-target.x,cached.targetY-target.y)<.26 && cached.expires>battle.elapsed){
  while(cached.points.length && Math.hypot(cached.points[0].x-unit.x,cached.points[0].y-unit.y)<.14)cached.points.shift();
  if(cached.points.length && !occupied(cached.points[0].x,cached.points[0].y) &&
    clearLane(unit,cached.points[0]))return cached.points[0];
 }
 const multi=battle.participants.length>2;
 const count=multi?2:1;
 const nodes:Array<{x:number;y:number;row:number;col:number;board:number}>=[];
 for(let board=0;board<count;board++)for(let row=0;row<8;row++)for(let col=0;col<7;col++){
  const p=gridXY(col,row);
  nodes.push({x:p.x+(multi?(board===0?-4.35:4.35):0),y:p.y,row,col,board});
 }
 const blocked=nodes.map(p=>occupied(p.x,p.y) ||
   firstObstacle(battle,unit.playerId,p.x,p.y,p.x,p.y,radius*.8)!==null);
 const best=Array(nodes.length).fill(Infinity) as number[];
 const previous=Array(nodes.length).fill(-1) as number[];
 const visited=Array(nodes.length).fill(false) as boolean[];
 // Seed from the real position, not just its closest logical hexagon.
 for(let i=0;i<nodes.length;i++){
  if(blocked[i])continue;
  const d=Math.hypot(nodes[i].x-unit.x,nodes[i].y-unit.y);
  if(d<=1.45 && clearLane(unit,nodes[i]))best[i]=d;
 }
 // A strongly displaced unit can still recover the nearest accessible hex.
 if(!best.some(Number.isFinite)){
  let nearest=-1,nearestDistance=Infinity;
  for(let i=0;i<nodes.length;i++){
   if(blocked[i])continue;
   const d=Math.hypot(nodes[i].x-unit.x,nodes[i].y-unit.y);
   if(d<nearestDistance && clearLane(unit,nodes[i])){nearest=i;nearestDistance=d;}
  }
  if(nearest>=0)best[nearest]=nearestDistance;
 }
 const edge=(board:number,row:number,col:number)=>board*56+row*7+col;
 for(let step=0;step<nodes.length;step++){
  let current=-1;
  for(let i=0;i<nodes.length;i++){
   if(visited[i]||!Number.isFinite(best[i]))continue;
   if(current<0||best[i]<best[current])current=i;
  }
  if(current<0)break;
  visited[current]=true;
  const here=nodes[current],c=here.col,r=here.row,b=here.board;
  const neighbors:number[]=[];
  if(c>0)neighbors.push(edge(b,r,c-1));
  if(c<6)neighbors.push(edge(b,r,c+1));
  for(const nextRow of [r-1,r+1])if(nextRow>=0&&nextRow<8){
   const diagonal=r%2===0?c-1:c+1;
   neighbors.push(edge(b,nextRow,c));
   if(diagonal>=0&&diagonal<7)neighbors.push(edge(b,nextRow,diagonal));
  }
  if(multi && b===0 && c===6)neighbors.push(edge(1,r,0));
  if(multi && b===1 && c===0)neighbors.push(edge(0,r,6));
  for(const next of neighbors){
   if(blocked[next]||visited[next]||!clearLane(here,nodes[next]))continue;
   const cost=best[current]+Math.hypot(nodes[next].x-here.x,nodes[next].y-here.y);
   if(cost+1e-8<best[next]){best[next]=cost;previous[next]=current;}
  }
 }
 // An attack destination must have both legal reach and an unobstructed strike
 // (the victim's occupied centre is never itself a walkable goal).
 let goal=-1,score=Infinity;
 let finalApproach:{x:number;y:number}|null=null;
 const canStrike=(p:{x:number;y:number})=>
   Math.hypot(p.x-target.x,p.y-target.y)<=reach+.02 &&
   !firstObstacle(battle,unit.playerId,p.x,p.y,target.x,target.y);
 const currentCanStrike=canStrike(unit);
 for(let i=0;i<nodes.length;i++){
  if(!Number.isFinite(best[i])||blocked[i])continue;
  const p=nodes[i];
  if(!canStrike(p))continue;
  // Do not choose a zero-length "route" just because the nearest cell can
  // attack while the unit's actual, slightly displaced position cannot.
  if(!currentCanStrike && Math.hypot(p.x-unit.x,p.y-unit.y)<.14)continue;
  const cost=best[i]+Math.hypot(p.x-target.x,p.y-target.y)*.03;
  if(cost<score-1e-8){goal=i;score=cost;}
 }
 // A melee attack position normally lies *between* hex centres. Without a
 // continuous contact ring, adjacent hexes are too far away for range 1 and
 // units can idle beside their opponent forever.
 if(goal<0 && reach<1.45){
  const contact=radius+collisionRadius(target.family,target.stage)+.04;
  const approachRadius=Math.max(contact,reach-.025);
  const bounds={minX:multi?-8.25:-3.95,maxX:multi?8.25:3.95,minY:-3.62,maxY:3.62};
  for(let angle=0;angle<16;angle++){
   const theta=angle*Math.PI/8;
   const endpoint={x:target.x+approachRadius*Math.cos(theta),y:target.y+approachRadius*Math.sin(theta)};
   if(endpoint.x<bounds.minX+radius || endpoint.x>bounds.maxX-radius ||
     endpoint.y<bounds.minY+radius || endpoint.y>bounds.maxY-radius ||
     occupied(endpoint.x,endpoint.y) || !canStrike(endpoint))continue;
   for(let i=0;i<nodes.length;i++){
    if(!Number.isFinite(best[i])||blocked[i]||!clearLane(nodes[i],endpoint))continue;
    const cost=best[i]+Math.hypot(nodes[i].x-endpoint.x,nodes[i].y-endpoint.y);
    if(cost<score-1e-8){goal=i;score=cost;finalApproach=endpoint;}
   }
  }
 }
 // When every attack position is obstructed, stage towards the closest
 // reachable approach instead of repeatedly planning an empty route.
 if(goal<0){
  score=Infinity;
  const currentDistance=Math.hypot(unit.x-target.x,unit.y-target.y);
  for(let i=0;i<nodes.length;i++){
   if(!Number.isFinite(best[i])||blocked[i])continue;
   const p=nodes[i],d=Math.hypot(p.x-target.x,p.y-target.y);
   if(Math.hypot(p.x-unit.x,p.y-unit.y)<.18)continue;
   const progress=Math.max(0,d-reach);
   const penalty=d>=currentDistance-.08?1.5:0;
   const cost=best[i]+progress*4+penalty;
   if(cost<score-1e-8){goal=i;score=cost;}
  }
 }
 const points:Array<{x:number;y:number}>=[];
 if(goal>=0){
  let current=goal;
  while(current>=0&&points.length<nodes.length){
   points.unshift({x:nodes[current].x,y:nodes[current].y});
   current=previous[current];
  }
  if(finalApproach)points.push(finalApproach);
  while(points.length && Math.hypot(points[0].x-unit.x,points[0].y-unit.y)<.14)points.shift();
 }
 unit.obstacleRoute={
  version:battle.obstacleVersion||0,targetId:target.id,targetX:target.x,targetY:target.y,
  points,expires:battle.elapsed+.40
 };
 return points[0]||null;
}
