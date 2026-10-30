import type { ShadowProfile } from '../animation/visual-profiles';
/** Bounded, reusable contact shadows. PMD Shadow.png is MARKER DATA, never a texture. */
const textures=new Map<string,HTMLCanvasElement>();
function texture(radius:number,aspect:number):HTMLCanvasElement {
  const r=Math.max(6,Math.round(radius/3)*3), a=Math.round(Math.max(.19,Math.min(.65,aspect))*100);
  const key=`${r}:${a}`;
  const cached=textures.get(key);if(cached)return cached;
  const c=document.createElement('canvas'),rx=r*1.13,ry=Math.max(3,r*a/100);
  c.width=Math.ceil(rx*2+14);c.height=Math.ceil(ry*2+14);
  const ctx=c.getContext('2d')!;
  ctx.fillStyle='#071a0f82';ctx.filter='blur(3px)';ctx.beginPath();
  ctx.ellipse(c.width/2,c.height/2,rx,ry,0,0,2*Math.PI);ctx.fill();ctx.filter='none';
  if(textures.size>=144)textures.delete(textures.keys().next().value!);
  textures.set(key,c);return c;
}
export function drawContactShadow(ctx:CanvasRenderingContext2D,x:number,y:number,
  radius:number,profile:ShadowProfile={},height=0,pmdShadowSize?:number):void {
  if(profile.mode==='none'||profile.mode==='embedded')return;
  const h=Math.max(0,height),airborne=profile.airborne || h>.02;
  const size=Number.isFinite(pmdShadowSize)?[.73,.93,1.1,1.23][Math.max(0,Math.min(3,Math.round(pmdShadowSize!)))] : 1;
  const scale=(profile.scale??1)*size*(airborne?Math.max(.70,1-Math.min(.3,h*.14)):1);
  const alpha=Math.max(.14,1-Math.min(.65,h*.40))*(profile.opacity??1);
  const img=texture(radius*scale,profile.aspect??.29);
  ctx.save();ctx.globalAlpha*=alpha;
  ctx.drawImage(img,x+(profile.offsetX||0)-img.width/2,y+(profile.offsetY||0)+1-img.height/2);
  ctx.restore();
}
