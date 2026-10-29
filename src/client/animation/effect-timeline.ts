import type { CombatEffect } from '../../../server/types';

/** Retains monotonic visual progress between irregularly spaced snapshots. */
export class EffectTimeline {
  private battleId = '';
  private times = new Map<string, number>();
  reset(): void { this.battleId = ''; this.times.clear(); }
  sync(battleId: string, effects: readonly CombatEffect[]): void {
    if (battleId !== this.battleId) { this.battleId = battleId; this.times.clear(); }
    const current = new Set(effects.map(effect => effect.id));
    for (const id of this.times.keys()) if (!current.has(id)) this.times.delete(id);
  }
  time(effect: CombatEffect, leadSeconds: number): number {
    const t = Math.min(effect.duration, Math.max(effect.time + leadSeconds, this.times.get(effect.id) || 0));
    this.times.set(effect.id, t);
    return t;
  }
}
