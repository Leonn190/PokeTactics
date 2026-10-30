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
   ? steppedRange(base.rangeClass,1) : base.range;
 return advanced+bonus;
}
export function basicInRange(unit:CombatUnit,enemy:CombatUnit,now:number):boolean {
 // World-space hex neighbours are roughly 1.04 units apart. The combatants
 // interpolate continuously, so axial/row thresholds would create unreachable
 // melee states between logical hex centers. Repositioning uses the same metric.
 const melee = !getStageData(unit.family,unit.stage).basic.projectile;
 const reach = effectiveBasicRange(unit,now);
 if (melee && reach <= .68) return distance(unit,enemy) <= 1.055;
 return distance(unit,enemy) <= reach + .075;
}
export function basicApproachDistance(unit:CombatUnit,enemy:CombatUnit,now:number):number {
 const melee = !getStageData(unit.family,unit.stage).basic.projectile;
 const reach = effectiveBasicRange(unit,now);
 return melee && reach <= .68 ? 1.04 : reach;
}

