/** Shared authoritative basic-attack reach and approach threshold. */
import { collisionRadius, getStageData, steppedRange } from '../data';
import type { CombatUnit } from '../types';
import { distance } from './targeting';

/** Equipment and temporary bonuses remain world-distance modifiers. */
export function effectiveBasicRange(unit:CombatUnit,now:number):number {
 const base=getStageData(unit.family,unit.stage,unit.formId,unit.mewtwoMode);
 const bonus=unit.range-base.range;
 const advanced=unit.family==='staryu' && unit.stage===1 && unit.refractionUntil>now
   ? steppedRange(base.rangeLevel,1) : base.range;
 return advanced+bonus;
}

/** A body cannot walk through another body just to satisfy melee reach.
 * Contact is measured from the two collision footprints, not sprite artwork.
 * The extra clearance is small: it must never restore the old 1.055 melee hit. */
export function basicApproachDistance(unit:CombatUnit,enemy:CombatUnit,now:number):number {
 const contact=collisionRadius(unit.family,unit.stage)+collisionRadius(enemy.family,enemy.stage)+.065;
 return Math.max(effectiveBasicRange(unit,now),contact);
}
export function basicInRange(unit:CombatUnit,enemy:CombatUnit,now:number):boolean {
 return distance(unit,enemy) <= basicApproachDistance(unit,enemy,now)+.02;
}
