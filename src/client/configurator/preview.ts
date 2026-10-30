import pmdManifest from '../pmd-manifest.json';
import { visualProfile } from '../animation/visual-profiles';
import { markerAt, type PmdSheet } from '../animation/pmd-metadata';
import { gridXY, SPECIES } from '../../../server/data';
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
 private onVisibilityChange=():void=>{
  if(document.hidden){cancelAnimationFrame(this.frameId);this.frameId=0;}
  else if(this.options && !this.frameId)this.frameId=requestAnimationFrame(this.draw);
 };
 constructor(canvas:HTMLCanvasElement){this.canvas=canvas;this.ctx=canvas.getContext('2d')!;}
 show(options:PreviewOptions):void {
  if(!this.options)document.addEventListener('visibilitychange',this.onVisibilityChange);
  this.options=options;
  const idle=PMD[String(options.dex)]?.Idle;
  const sprite=SPECIES[options.family].sprites[Math.min(options.stage,SPECIES[options.family].sprites.length-1)];
  const path=idle?`${import.meta.env.BASE_URL}sprite/${String(options.dex).padStart(4,'0')}/${idle.file}`:
    /^https?:\/\//.test(sprite)?sprite:`${import.meta.env.BASE_URL}${sprite.replace(/^\.\//,'')}`;
  if(path!==this.path){
   this.path=path;this.image=new Image();
   const image=this.image;
   if(!idle && /^\.\/sprites\/\d+\.png$/.test(sprite)){
    const backup=`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${options.dex}.png`;
    image.addEventListener('error',()=>{if(image.src!==backup)image.src=backup;},{once:true});
   }
   this.image.src=path;
  }
  if(!this.frameId && !document.hidden)this.frameId=requestAnimationFrame(this.draw);
 }
 stop():void {cancelAnimationFrame(this.frameId);this.frameId=0;this.options=null;document.removeEventListener('visibilitychange',this.onVisibilityChange);}
 private draw=():void=>{
  if(!this.options){this.frameId=0;return;}
  const {family,stage,dex,size}=this.options;
  const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;
  const cx=w*.5,ground=h*.70;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#0d1c28';ctx.fillRect(0,0,w,h);
  // Render the actual board hex spacing at the same base scale as the client.
  const cellScale=75,origin=gridXY(3,4);
  for(let row=3;row<=5;row++)for(let col=1;col<=5;col++){
    const p=gridXY(col,row),x=cx+(p.x-origin.x)*cellScale,y=ground+(p.y-origin.y)*cellScale;
    ctx.fillStyle=(row+col)%2?'#28434a':'#223c48';ctx.strokeStyle='#6b9db257';ctx.lineWidth=1.5;
    ctx.beginPath();for(let i=0;i<6;i++){
      const a=Math.PI/3*i,xp=x+cellScale*.56*Math.cos(a),yp=y+cellScale*.56*Math.sin(a);
      if(!i)ctx.moveTo(xp,yp);else ctx.lineTo(xp,yp);
    }ctx.closePath();ctx.fill();ctx.stroke();
  }
  ctx.strokeStyle='#dfc27c';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(cx,ground,29,11,0,0,Math.PI*2);ctx.stroke();
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
    const scale=cellScale/48*1.13*size;
    const marker=markerAt(idle as PmdSheet,'shadow',0,index);
    const anchorX=marker?.ground?.[0]??idle.width/2;
    const anchorY=marker?.ground?.[1]??idle.height*.80;
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(this.image,index*idle.width,0,idle.width,idle.height,
      Math.round(cx-anchorX*scale),Math.round(ground-anchorY*scale),idle.width*scale,idle.height*scale);
   }else{
    const pix=cellScale*1.03*size;ctx.imageSmoothingEnabled=false;
    ctx.drawImage(this.image,cx-pix/2,ground-pix,pix,pix);
   }
  }
  ctx.font='12px system-ui';ctx.fillStyle='#b9d3d9';ctx.textAlign='center';
  ctx.fillText(`CORPO Ø ${(2*.295*size).toFixed(2)} CASAS`,cx,h-20);
  ctx.textAlign='left';ctx.font='11px system-ui';ctx.fillStyle='#b6c3cb';ctx.fillText('ARENA REAL · ZOOM 1×',23,24);
  this.frameId=requestAnimationFrame(this.draw);
 }
}
