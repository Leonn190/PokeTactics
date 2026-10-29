import type { Battle, CombatUnit } from '../types';
import { effect } from './effects';
import { healingMultiplier } from '../systems/items';
/** Every real HP recovery passes through this function, including drain/area/support. */
export function heal(battle: Battle, unit: CombatUnit, amount: number, caster: CombatUnit = unit): number {
  // Only actual recovered health produces a visual event: never display overhealing.
  const gain = Math.max(0, Math.min(unit.maxHp - unit.hp, amount * healingMultiplier(unit)));
  if (gain <= 0 || unit.hp <= 0) return 0;
  unit.hp += gain;
  caster.metrics.healed += gain;
  effect(battle, caster, unit, 'heal', gain);
  return gain;
}

