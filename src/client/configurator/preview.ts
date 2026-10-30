import pmdManifest from '../pmd-manifest.json';
import { visualProfile } from '../animation/visual-profiles';
import type { Family } from '../../../server/types';
const PMD=pmdManifest as Record<string,Record<string,{file:string;width:number;height:number;durations:number[];directions:number}>>;
export interface PreviewOptions {family:Family;stage:number;dex:number;size:number; name:string;}
export class PhysicalPreview {
 private canvas:HTMLCanvasElement;
 private ctx:CanvasRenderingContext2D;
 private frameId=0;
 private began=performance.now();
 private image=new Image();
 private path='';
 private options:PreviewOptions|null=null;
 private backgroundGradient:CanvasGradient|null=null;
 private backgroundSize='';
 private onVisibilityChange=():void=>{
  if(document.hidden){cancelAnimationFrame(this.frameId);this.frameId=0;}
  else if(this.options && !this.frameId)this.frameId=requestAnimationFrame(this.draw);
 };
 constructor(canvas:HTMLCanvasElement){this.canvas=canvas;this.ctx=canvas.getContext('2d')!;}
 show(options:PreviewOptions):void {
  if(!this.options)document.addEventListener('visibilitychange',this.onVisibilityChange);
  this.options=options;
  const idle=PMD[String(options.dex)]?.Idle;
  const path=idle?`${import.meta.env.BASE_URL}sprite/${String(options.dex).padStart(4,'0')}/${idle.file}`:
    `${import.meta.env.BASE_URL}portrait/${String(options.dex).padStart(4,'0')}/Normal.png`;
  if(path!==this.path){this.path=path;this.image=new Image();this.image.src=path;}
  if(!this.frameId && !document.hidden)this.frameId=requestAnimationFrame(this.draw);
 }
 stop():void {cancelAnimationFrame(this.frameId);this.frameId=0;this.options=null;document.removeEventListener('visibilitychange',this.onVisibilityChange);}
 private draw=():void=>{
  if(!this.options){this.frameId=0;return;}
  const {family,stage,dex,size}=this.options;
  const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;
  const cx=w*.5,ground=h*.70;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#0d1c28';ctx.fillRect(0,0,w,h);
  const sizeKey=w+'x'+h;
  if(!this.backgroundGradient || this.backgroundSize!==sizeKey){
   const gradient=ctx.createRadialGradient(cx,ground,18,cx,ground,w*.47);
   gradient.addColorStop(0,'#38524f');gradient.addColorStop(1,'#152633');
   this.backgroundGradient=gradient;this.backgroundSize=sizeKey;
  }
  ctx.fillStyle=this.backgroundGradient;
  ctx.beginPath();ctx.ellipse(cx,ground,135,55,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#ffffff25';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(cx-61,ground-41);ctx.lineTo(cx+61,ground-41);ctx.lineTo(cx+85,ground+37);ctx.lineTo(cx-85,ground+37);ctx.closePath();ctx.stroke();
  const bodyRadius=75*.295*size;
  ctx.strokeStyle='#ecbd6288';ctx.setLineDash([5,4]);ctx.beginPath();ctx.ellipse(cx,ground,bodyRadius,bodyRadius*.53,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  const shadow=visualProfile(family,stage).shadow;
  if(shadow?.mode!=='none' && shadow?.mode!=='embedded'){
   ctx.fillStyle='#02070a75';ctx.filter='blur(5px)';ctx.beginPath();
   ctx.ellipse(cx,ground,bodyRadius*.95*(shadow?.scale??1),bodyRadius*.30,0,0,Math.PI*2);ctx.fill();ctx.filter='none';
  }
  const idle=PMD[String(dex)]?.Idle;
  if(this.image.complete && this.image.naturalWidth){
   if(idle){
    const duration=idle.durations.reduce((a,b)=>a+b,0),tick=(performance.now()-this.began)*.06%duration;
    let remain=tick,index=0;
    while(index<idle.durations.length-1 && remain>=idle.durations[index])remain-=idle.durations[index++];
    const scale=75/48*1.13*size;
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(this.image,index*idle.width,0,idle.width,idle.height,
      cx-idle.width*scale/2,ground-idle.height*scale*.80,idle.width*scale,idle.height*scale);
   }else{
    const pix=90*size;ctx.imageSmoothingEnabled=false;
    ctx.drawImage(this.image,cx-pix/2,ground-pix*.87,pix,pix);
   }
  }
  ctx.font='12px system-ui';ctx.fillStyle='#b9d3d9';ctx.textAlign='center';
  ctx.fillText(`CORPO Ø ${(2*.295*size).toFixed(2)} CASAS`,cx,h-20);
  ctx.textAlign='left';ctx.font='11px system-ui';ctx.fillStyle='#b6c3cb';ctx.fillText('▱ 1 CASA',23,24);
  this.frameId=requestAnimationFrame(this.draw);
 }
}
