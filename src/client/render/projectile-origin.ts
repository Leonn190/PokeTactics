import type { CombatEffect } from '../../../server/types';
import { visualProfile } from '../animation/visual-profiles';
type Point = {x:number;y:number};
/** World unit remains untouched; only the Canvas path begins at a body anchor. */
export function projectileOrigin(fx: CombatEffect, from: Point, to: Point, scale: number): Point {
  const shape = visualProfile(fx.family,fx.stage || 0).launch || 'front';
  const dx=to.x-from.x,dy=to.y-from.y,n=Math.hypot(dx,dy)||1;
  const x=dx/n,y=dy/n;
  const anchors = {mouth:[.24,-.57],hands:[.25,-.38],wings:[.32,-.52],body:[0,-.46],front:[.19,-.43]} as const;
  const [ahead,up] = anchors[shape];
  return {x:from.x+x*ahead*scale, y:from.y+up*scale+y*ahead*scale*.45};
}
