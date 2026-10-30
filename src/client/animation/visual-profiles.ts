/** Pure, deterministic visual poses. No hitbox/pathfinding/position mutations. */
import { ANIMATIONS } from '../../../server/data';
import type { CombatUnit, Family } from '../../../server/types';
export type ShadowProfile = { mode?: 'earth'; scale?: number; opacity?: number; offsetX?: number; offsetY?: number };
export type VisualProfile = { lunge?: number; recoil?: number; hop?: number; pulse?: number;
  launch?: 'mouth' | 'hands' | 'wings' | 'body' | 'front'; shadow?: ShadowProfile };
const profiles = ANIMATIONS.visualProfiles as unknown as Record<string, VisualProfile | VisualProfile[]>;
export function visualProfile(family: Family, stage: number): VisualProfile {
  const base = profiles.default as VisualProfile;
  const value = profiles[family];
  const specific = Array.isArray(value) ? (value[Math.min(stage,value.length - 1)] || {}) : value || {};
  return { ...base, ...specific, shadow: { ...base.shadow, ...specific.shadow } };
}
const ease = (v: number) => v * v * (3 - 2 * v);
export function cosmeticMotion(unit: Pick<CombatUnit, 'family'|'stage'|'animation'|'facingX'|'facingY'|'leap'|'jumpHeight'>, cellScale: number): { dx: number; dy: number; scale: number } {
  const anim = unit.animation;
  if (!anim || !anim.duration || anim.elapsed < 0) return { dx: 0, dy: 0, scale: 1 };
  const cfg = visualProfile(unit.family, unit.stage);
  const t = Math.min(1, anim.elapsed / anim.duration);
  // Fixed duration bell gives an in-and-out impulse; charged cast can feel heavier.
  const curve = Math.sin(Math.PI * ease(t));
  const size = Math.hypot(unit.facingX,unit.facingY) || 1;
  const towards = anim.role === 'basic' ? cfg.lunge || 0 : cfg.lunge || 0;
  const impulse = (towards * (anim.role === 'basic' ? .8 : 1.15) - (cfg.recoil || 0) * (anim.role === 'basic' ? 1 : .8)) * curve;
  const hop = unit.leap || unit.jumpHeight > .05 ? 0 : (cfg.hop || 0) * Math.max(0,Math.sin(t * Math.PI));
  return { dx: unit.facingX / size * impulse * cellScale,
    dy: unit.facingY / size * impulse * cellScale - hop * cellScale,
    scale: 1 + (cfg.pulse || 0) * curve };
}
