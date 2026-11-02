import type { Battle, CombatUnit } from '../types';
import { firstObstacle } from './obstacles';
/** Deterministic target choice, shared by all abilities and basic-attack helpers. */
export const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const stableId = (a: CombatUnit, b: CombatUnit) => a.id.localeCompare(b.id);
export function closestTwo(battle: Battle, source: CombatUnit): CombatUnit[] {
  return battle.units.filter(u => u.hp > 0 && u.playerId === source.playerId && u.id !== source.id)
    .sort((a,b) => distance(source,a)-distance(source,b) || stableId(a,b)).slice(0, 2);
}

export function bestEnemyCluster(battle: Battle, source: CombatUnit, radius: number): CombatUnit | null {
  const targets = battle.units.filter(u => u.hp > 0 && u.playerId !== source.playerId);
  const candidates = targets.filter(u => distance(source,u) <= source.range + .08);
  // Count only once per center; the sort comparator no longer searches every target.
  const counts = new Map<CombatUnit, number>();
  for (const center of candidates) {
    let count = 0;
    for (const target of targets) if (distance(target, center) <= radius) count++;
    counts.set(center, count);
  }
  return candidates.sort((a,b) =>
    counts.get(b)! - counts.get(a)!
    || distance(source,a)-distance(source,b) || stableId(a,b))[0] || null;
}

export function bestEggCenter(battle: Battle, source: CombatUnit, radius: number, range: number): CombatUnit | null {
  const allies = battle.units.filter(u => u.hp > 0 && u.playerId === source.playerId);
  if (!allies.some(u => u.hp < u.maxHp)) return null;
  // Preserve ranking: nearby allies, wounded allies, missing HP, distance and ID.
  const rank = new Map<CombatUnit, {total:number; wounded:number; missing:number}>();
  const candidates: CombatUnit[] = [];
  for (const center of allies) {
    if (distance(source,center) > range) continue;
    let total=0, wounded=0, missing=0;
    for (const ally of allies) {
      if (distance(center,ally) > radius) continue;
      total++;
      if (ally.hp < ally.maxHp) wounded++;
      missing += ally.maxHp - ally.hp;
    }
    if (!wounded) continue;
    candidates.push(center);
    rank.set(center,{total,wounded,missing});
  }
  return candidates.sort((a,b) => {
    const aa=rank.get(a)!,bb=rank.get(b)!;
    return bb.total-aa.total || bb.wounded-aa.wounded || bb.missing-aa.missing
      || distance(source,a)-distance(source,b) || stableId(a,b);
  })[0] || null;
}
export function woundedAllies(battle: Battle, source: CombatUnit, range: number, count: number): CombatUnit[] {
  return battle.units.filter(u => u.playerId === source.playerId && u.hp > 0 && u.hp < u.maxHp && distance(u, source) <= range)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || distance(a, source) - distance(b, source)).slice(0, count);
}


/** Current-tick threat count, without allocating/sorting lists for each opponent.
 * Recompute on demand to observe deaths and moves earlier in the same tick. */
export function countClosestThreats(battle: Battle, source: CombatUnit, limit: number): number {
  let count=0;
  for (const enemy of battle.units) {
    if (enemy.hp <= 0 || enemy.playerId === source.playerId) continue;
    let closest:CombatUnit|undefined;
    let bestDistance=Infinity;
    for (const candidate of battle.units) {
      if (candidate.hp <= 0 || candidate.playerId === enemy.playerId) continue;
      const d=distance(candidate,enemy);
      if (!closest || d < bestDistance || (d === bestDistance && stableId(candidate,closest) < 0)) {
        closest=candidate;bestDistance=d;
      }
    }
    if (closest?.id === source.id) {
      count++;
      if (count >= limit) return Math.min(limit,count);
    }
  }
  return Math.min(limit,count);
}


/** Sticky TFT-style focus with walkable-target awareness. Attackable enemies
 * always take precedence over futile chases, while a healthy focus remains
 * stable across harmless movement and animation ticks. */
export function selectCombatTarget(
 battle:Battle,source:CombatUnit,
 inRange:(enemy:CombatUnit)=>boolean,
 eligible:(enemy:CombatUnit)=>boolean
):CombatUnit|null {
 const candidates=battle.units.filter(enemy=>enemy.playerId!==source.playerId&&eligible(enemy));
 if(!candidates.length){
  source.combatTargetId=undefined;
  source.basicTargetWasInRange=false;
  source.chaseOriginX=undefined;source.chaseOriginY=undefined;
  source.navLastDistance=undefined;source.obstacleRoute=undefined;
  return null;
 }
 const dist=(enemy:CombatUnit)=>Math.hypot(enemy.x-source.x,enemy.y-source.y);
 const clearLine=(enemy:CombatUnit)=>!firstObstacle(battle,source.playerId,source.x,source.y,enemy.x,enemy.y);
 const closest=(units:CombatUnit[])=>units.reduce((best,enemy)=>
   !best || dist(enemy)<dist(best)-1e-8 ||
   (Math.abs(dist(enemy)-dist(best))<1e-8 && stableId(enemy,best)<0)?enemy:best,
   null as CombatUnit|null);
 const hittable=candidates.filter(inRange);
 const visible=candidates.filter(clearLine);
 const defaultChoice=()=>closest(hittable)||closest(visible)||closest(candidates);
 let target=candidates.find(enemy=>enemy.id===source.combatTargetId)||null;
 if(!target){
  target=defaultChoice();
  source.basicTargetWasInRange=false;
  source.chaseOriginX=undefined;source.chaseOriginY=undefined;
 }
 if(!target)return null;
 // Avoid walking past an opponent that can already be hit.
 if(!inRange(target)&&hittable.length)target=closest(hittable)||target;
 if(!inRange(target)){
  if(source.basicTargetWasInRange){
   source.chaseOriginX=source.x;source.chaseOriginY=source.y;
  }else if(source.chaseOriginX!==undefined && source.chaseOriginY!==undefined &&
    Math.hypot(source.x-source.chaseOriginX,source.y-source.chaseOriginY)>=1.04){
   const next=defaultChoice();
   if(next)target=next;
   source.chaseOriginX=source.x;source.chaseOriginY=source.y;
  }
  // If pathing has made no progress, switch only to a demonstrably reachable
  // alternative. Never oscillate between two equally obstructed enemies.
  if((source.navBlockedFor||0)>=.85 && candidates.length>1){
   const alternative=closest(hittable.filter(other=>other!==target)) ||
     closest(visible.filter(other=>other!==target));
   if(alternative && (!clearLine(target) || dist(alternative)+.15<dist(target)))
     target=alternative;
  }
 }
 if(target.id!==source.combatTargetId){
  source.obstacleRoute=undefined;
  source.navBlockedFor=0;
  source.navLastDistance=undefined;
  source.chaseOriginX=undefined;source.chaseOriginY=undefined;
 }
 source.combatTargetId=target.id;
 source.basicTargetWasInRange=inRange(target);
 if(source.basicTargetWasInRange){
  source.chaseOriginX=undefined;source.chaseOriginY=undefined;
  source.navBlockedFor=0;source.navLastDistance=undefined;
 }
 return target;
}
