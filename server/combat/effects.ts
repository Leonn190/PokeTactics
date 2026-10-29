import { ANIMATIONS } from '../data';
import type { Battle, CombatEffect, CombatUnit } from '../types';
/** Canonical effect emission and deduplicated floating damage indicators. */
export function effect(battle: Battle, source: CombatUnit, target: { x: number; y: number }, kind: CombatEffect['kind'], value: number): void {
  battle.effects.push({
    id: `${battle.id}:${battle.elapsed}:${battle.effects.length}`,
    x: source.x, y: source.y, targetX: target.x, targetY: target.y,
    family: source.family, kind, value: kind === 'pollen' || kind === 'water' ? value : Math.round(value), time: 0,
    duration: kind === 'ko' ? .9 : kind === 'basic-projectile' ? ANIMATIONS.basic.projectileDuration : kind === 'pollen' || kind === 'lightning' ? .52 : kind === 'water' ? .3 : .6
  });
}

export function floatingDamage(battle: Battle, target: CombatUnit, amount: number, damageType: 'physical' | 'special' | 'true'): void {
  // Pequenos ticks de veneno se somam em uma só etiqueta por alvo.
  const recent = [...battle.effects].reverse().find(fx => fx.kind === 'damage' && fx.targetId === target.id && fx.damageType === damageType && fx.time < .12);
  if (recent) { recent.value += amount; return; }
  battle.effects.push({ id: `${battle.id}:hit:${battle.elapsed}:${battle.effects.length}`, targetId: target.id,
    x: target.x, y: target.y, targetX: target.x, targetY: target.y,
    kind: 'damage', damageType, family: target.family, value: amount, time: 0, duration: .85 });
}

