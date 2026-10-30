/** V18.9: visual poses are independent of server movement, range and damage.
 * Profiles are per-stage AND per-action: no indiscriminate leap on every cast. */
import { ANIMATIONS } from '../../../server/data';
import type { CombatUnit, Family } from '../../../server/types';
export type ShadowProfile = { mode?: 'embedded' | 'none'; scale?:number; opacity?:number;
  aspect?:number; airborne?:boolean; offsetX?:number; offsetY?:number };
export type Launch = 'mouth' | 'hands' | 'wings' | 'body' | 'front' | 'back' | 'head' | 'core';
export type Pose = { lunge?:number; recoil?:number; hop?:number; pulse?:number; sway?:number };
export type VisualProfile = { launch?:Launch; shadow?:ShadowProfile; named?:Record<string,Pose>; actions?:{ basic?:Pose; charged?:Pose } };
const profiles = ANIMATIONS.visualProfiles as unknown as Record<string,VisualProfile | VisualProfile[]>;
const profileCache = new Map<string,VisualProfile>();
export function visualProfile(family: Family, stage: number): VisualProfile {
  const key=`${family}:${stage}`;
  const cached=profileCache.get(key);if(cached)return cached;
  const base=profiles.default as VisualProfile;
  const value=profiles[family];
  const specific=Array.isArray(value)?value[Math.max(0,Math.min(stage,value.length-1))]||{}:value||{};
  const result={...base,...specific,shadow:{...base.shadow,...specific.shadow},actions:{...base.actions,...specific.actions}};
  profileCache.set(key,result);return result;
}
const ease = (t:number) => t*t*(3-2*t);
export function cosmeticMotion(unit: Pick<CombatUnit,'family'|'stage'|'animation'|'facingX'|'facingY'|'leap'|'jumpHeight'>,
  cellScale:number, pmdbakedHop=false):{dx:number;dy:number;scale:number} {
  const anim=unit.animation;
  if(!anim || !anim.duration || anim.elapsed<0)return {dx:0,dy:0,scale:1};
  const profile=visualProfile(unit.family,unit.stage);
  const cfg=profile.named?.[anim.name] || profile.actions?.[anim.role==='basic'?'basic':'charged']||{};
  const t=Math.max(0,Math.min(1,anim.elapsed/anim.duration));
  const curve=Math.sin(Math.PI*ease(t));
  const face=Math.hypot(unit.facingX,unit.facingY)||1;
  const displacement=(cfg.lunge||0)-(cfg.recoil||0);
  const sideways=(cfg.sway||0)*Math.sin(2*Math.PI*t)*cellScale;
  const logicalAirborne=!!unit.leap || unit.jumpHeight>.05;
  // A PMD Hop already moves vertically in the original frames: never add a second jump.
  const hop=logicalAirborne || pmdbakedHop ? 0 : (cfg.hop||0)*Math.sin(Math.PI*t)**2;
  return {dx:unit.facingX/face*displacement*curve*cellScale-unit.facingY/face*sideways,
    dy:unit.facingY/face*displacement*curve*cellScale+unit.facingX/face*sideways-hop*cellScale,
    scale:1+(cfg.pulse||0)*curve};
}
