/** Lightweight procedural soil: no independent animation loop, one draw per buried unit. */
const TAU=Math.PI*2;
export function drawBurrowMound(ctx:CanvasRenderingContext2D,x:number,y:number,r:number,stage:number,time:number):void {
  const w=r*(stage?1.32:1.05);
  ctx.save();
  ctx.fillStyle='#523a27aa';ctx.beginPath();ctx.ellipse(x,y+2,w*1.3,w*.48,0,0,TAU);ctx.fill();
  ctx.fillStyle='#a57846';ctx.strokeStyle='#d5ac77';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.ellipse(x,y-2,w,w*.48,0,Math.PI,TAU);ctx.lineTo(x+w,y+1);ctx.ellipse(x,y+1,w,w*.29,0,0,Math.PI);ctx.closePath();ctx.fill();ctx.stroke();
  for(let i=0;i<(stage?7:5);i++) {
    const phase=i*2.39996+time*.9;
    const px=x+Math.cos(phase)*w*(.55+i*.06),py=y+Math.sin(phase)*w*.38;
    ctx.fillStyle=i%2?'#c5a173':'#705138';ctx.beginPath();ctx.arc(px,py,(i%3)+1.3,0,TAU);ctx.fill();
  }
  ctx.restore();
}
