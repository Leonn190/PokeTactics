/** Shared, authoritative persistent hex effects. One effective poison per tile. */
import { gridXY, TERRAIN } from '../data';
import type { Battle, CombatUnit, PoisonTerrain } from '../types';
const config=TERRAIN.poison;
const CELL_CENTERS=Array.from({length:8},(_,row)=>Array.from({length:7},(_,col)=>({col,row,...gridXY(col,row)}))).flat();
export function nearestCell(x:number,y:number):{col:number;row:number}|null {
 let best=Infinity,found:typeof CELL_CENTERS[number]|undefined;
 for(const cell of CELL_CENTERS){const d=(cell.x-x)**2+(cell.y-y)**2;if(d<best){best=d;found=cell;}}
 return found&&best<=.85**2?{col:found.col,row:found.row}:null;
}
export const terrainKey=(col:number,row:number)=>`${col}:${row}`;
export function neighbors(col:number,row:number):Array<{col:number;row:number}> {
 const adjacent=[{col:col-1,row},{col:col+1,row}];
 for(const r of [row-1,row+1]){
  adjacent.push({col,row:r},{col:col+(row%2?1:-1),row:r});
 }
 return adjacent.filter(p=>p.col>=0&&p.col<7&&p.row>=0&&p.row<8);
}
export function poisonCell(battle:Battle,source:CombatUnit,cell:{col:number;row:number}|null,intensity:number,duration:number,spa:number):void {
 if(!cell||intensity<1||duration<=0)return;
 const grid=battle.terrain||={};const key=terrainKey(cell.col,cell.row);
 const next=Math.min(3,Math.max(1,Math.floor(intensity))) as 1|2|3;
 const current=grid[key];
 if(current && current.intensity>next&&current.until>battle.elapsed)return;
 // Stronger/equal applications replace the effective author, never stack DoT.
 grid[key]={kind:'poison',col:cell.col,row:cell.row,sourceId:source.id,ownerId:source.playerId,
  sourceSpa:spa,intensity:next,until:battle.elapsed+duration+config.decaySeconds*(next-1),
  nextDecay:battle.elapsed+duration,nextTick:battle.elapsed+config.damageInterval};
}
export function poisonSplash(battle:Battle,source:CombatUnit,cell:{col:number;row:number}|null,
 centerIntensity:number,adjacentIntensity:number,duration:number,spa:number):void {
 if(!cell)return;
 poisonCell(battle,source,cell,centerIntensity,duration,spa);
 if(adjacentIntensity>0)for(const neighbor of neighbors(cell.col,cell.row))poisonCell(battle,source,neighbor,adjacentIntensity,duration,spa);
}
export function poisonousMovement(battle:Battle,source:CombatUnit,spa:number):void {
 if(source.family!=='grimer')return;
 const kind=source.stage>0?config.muk:config.grimer;
 const cell=nearestCell(source.x,source.y);
 if(!cell)return;
 const key=terrainKey(cell.col,cell.row),previous=source.poisonLastTile;
 if(previous&&previous!==key){const [col,row]=previous.split(':').map(Number);
  poisonCell(battle,source,{col,row},kind.trailIntensity,kind.trailSeconds,spa);
 }
 source.poisonLastTile=key;
}
export function poisonousHealth(battle:Battle,source:CombatUnit,spa:number):void {
 if(source.family!=='grimer')return;
 const kind=source.stage>0?config.muk:config.grimer;
 const crossed=Math.min(3,Math.max(0,Math.floor((1-Math.max(0,source.hp)/Math.max(1,source.maxHp))/kind.healthStep+1e-7)));
 const previous=source.poisonThresholds||0;
 if(crossed>previous){const cell=nearestCell(source.x,source.y);
  for(let i=previous;i<crossed;i++)if(cell)for(const neighbor of neighbors(cell.col,cell.row))
   poisonCell(battle,source,neighbor,kind.healthIntensity,kind.healthSeconds,spa);
  source.poisonThresholds=crossed;
 }
}
export function poisonousDeath(battle:Battle,source:CombatUnit,spa:number):void {
 if(source.family!=='grimer'||source.poisonDeathEmitted)return;
 source.poisonDeathEmitted=true;
 const kind=source.stage>0?config.muk:config.grimer;
 poisonSplash(battle,source,nearestCell(source.x,source.y),kind.deathCenterIntensity,kind.deathAdjacentIntensity,kind.deathSeconds,spa);
}
/** Actual simulation ticks; every tile owns a single timer and author. */
export function tickTerrain(battle:Battle,dealPoison:(source:CombatUnit,target:CombatUnit,raw:number)=>void):void {
 const grid=battle.terrain;if(!grid)return;
 // Index only occupied hexes; no full-board scan per frame.
 const occupied=new Map<string,CombatUnit[]>();
 for(const unit of battle.units){if(unit.hp<=0)continue;const cell=nearestCell(unit.x,unit.y);if(!cell)continue;
  const key=terrainKey(cell.col,cell.row);const list=occupied.get(key)||[];list.push(unit);occupied.set(key,list);
 }
 for(const [key,tile] of Object.entries(grid)){
  if(tile.until<=battle.elapsed){delete grid[key];continue;}
  while(tile.intensity>1&&tile.nextDecay<=battle.elapsed){tile.intensity=(tile.intensity-1) as 1|2|3;tile.nextDecay+=config.decaySeconds;}
  const source=battle.units.find(unit=>unit.id===tile.sourceId);
  if(!source)continue;
  let iterations=0;
  while(tile.nextTick<=battle.elapsed&&iterations++<20){
   const raw=config.baseDamageByIntensity[tile.intensity]+tile.sourceSpa*config.spaRatioByIntensity[tile.intensity];
   for(const target of occupied.get(key)||[])if(target.hp>0&&target.playerId!==tile.ownerId)dealPoison(source,target,raw);
   tile.nextTick+=config.damageInterval;
  }
 }
}
