import { calculateStats, getStageData } from '../../data';
import type { Battle,CombatUnit,Element,Stats,StatKey } from '../../types';
import { numeric, tierFor, param } from './registry';
import { randomIndex } from './positioning';
export function synergyTier(battle:Battle,unit:CombatUnit,type:Element){
 return getStageData(unit.family,unit.stage,unit.formId,unit.mewtwoMode).elements.includes(type)?tierFor(type,battle.traitsByPlayer[unit.playerId]?.[type]||0):null;
}
export function teamTier(battle:Battle,playerId:string,type:Element){
 return tierFor(type,battle.traitsByPlayer[playerId]?.[type]||0);
}
export function initializeSynergies(battle:Battle):void{
 const original=new Map<string,Stats>();
 for(const unit of battle.units){
   original.set(unit.id,{...unit.stats});
   unit.synergy={originalStats:{...unit.stats},ownStats:{...unit.stats},statsPercent:{},percents:{},speedBonus:0,revived:false,flags:{},timers:{},inherit:{hp:0,atk:0,def:0,spa:0,spd:0,speed:0}};
 }
 const shared=new Map<string,Partial<Stats>>();
 for(const playerId of battle.participants){
   const normal=tierFor('normal',battle.traitsByPlayer[playerId]?.normal||0);
   if(normal){
     const donors=battle.units.filter(u=>u.playerId===playerId&&synergyTier(battle,u,'normal'));
     for(const donor of donors){
       const base=original.get(donor.id)!;
       const key=(Object.keys(base) as StatKey[]).sort((a,b)=> (b==='hp'?base[b]/param('normal','hpCompareDivisor'):base[b])-(a==='hp'?base[a]/param('normal','hpCompareDivisor'):base[a]))[0];
       for(const receiver of donors)if(receiver!==donor){
         const values=shared.get(receiver.id)||{};
         values[key]=(values[key]||0)+base[key]*numeric(normal,'share');shared.set(receiver.id,values);
       }
     }
   }
 }
 for(const unit of battle.units){
   const s=unit.synergy!;
   for(const key of ['fire','steel','ghost','dark'] as Element[]){
     const tier=synergyTier(battle,unit,key);if(!tier)continue;
     if(key==='fire')s.percents.amplification=numeric(tier,'amplification');
     if(key==='steel')s.percents.durability=numeric(tier,'durability');
     if(key==='ghost')s.percents.vampirism=numeric(tier,'vampirism');
     if(key==='dark'){s.percents.critChance=numeric(tier,'critChance');s.percents.critDamage=numeric(tier,'critDamage');}
   }
   const mods:Partial<Stats>={};
   for(const [type,keys] of [['fighting',['atk','def']],['psychic',['spa','spd']],['rock',['def']],['grass',['hp']],['ice',['spd']]] as Array<[Element,StatKey[]]>) {
     const tier=synergyTier(battle,unit,type);
     if(tier)for(const key of keys)mods[key]=(mods[key]||0)+numeric(tier,key);
   }
   const fairy=synergyTier(battle,unit,'fairy');if(fairy)s.percents.healingShieldAmp=numeric(fairy,'healingShieldAmp');
   const fly=synergyTier(battle,unit,'flying');if(fly)mods.speed=(mods.speed||0)+numeric(fly,'speed');
   const bonus=shared.get(unit.id)||{};
   for(const key of Object.keys(unit.stats) as StatKey[]){
     const flat=Math.min(original.get(unit.id)![key]*param('normal','maxReceived'),bonus[key]||0);
     unit.stats[key]=Math.round(unit.stats[key]*(1+(mods[key]||0))+flat);
   }
   s.statsPercent=mods;
   if(synergyTier(battle,unit,'dragon'))s.flags.dragon=true;
   unit.maxHp=unit.hp=unit.stats.hp;
   const rock=synergyTier(battle,unit,'rock');
   if(rock){const hp=unit.maxHp*numeric(rock,'shield');unit.barriers.push({kind:'synergy',sourceId:unit.id,hp,until:Infinity});s.flags.rockStart=true;}
 }
 for(const player of battle.participants){
   const dr=tierFor('dragon',battle.traitsByPlayer[player]?.dragon||0);if(!dr)continue;
   const candidates=battle.units.filter(u=>u.playerId===player);
   const round=Number(/^r(\d+):/.exec(battle.id)?.[1] || battle.seed);
   const slot=randomIndex(round,28,player.split('').reduce((n,c)=>n+c.charCodeAt(0),0));
   // Persist chosen local tile, even if empty at the beginning of combat.
   (battle.sacredTiles ||= {})[player]={col:slot%7,row:Math.floor(slot/7)};
 }
 updateSacredTiles(battle);
}
export function updateSacredTiles(battle:Battle):void {
 for(const unit of battle.units){
   const tier=teamTier(battle,unit.playerId,'dragon'),tile=battle.sacredTiles?.[unit.playerId];
   const standing=!!(tier&&tile&&unit.col===tile.col&&(unit.row<=3?3-unit.row:unit.row-4)===tile.row&&Math.abs(unit.x-((tile.col-3)*1.04+(unit.row%2?.26:-.26)+(battle.participants.length>2?(battle.participants.indexOf(unit.playerId)<2?-4.35:4.35):0)))<.45);
   const already=unit.synergy?.sacredIv||0;
   const desired=standing?numeric(tier,'iv')+(synergyTier(battle,unit,'dragon')?numeric(tier,'dragonIv'):0):0;
   if(already===desired)continue;
   const prev={...unit.iv},next={...unit.iv};
   for(const k of Object.keys(unit.iv) as StatKey[]){prev[k]+=already;next[k]+=desired;}
   const before=calculateStats(unit.family,unit.level,prev,unit.stage,false,true,unit.formId),after=calculateStats(unit.family,unit.level,next,unit.stage,false,true,unit.formId);
   for(const key of Object.keys(unit.stats) as StatKey[])unit.stats[key]+=after[key]-before[key];
   unit.maxHp+=after.hp-before.hp;unit.hp=Math.min(unit.maxHp,unit.hp+Math.max(0,after.hp-before.hp));
   unit.synergy!.sacredIv=desired;
 }
}
