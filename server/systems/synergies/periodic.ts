import type { Battle,CombatUnit } from '../../types';
import { numeric,param } from './registry';
import { synergyTier,teamTier } from './stats';
import { randomIndex } from './positioning';
import type { CombatHooks } from './combat-events';
/** All periodic rules advance on authoritative simulation time. No wall-clock timers. */
export function tickSynergies(battle:Battle,dt:number,hooks:CombatHooks):void {
 for(const unit of battle.units){
   const state=unit.synergy;
   if(!state||unit.hp<=0)continue;
   if(state.chilled&&state.chilled.until<=battle.elapsed)state.chilled=undefined;
   if(state.flight){
     const f=state.flight;f.elapsed+=dt;
     const t=Math.min(1,f.elapsed/f.duration),smooth=t*t*(3-2*t);
     unit.x=f.fromX+(f.toX-f.fromX)*smooth;unit.y=f.fromY+(f.toY-f.fromY)*smooth;
     unit.moving=false;unit.jumpHeight=Math.sin(t*Math.PI)*.75;
     if(t>=1){state.flight=undefined;unit.jumpHeight=0;state.speedBonus+=numeric(synergyTier(battle,unit,'flying'),'landingSpeed');}
   }
   const water=synergyTier(battle,unit,'water');
   if(water)unit.energy=Math.min(unit.energyNeeded,unit.energy+numeric(water,'energyPerSecond')*dt);
   const grass=synergyTier(battle,unit,'grass');
   if(grass&&unit.hp<unit.maxHp){
     state.timers.regen=(state.timers.regen||0)+dt;
     if(state.timers.regen>=.25){hooks.heal(battle,unit,unit.maxHp*numeric(grass,'regen')*state.timers.regen,unit);state.timers.regen=0;}
   }
   const poison=state.poisoned;
   if(poison&&poison.until>battle.elapsed){
     const tier=teamTier(battle,poison.playerId,'poison');
     const source=battle.units.find(u=>u.id===poison.sourceId);
     if(tier&&source&&source.playerId!==unit.playerId){hooks.deal(battle,source,unit,unit.maxHp*numeric(tier,'dot')*Math.min(dt,poison.until-(battle.elapsed-dt)),true,false,'poison','dot');}
   } else if(poison)state.poisoned=undefined;
 }
 const timers=battle.synergyTimers ||= {};
 for(const playerId of battle.participants){
   const electric=teamTier(battle,playerId,'electric');
   if(electric){
     const key=`electric:${playerId}`,interval=param('electric','interval');
     // Timers count time since first combat tick; setup and subsequent hits are snapshot deterministic.
     const clock=(timers[key]??0)+dt;timers[key]=clock;
     if(clock>=interval){
       timers[key]=clock%interval;
       const candidates=battle.units.filter(u=>u.playerId===playerId&&u.hp>0&&synergyTier(battle,u,'electric'));
       if(candidates.length){
         const tick=(timers[`electricSerial:${playerId}`]||0)+1;timers[`electricSerial:${playerId}`]=tick;
         const selected=candidates[randomIndex(battle.seed,candidates.length,tick+playerId.length*31)];
         const state=selected.synergy!;state.speedBonus=Math.min(numeric(electric,'maxSpeed'),state.speedBonus+numeric(electric,'speed'));
         hooks.effect(battle,selected,selected,'synergy-lightning',0);
         for(const enemy of battle.units)if(enemy.playerId!==playerId&&enemy.hp>0&&Math.hypot(enemy.x-selected.x,enemy.y-selected.y)<=param('electric','radius'))
           hooks.deal(battle,selected,enemy,numeric(electric,'damage')+hooks.stat(selected,'spa')*numeric(electric,'spaRatio'),true,true,'electric','extra');
       }
     }
   }
   const ground=teamTier(battle,playerId,'ground');
   if(ground){
     const key=`ground:${playerId}`;
     timers[key]=(timers[key]||0)+dt;
     const interval=param('ground','interval');
     if(timers[key]>=interval){timers[key]%=interval;timers[`wave:${playerId}`]=1;timers[`waveClock:${playerId}`]=0;}
     if((timers[`wave:${playerId}`]||0)>0){
       const wave=timers[`wave:${playerId}`];timers[`waveClock:${playerId}`]=(timers[`waveClock:${playerId}`]||0)+dt;
       if(wave===1||timers[`waveClock:${playerId}`]>=param('ground','waveSpacing')){
         if(wave>1)timers[`waveClock:${playerId}`]-=param('ground','waveSpacing');
         const caster=battle.units.find(u=>u.playerId===playerId&&u.hp>0&&synergyTier(battle,u,'ground'));
         if(caster){
           const damage=Array.isArray(ground.waves)?ground.waves[wave-1]:0;
           for(const enemy of battle.units)if(enemy.playerId!==playerId&&enemy.hp>0)hooks.deal(battle,caster,enemy,damage,false,false,'ground','extra');
           hooks.effect(battle,caster,caster,'earthquake',wave);
         }
         timers[`wave:${playerId}`]=wave+1;
         if(wave>=3){timers[`wave:${playerId}`]=0;
           for(const unit of battle.units)if(unit.playerId===playerId&&unit.hp>0&&synergyTier(battle,unit,'ground')){
             unit.synergy!.speedBonus=Math.min(param('ground','maxSpeed'),unit.synergy!.speedBonus+numeric(ground,'speed'));
             unit.synergy!.percents.durability=Math.min(param('ground','maxDurability'),(unit.synergy!.percents.durability||0)+numeric(ground,'durability'));
           }
         }
       }
     }
   }
 }
}
