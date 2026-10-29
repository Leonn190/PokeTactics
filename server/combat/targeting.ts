import type { Battle, CombatUnit } from '../types';
/** Deterministic target choice, shared by all abilities and basic-attack helpers. */
export const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const stableId = (a: CombatUnit, b: CombatUnit) => a.id.localeCompare(b.id);
export function closestTwo(battle: Battle, source: CombatUnit): CombatUnit[] {
  return battle.units.filter(u => u.hp > 0 && u.playerId === source.playerId && u.id !== source.id)
    .sort((a,b) => distance(source,a)-distance(source,b) || stableId(a,b)).slice(0, 2);
}

export function bestEnemyCluster(battle: Battle, source: CombatUnit, radius: number): CombatUnit | null {
  const targets = battle.units.filter(u => u.hp > 0 && u.playerId !== source.playerId);
  return targets.filter(u => distance(source,u) <= source.range + .08).sort((a,b) =>
    targets.filter(u => distance(u,b) <= radius).length - targets.filter(u => distance(u,a) <= radius).length
    || distance(source,a)-distance(source,b) || stableId(a,b))[0] || null;
}

export function bestEggCenter(battle: Battle, source: CombatUnit, radius: number, range: number): CombatUnit | null {
  const allies = battle.units.filter(u => u.hp > 0 && u.playerId === source.playerId);
  if (!allies.some(u => u.hp < u.maxHp)) return null;
  const membership = (center: CombatUnit) => allies.filter(u => distance(center,u) <= radius);
  return allies.filter(u => distance(source,u) <= range && membership(u).some(a => a.hp < a.maxHp)).sort((a,b) => {
    const aa = membership(a), bb = membership(b);
    return bb.length-aa.length || bb.filter(u=>u.hp<u.maxHp).length-aa.filter(u=>u.hp<u.maxHp).length
      || bb.reduce((s,u)=>s+u.maxHp-u.hp,0)-aa.reduce((s,u)=>s+u.maxHp-u.hp,0)
      || distance(source,a)-distance(source,b) || stableId(a,b);
  })[0] || null;
}
export function woundedAllies(battle: Battle, source: CombatUnit, range: number, count: number): CombatUnit[] {
  return battle.units.filter(u => u.playerId === source.playerId && u.hp > 0 && u.hp < u.maxHp && distance(u, source) <= range)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || distance(a, source) - distance(b, source)).slice(0, count);
}

