import type { Stats } from './types';

/** HP já é a quantidade real usada no combate. A divisão por cinco é só para poder. */
export function totalPower(stats: Stats): number {
  return stats.hp / 5 + stats.atk + stats.def + stats.spa + stats.spd + stats.speed;
}

export function attacksPerSecond(speed: number): number {
  return 0.3 + 3.2 * (1 - Math.pow(0.625, Math.max(0, speed) / 100));
}

export function attackCooldown(speed: number): number {
  return 1 / attacksPerSecond(speed);
}

export function mitigatedDamage(raw: number, defense: number): number {
  return Math.max(0, raw) * 100 / (100 + Math.max(0, defense));
}

/** Stage-aware scalar used both in combat resolution and ability previews. */
export function stageValue(values: readonly number[] | undefined, stage: number, fallback = 0): number {
  return values?.[Math.min(Math.max(0, stage), values.length - 1)] ?? fallback;
}

/** Pure raw basic-attack formula; type defenses are applied elsewhere. */
export function rawBasicDamage(offense: number, offensiveRatio: number): number {
  return offense * offensiveRatio;
}
