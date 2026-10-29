/** v16 ability visuals, consuming the same server-authored effect clock as damage. */
import type { CombatEffect } from '../../../server/types';
const TAU=Math.PI*2;
const V16_KINDS = new Set<CombatEffect['kind']>(['dragon-orb','dragon-tornado','dragon-wave','earth-trail','earth-burst','psychic-blessing','psychic-spark']);
type Point={x:number;y:number};
export function renderV16Effect(ctx:CanvasRenderingContext2D,fx:CombatEffect,from:Point,to:Point,t:number,scale:number,time:number):boolean {
  if (!V16_KINDS.has(fx.kind)) return false;
  ctx.save();
  if (fx.kind==='dragon-orb' || fx.kind==='psychic-blessing') {
    const flight=Math.min(1,t/.83);
    const x=from.x+(to.x-from.x)*flight,y=from.y+(to.y-from.y)*flight-Math.sin(flight*Math.PI)*scale*.25;
    const pink=fx.kind==='psychic-blessing';
    ctx.globalAlpha=flight<1?1:Math.max(0,(1-t)/.17);
    ctx.shadowColor=pink?'#ffabe2':'#a29bff';ctx.shadowBlur=15;
    ctx.fillStyle=pink?'#ffd8f2':'#aaa0ff';ctx.strokeStyle=pink?'#fff2ff':'#d7d6ff';ctx.lineWidth=1.8;
    ctx.beginPath();ctx.arc(x,y-scale*.13,scale*.115,0,TAU);ctx.fill();ctx.stroke();
    for(let i=0;i<5;i++) {
      const a=i*TAU/5+time*5;
      ctx.fillStyle=pink?'#f8abe8':'#6a64d3';ctx.beginPath();ctx.arc(x+Math.cos(a)*scale*.19,y-scale*.13+Math.sin(a)*scale*.12,2.1,0,TAU);ctx.fill();
    }
  } else if(fx.kind==='dragon-tornado' || fx.kind==='dragon-wave') {
    const radius=(fx.value||1.5)*scale;
    ctx.globalAlpha=(1-t)*.83;ctx.strokeStyle='#aaa4ff';ctx.fillStyle='#9b87ec';ctx.shadowColor='#8b81eb';ctx.shadowBlur=12;
    for(let i=0;i<3;i++) {
      const r=radius*(.4+.22*i+t*.12),h=scale*(.13+i*.19);
      ctx.lineWidth=(3-i)*1.3;ctx.beginPath();ctx.ellipse(to.x,to.y-h,r,r*.31,Math.sin(time*3+i)*.07,time*7+i,time*7+i+Math.PI*1.8);ctx.stroke();
    }
    for(let i=0;i<11;i++) {
      const a=i*2.39996+time*5;
      const r=radius*(.2+(i%7)*.11);
      ctx.beginPath();ctx.arc(to.x+Math.cos(a)*r,to.y-scale*.2+Math.sin(a)*r*.38-(i%4)*5,1.5+i%3,0,TAU);ctx.fill();
    }
  } else if(fx.kind==='earth-trail' || fx.kind==='earth-burst') {
    const burst=fx.kind==='earth-burst';
    const radius=(fx.value||.5)*scale*(burst?.65+t*.95:.15+t*.45);
    ctx.globalAlpha=(1-t)*.8;ctx.fillStyle='#bd8d58';ctx.strokeStyle='#765337';ctx.lineWidth=2;
    ctx.beginPath();ctx.ellipse(to.x,to.y-2,radius,radius*.28,0,0,TAU);ctx.stroke();
    for(let i=0;i<(burst?12:5);i++) {
      const a=i*2.39996,dist=radius*(.3+i%4*.2);
      ctx.fillStyle=i%2?'#d9b486':'#8d693e';ctx.beginPath();ctx.arc(to.x+Math.cos(a)*dist,to.y-4-Math.sin(a)*radius*.35-t*(burst?scale*.32:scale*.08),1.7+i%3,0,TAU);ctx.fill();
    }
  } else if(fx.kind==='psychic-spark') {
    ctx.globalAlpha=(1-t)*.85;ctx.fillStyle='#fac4f0';ctx.strokeStyle='#8bcfff';ctx.lineWidth=2;
    ctx.beginPath();ctx.ellipse(to.x,to.y-scale*.36,scale*(.23+t*.2),scale*(.33+t*.2),0,0,TAU);ctx.stroke();
    for(let i=0;i<7;i++) {
      const a=i*2.39996+time;
      ctx.beginPath();ctx.arc(to.x+Math.cos(a)*scale*(.15+t*.21),to.y-scale*.3+Math.sin(a)*scale*(.2+t*.2),2,0,TAU);ctx.fill();
    }
  }
  ctx.restore();return true;
}
