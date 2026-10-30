import type { CombatEffect } from '../../../server/types';
type Point={x:number;y:number};
const PI2=Math.PI*2;
/** Draws config-driven combat events from the simulation snapshot; no random allocation or browser timers. */
export function renderSynergyEffect(ctx:CanvasRenderingContext2D,fx:CombatEffect,from:Point,to:Point,t:number,scale:number,time:number):boolean{
 const kind=fx.kind;
 if(!['synergy-lightning','earthquake','frost','fairy-link','flight','swarm','ghost-revive','kick-impact','tail-sweep'].includes(kind))return false;
 ctx.save();
 const fade=Math.pow(1-t,1.5);
 if(kind==='synergy-lightning'){
   ctx.globalAlpha=fade;ctx.strokeStyle='#fff6ab';ctx.shadowColor='#ffe368';ctx.shadowBlur=18;ctx.lineWidth=4;
   ctx.beginPath();ctx.moveTo(to.x-12,to.y-120);ctx.lineTo(to.x+7,to.y-91);ctx.lineTo(to.x-6,to.y-56);ctx.lineTo(to.x+8,to.y-35);ctx.lineTo(to.x,to.y-7);ctx.stroke();
   ctx.beginPath();ctx.strokeStyle='#8cffff';ctx.arc(to.x,to.y-8,scale*.5*t,0,PI2);ctx.stroke();
 }else if(kind==='earthquake'){
   ctx.globalAlpha=fade*.8;ctx.strokeStyle='#dfb475';ctx.lineWidth=3;ctx.shadowColor='#d79546';ctx.shadowBlur=9;
   for(let ring=0;ring<3;ring++){ctx.beginPath();ctx.ellipse(from.x,from.y,(.65+t*3.4+ring*.5)*scale,(.25+t*.9+ring*.15)*scale,0,0,PI2);ctx.stroke();}
 }else if(kind==='frost'){
   ctx.translate(to.x,to.y-13);ctx.globalAlpha=fade;ctx.strokeStyle='#b9efff';ctx.shadowColor='#85e2ff';ctx.shadowBlur=7;
   for(let i=0;i<6;i++){const theta=i*PI2/6+time*.2;ctx.beginPath();ctx.moveTo(Math.cos(theta)*4,Math.sin(theta)*4);ctx.lineTo(Math.cos(theta)*(10+t*20),Math.sin(theta)*(10+t*20));ctx.stroke();}
 }else if(kind==='fairy-link'||kind==='swarm'||kind==='flight'){
   ctx.globalAlpha=fade;
   const color=kind==='fairy-link'?'#f8b8f2':kind==='swarm'?'#b4e36c':'#a5defe';
   ctx.strokeStyle=color;ctx.shadowColor=color;ctx.shadowBlur=16;ctx.lineWidth=3;
   ctx.beginPath();ctx.moveTo(from.x,from.y-16);ctx.quadraticCurveTo((from.x+to.x)/2,(from.y+to.y)/2-70,to.x,to.y-16);ctx.stroke();
   const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t-16-Math.sin(Math.PI*t)*28;
   ctx.fillStyle=color;
   for(let k=0;k<5;k++){const a=k*2.399+time*.6;ctx.beginPath();ctx.arc(x+Math.cos(a)*k*2,y+Math.sin(a)*k*2,2.2,0,PI2);ctx.fill();}
 }else if(kind==='ghost-revive'){
   ctx.globalAlpha=fade;ctx.strokeStyle='#ad85fc';ctx.shadowColor='#bb9aff';ctx.shadowBlur=20;ctx.lineWidth=3;
   ctx.beginPath();ctx.arc(to.x,to.y-18,(.2+t)*scale*.68,0,PI2);ctx.stroke();
 }else if(kind==='kick-impact'){
   ctx.globalAlpha=fade;ctx.strokeStyle='#ffdda0';ctx.shadowColor='#f1b75f';ctx.shadowBlur=17;ctx.lineWidth=5;
   ctx.beginPath();ctx.arc(to.x,to.y-18,(.2+t)*scale*.5,0,PI2);ctx.stroke();
 }else if(kind==='tail-sweep'){
   ctx.globalAlpha=fade;ctx.strokeStyle='#b4eafd';ctx.shadowColor='#79dbf9';ctx.shadowBlur=14;ctx.lineWidth=5;
   ctx.beginPath();ctx.arc(from.x,from.y-16,(fx.value||2)*scale*.63,-Math.PI*.75,Math.PI*.5);ctx.stroke();
 }
 ctx.restore();return true;
}
