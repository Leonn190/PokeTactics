import { ATTACKS, getStageData, collisionRadius } from '../data';
import type { Battle, CombatUnit, Element, StatKey } from '../types';
import { effect } from './effects';

// Owns continuous contact detection for Growlithe/Arcanine. Damage and effective
// SpA are injected from the authoritative battle engine to keep a single source
// of truth for mitigation, RNG, item triggers and combat event ordering.
/** Swept flame collision with independent charges and one entry per contact. */
export function tickFlameOrbits(
 battle:Battle,dt:number,
 deal:(battle:Battle,source:CombatUnit,target:CombatUnit,raw:number,magical:boolean,charged?:boolean,attackType?:Element)=>number,
 stat:(unit:CombatUnit,key:StatKey)=>number,
 isTargetable:(unit:CombatUnit)=>boolean,
 segmentDistanceSq:(ax:number,ay:number,bx:number,by:number,px:number,py:number)=>number
):void {
 for(const source of battle.units){
  if(!source.orbitFlames?.length)continue;
  if(source.hp<=0){source.orbitFlames=[];continue;}
  const move=ATTACKS.moves[getStageData(source.family,source.stage).move];
  if(move.effect!=='flame-orbit'){source.orbitFlames=[];continue;}
  const speed=move.rotationSpeed??3.5,r=(move.orbitRadius??.7)* (1+(collisionRadius(source.family,source.stage)-.295)*.45);
  const ballRadius=move.orbRadius??.14;
  const duration=move.maxDuration??0;
  // Candidate teams and physical radii do not change within one update.
  const targets=battle.units.filter(target=>target.playerId!==source.playerId);
  const areas=targets.map(target=>(ballRadius+collisionRadius(target.family,target.stage))**2);
  const steps=Math.min(28,Math.max(1,Math.ceil(Math.abs(speed*dt)/.19)));
  const remaining:typeof source.orbitFlames=[];
  for(const orb of source.orbitFlames){
   if(duration>0 && battle.elapsed-orb.bornAt>=duration)continue;
   let touched=new Set(orb.contacts);
   let touching=new Set<string>();
   for(let step=0;step<steps&&orb.impactsLeft>0;step++){
    const previous=orb.angle;
    orb.angle+=speed*dt/steps;
    const ax=source.x+Math.cos(previous)*r,ay=source.y+Math.sin(previous)*r;
    const bx=source.x+Math.cos(orb.angle)*r,by=source.y+Math.sin(orb.angle)*r;
    touching.clear();
    for(let index=0;index<targets.length;index++){
     const target=targets[index];
     if(!isTargetable(target))continue;
     const intersects=segmentDistanceSq(ax,ay,bx,by,target.x,target.y)<=areas[index];
     if(!intersects)continue;
     touching.add(target.id);
     if(touched.has(target.id) || battle.elapsed-(orb.lastHit[target.id]??-999) < (move.reimpactSeconds??.45))continue;
     deal(battle,source,target,move.baseDamage+stat(source,'spa')*move.specialRatio,true,true,'fire');
     effect(battle,source,target,'flame',0);
     orb.impactsLeft--;orb.lastHit[target.id]=battle.elapsed;
     if(orb.impactsLeft<=0)break;
    }
    const old=touched;touched=touching;touching=old;
   }
   orb.contacts=[...touched];
   if(orb.impactsLeft>0)remaining.push(orb);
   else effect(battle,source,source,'flame',0);
  }
  source.orbitFlames=remaining;
 }
}
