/** Shared authoritative regular-attack range and approach thresholds. */
import { getStageData, steppedRange } from '../data';
import type { CombatUnit } from '../types';
import { distance } from './targeting';

/** Authoritative regular-attack reach is measured in world/hex units, never
 * expanded by sprite size or visual collision radius. */
export function effectiveBasicRange(unit:CombatUnit,now:number):number {
 const base=getStageData(unit.family,unit.stage);
 const bonus=unit.range-base.range;
 const advanced=unit.family==='staryu' && unit.stage===1 && unit.refractionUntil>now
   ? steppedRange(base.rangeLevel,1) : base.range;
 return advanced+bonus;
}
export function basicInRange(unit:CombatUnit,enemy:CombatUnit,now:number):boolean {
 return distance(unit,enemy) <= effectiveBasicRange(unit,now)+.02;
}
export function basicApproachDistance(unit:CombatUnit,_enemy:CombatUnit,now:number):number {
 return effectiveBasicRange(unit,now);
}
