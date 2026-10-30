import { getStageData } from '../../data';
import type { Battle,CombatUnit,CombatEffect,Stats,StatKey } from '../../types';
import { numeric,param,arrayParam } from './registry';
import { synergyTier,teamTier } from './stats';
import { landingPositions,randomIndex } from './positioning';
export type DealFn=(battle:Battle,source:CombatUnit,target:CombatUnit,raw:number,magical:boolean,charged?:boolean,attackType?:import('../../types').Element,mode?:'normal'|'dot'|'reflect'|'extra')=>number;
export type HealFn=(battle:Battle,target:CombatUnit,value:number,source?:CombatUnit)=>number;
export type EffectFn=(battle:Battle,source:CombatUnit,target:{x:number;y:number},kind:CombatEffect['kind'],value:number)=>void;
export type CombatHooks={deal:DealFn;heal:HealFn;effect:EffectFn;stat:(unit:CombatUnit,key:StatKey)=>number};
export function onSynergyHit(battle:Battle,source:CombatUnit,target:CombatUnit,beforeHp:number,actualHpDamage:number,normalHit:boolean,hooks:CombatHooks):void {
 const {effect,heal}=hooks;
 if(actualHpDamage<=0)return;
 const states=target.synergy!;
 if(normalHit && source!==target){
   const poison=synergyTier(battle,source,'poison');
   if(poison){
     const till=battle.elapsed+param('poison','duration');
     const existing=states.poisoned;
     // Only one strongest owner, refresh without multiplying instances.
     if(!existing || existing.until<=battle.elapsed || numeric(poison,'dot')>=numeric(teamTier(battle,existing.playerId,'poison'),'dot'))
       states.poisoned={playerId:source.playerId,sourceId:source.id,until:till};
     else existing.until=till;
     const active=teamTier(battle,states.poisoned!.playerId,'poison');
     states.poisonHealReduction=numeric(active,'healReduction');
     states.poisonDurabilityReduction=numeric(active,'durabilityReduction');
     effect(battle,source,target,'poison',0);
   }
   const ice=synergyTier(battle,source,'ice');
   if(ice){
     states.chilled={durability:Math.max(states.chilled?.durability||0,numeric(ice,'durabilityReduction')),speed:Math.max(states.chilled?.speed||0,numeric(ice,'speedReduction')),until:battle.elapsed+param('ice','duration')};
     effect(battle,source,target,'frost',0);
   }
 }
 const rock=synergyTier(battle,target,'rock');
 if(rock&&target.hp>0){
   for(const threshold of arrayParam('rock','hpThresholds')){
     const key=threshold===.6?'rock60':'rock20';
     if(!states.flags[key]&&beforeHp>target.maxHp*threshold&&target.hp<=target.maxHp*threshold){
       states.flags[key]=true;
       const shield=target.maxHp*numeric(rock,'shield');
       target.barriers.push({kind:'synergy',sourceId:target.id,hp:shield,until:Infinity});
       effect(battle,target,target,'shield',shield);
     }
   }
 }
 const fairy=synergyTier(battle,target,'fairy');
 if(fairy&&!states.flags.fairy&&beforeHp>=target.maxHp*param('fairy','hpThreshold')&&target.hp<target.maxHp*param('fairy','hpThreshold')&&target.hp>0){
   states.flags.fairy=true;
   const friend=battle.units.filter(u=>u.playerId===target.playerId&&u.hp>0).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id.localeCompare(b.id))[0];
   if(friend){
     const shield=target.maxHp*numeric(fairy,'emergencyShield');
     friend.barriers.push({kind:'synergy',sourceId:target.id,hp:shield,until:Infinity});
     effect(battle,target,friend,'fairy-link',shield);
   }
 }
 const flyer=synergyTier(battle,target,'flying');
 if(flyer&&target.hp>0&&!states.flags.flew&&beforeHp>=target.maxHp*param('flying','hpThreshold')&&target.hp<target.maxHp*param('flying','hpThreshold')){
   states.flags.flew=true;
   const spaces=landingPositions(battle,target).filter(p=>Math.hypot(p.x-target.x,p.y-target.y)>.85);
   if(spaces.length){const chosen=spaces[randomIndex(battle.seed,spaces.length,target.hitSerial)];
     states.flight={fromX:target.x,fromY:target.y,toX:chosen.x,toY:chosen.y,elapsed:0,duration:param('flying','flightDuration')};
     effect(battle,target,chosen,'flight',0);
   }
 }
}
export function onSynergyDeath(battle:Battle,killer:CombatUnit,target:CombatUnit,hooks:CombatHooks):boolean {
 const state=target.synergy!,ghost=synergyTier(battle,target,'ghost');
 if(ghost&&!state.revived){
   const spaces=landingPositions(battle,target,true);
   if(spaces.length){
     state.revived=true;
     const chosen=spaces[0]; target.x=chosen.x;target.y=chosen.y;
     target.hp=target.maxHp*numeric(ghost,'reviveHp');target.energy=0;
     state.intangibleUntil=battle.elapsed+param('ghost','intangibility');
     target.poison=null;target.damageOverTime=null;state.poisoned=undefined;state.chilled=undefined;
     hooks.effect(battle,target,chosen,'ghost-revive',0);
     return true;
   }
 }
 // Only definitive deaths can distribute inheritance or grant poison-on-kill healing.
 if(!state.flags.dead){
   state.flags.dead=true;
   const bug=synergyTier(battle,target,'bug');
   if(bug){
     const receiver=battle.units.filter(u=>u!==target&&u.playerId===target.playerId&&u.hp>0&&synergyTier(battle,u,'bug'))
       .sort((a,b)=>Math.hypot(a.x-target.x,a.y-target.y)-Math.hypot(b.x-target.x,b.y-target.y)||a.id.localeCompare(b.id))[0];
     if(receiver){
       const source=state.ownStats||target.stats,recipient=receiver.synergy!;
       for(const key of Object.keys(source) as StatKey[]){
         const cap=recipient.originalStats![key]*param('bug','maxInherited');
         const gain=Math.max(0,Math.min(source[key]*numeric(bug,'inherit'),cap-recipient.inherit[key]));
         receiver.stats[key]+=gain;recipient.inherit[key]+=gain;
         if(key==='hp'){receiver.maxHp+=gain;receiver.hp+=gain;}
       }
       hooks.effect(battle,target,receiver,'swarm',0);
     }
   }
   const poison=state.poisoned;
   if(poison&&poison.until>battle.elapsed&&poison.playerId!==target.playerId){
     const tier=teamTier(battle,poison.playerId,'poison');
     if(tier)for(const ally of battle.units)if(ally.playerId===poison.playerId&&ally.hp>0&&synergyTier(battle,ally,'poison'))
       hooks.heal(battle,ally,ally.maxHp*numeric(tier,'deathHeal'),killer);
   }
 }
 return false;
}
/** Skill barriers are amplified once at the source, not on consumption. */
export function sourceShieldMultiplier(source:CombatUnit):number {
 const tier=source.synergy?.percents.healingShieldAmp||0;
 return 1+tier;
}
