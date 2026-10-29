/** V17: authoritative equipment recipes and combat modifiers. No DOM state or randomness. */
import settings from '../../config/itens.json';
import type { CombatUnit, EquippedItem, ItemColor, PercentStats, Stats } from '../types';

export const ITEMS = settings;
export const ITEM_COLORS = Object.keys(ITEMS.components) as ItemColor[];
export type Recipe = keyof typeof ITEMS.recipes;
export type ItemRecipe = { effect: string; description: string; [key: string]: number | string };
export const RECIPES = ITEMS.recipes as Record<string, ItemRecipe>;
export function recipeKey(a: ItemColor, b: ItemColor): string {
  const i = ITEM_COLORS.indexOf(a), j = ITEM_COLORS.indexOf(b);
  if (i < 0 || j < 0) throw Error('Componente inválido');
  return i <= j ? `${a}+${b}` : `${b}+${a}`;
}
export function makeComponent(id: string, color: ItemColor): EquippedItem {
  if (!ITEM_COLORS.includes(color)) throw Error('Componente inválido');
  return { id, components:[color], kind:'component' };
}
export function craft(id: string, a: EquippedItem, b: EquippedItem): EquippedItem | null {
  if (a.kind !== 'component' || b.kind !== 'component') return null;
  const key = recipeKey(a.components[0],b.components[0]);
  return RECIPES[key] ? { id, kind:'complete', components:key.split('+') as ItemColor[], recipe:key } : null;
}
export function effectCount(unit: Pick<CombatUnit,'equipment'>, effect: string): number {
  return (unit.equipment || []).filter(item => item.kind === 'complete' && RECIPES[item.recipe || '']?.effect === effect).length;
}
export function effectData(effect: string): ItemRecipe | null {
  return Object.values(RECIPES).find(recipe => recipe.effect === effect) || null;
}
export function numberParam(effect: string, param: string, fallback = 0): number {
  const value = effectData(effect)?.[param]; return typeof value === 'number' ? value : fallback;
}
export function bonusStats(stats: Stats, equipment: EquippedItem[] = []): Stats {
  const copy = { ...stats };
  for (const item of equipment) for (const color of item.components) {
    const part = ITEMS.components[color] as { stat: keyof Stats; value: number };
    copy[part.stat] += part.value;
  }
  if (equipment.some(item => RECIPES[item.recipe || '']?.effect === 'regeneration')) copy.hp *= 1 + numberParam('regeneration','hpPercent');
  if (equipment.some(item => RECIPES[item.recipe || '']?.effect === 'archmage')) copy.spa *= 1 + numberParam('archmage','spaPercent');
  if (equipment.some(item => RECIPES[item.recipe || '']?.effect === 'executioner')) copy.atk *= 1 + numberParam('executioner','atkPercent');
  if (equipment.some(item => RECIPES[item.recipe || '']?.effect === 'longbow')) copy.speed *= 1 + numberParam('longbow','speedPercent');
  return Object.fromEntries(Object.entries(copy).map(([key,value])=>[key,Math.round(value)])) as Stats;
}
export function effectivePercents(unit?: Pick<CombatUnit,'equipment'|'itemStacks'|'itemTimers'>, elapsed=0): PercentStats {
  const result: PercentStats = { ...ITEMS.defaults };
  if (!unit) return result;
  const has = (effect: string) => (unit.equipment || []).some(item => RECIPES[item.recipe || '']?.effect === effect);
  if (has('vampirism')) result.vampirism += numberParam('vampirism','vampirism');
  if (has('spell_critical')) {
    result.critChance += numberParam('spell_critical','critChance');
    result.critDamage += numberParam('spell_critical','critDamage');
  }
  if (has('opening_immunity') && elapsed < ITEMS.combatIntroSeconds + numberParam('opening_immunity','duration')) result.amplification += numberParam('opening_immunity','amplification');
  if (has('titan')) {
    const stacks = unit.itemStacks?.titan || 0;
    result.amplification += stacks * numberParam('titan','ampPerStack');
    result.durability += stacks * numberParam('titan','durPerStack');
  }
  result.vampirism = Math.min(ITEMS.limits.vampirism,Math.max(0,result.vampirism));
  result.critChance = Math.min(ITEMS.limits.critChance,Math.max(0,result.critChance));
  result.durability = Math.min(ITEMS.limits.durability,Math.max(0,result.durability));
  result.amplification = Math.min(ITEMS.limits.amplification,Math.max(0,result.amplification));
  return result;
}
export function bumpStack(unit: CombatUnit, effect: string, value=1): void {
  if (!effectCount(unit,effect)) return;
  const maximum = numberParam(effect,'maxStacks',0) || numberParam(effect,'max',0) / Math.max(.001,numberParam(effect,'step',1));
  unit.itemStacks[effect] = Math.min(maximum, (unit.itemStacks[effect] || 0) + value);
}
export function bonusStat(unit: CombatUnit, key: keyof Stats, now: number, focus: number): number {
  if (key === 'speed') return unit.stats.speed * ((unit.itemStacks.guinsoo || 0) * numberParam('guinsoo','step')
    + (unit.itemTimers.cast_haste > now ? numberParam('cast_haste','speedPercent') : 0));
  if (key === 'spa') return unit.stats.spa * Math.min(numberParam('scaling_spa','max'), (unit.itemStacks.scaling_spa || 0) * numberParam('scaling_spa','step'));
  if (key === 'def' || key === 'spd') return focus * numberParam('focused_defense','perTarget');
  return 0;
}
export function healingMultiplier(unit: CombatUnit): number {
  return (1 + effectCount(unit,'adaptive_shield') * numberParam('adaptive_shield','receivedHealShield'))
    * (unit.itemTimers.burning > unit.itemNow ? 1 - numberParam('burn_aura','healReduction') : 1);
}
export function shieldMultiplier(unit: CombatUnit): number {
  return 1 + effectCount(unit,'adaptive_shield') * numberParam('adaptive_shield','receivedHealShield');
}
export function itemTooltip(item: EquippedItem): string {
  const parts = item.components.map(c => ITEMS.components[c]).map(c=>`+${c.value} ${c.stat.toUpperCase()}`).join(', ');
  return parts + (item.recipe ? ` • ${RECIPES[item.recipe]?.description || ''}` : ' • Componente básico');
}
