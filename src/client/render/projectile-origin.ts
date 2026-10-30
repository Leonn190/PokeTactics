import type { CombatEffect } from '../../../server/types';
import { visualProfile, type Launch } from '../animation/visual-profiles';
type Point={x:number;y:number};
export type BodyPoints={body?:Point;head?:Point;leftHand?:Point;rightHand?:Point};
/** Origin is visual only. Use PMD body markers when present; otherwise a direction-aware profile. */
export function projectileOrigin(fx:CombatEffect,from:Point,to:Point,scale:number,points?:BodyPoints):Point {
  const shape:Launch=visualProfile(fx.family,fx.stage||0).launch||'front';
  const dx=to.x-from.x,dy=to.y-from.y,n=Math.hypot(dx,dy)||1;
  const ux=dx/n,uy=dy/n;
  if(points) {
    if(shape==='head'||shape==='mouth') {
      if(points.head)return {x:points.head.x+ux*scale*(shape==='mouth'?.065:0),y:points.head.y+uy*scale*.045};
    }
    if(shape==='hands') {
      const hands=[points.leftHand,points.rightHand].filter((p):p is Point=>!!p);
      if(hands.length)return hands.length===1?hands[0]:hands.sort((a,b)=>(b.x-a.x)*ux+(b.y-a.y)*uy)[0];
    }
    if(shape==='back'&&points.body)return {x:points.body.x-ux*scale*.10,y:points.body.y-scale*.17};
    if((shape==='body'||shape==='core')&&points.body)return points.body;
  }
  // Back/bulb and Staryu core are anatomical anchors, not the generic frontal muzzle.
  const offsets:Record<Launch,[number,number]>={mouth:[.22,-.60],hands:[.21,-.42],wings:[.26,-.58],
    body:[0,-.48],front:[.21,-.44],back:[-.09,-.68],head:[.10,-.70],core:[0,-.52]};
  const [ahead,up]=offsets[shape];
  return {x:from.x+ux*ahead*scale,y:from.y+up*scale+uy*ahead*scale*.35};
}
