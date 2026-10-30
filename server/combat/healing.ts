import type { Battle, CombatUnit } from '../types';
import { effect } from './effects';
import { healingMultiplier } from '../systems/items';
import { active, STATUS_RULES } from './statuses';
/** Every real HP recovery passes through this function, including drain/area/support. */
export function heal(battle: Battle, unit: CombatUnit, amount: number, caster: CombatUnit = unit): number {
  // Only actual recovered health produces a visual event: never display overhealing.
  const poison=unit.synergy?.poisoned;
  const antiHeal=poison&&poison.until>battle.elapsed ? (unit.synergy?.poisonHealReduction||0) : 0;
  const sourceAmp=1+(caster.synergy?.percents.healingShieldAmp||0);
  const gain = Math.max(0, Math.min(unit.maxHp - unit.hp, amount * sourceAmp * (1-antiHeal) * (active(unit,'burning',battle.elapsed)?1-STATUS_RULES.burning.healingReduction:1) * healingMultiplier(unit)));
  if (gain <= 0 || unit.hp <= 0) return 0;
  unit.hp += gain;
  caster.metrics.healed += gain;
  effect(battle, caster, unit, 'heal', gain);
  return gain;
}

