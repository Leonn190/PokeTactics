/** VFX for charged moves. Basic projectile visuals are shared across species by elemental type. */
import { SPECIES } from '../../../server/data';
import type { CombatEffect } from '../../../server/types';
import { renderTravelEffects } from '../vfx/travel-effects';
import { projectileOrigin, type BodyPoints } from './projectile-origin';
import { renderImpactEffects } from '../vfx/impact-effects';
import { renderFloatingNumber } from '../vfx/floating-numbers';
import { renderV16Effect } from '../vfx/v16-effects';
import { renderSynergyEffect } from './synergy-effects';
const PI2 = Math.PI * 2;

export function renderCombatEffects(context: CanvasRenderingContext2D, effects: CombatEffect[], flipY: boolean, toScreen: (x:number,y:number)=>{x:number;y:number}, cellScale: number, time: number, resolveTime?: (effect: CombatEffect) => number, parts?: (effect: CombatEffect) => BodyPoints | undefined): void {
    const ctx = context;
    for (const fx of effects) {
      const t = Math.max(0, Math.min(1, (resolveTime ? resolveTime(fx) : fx.time) / fx.duration));
      const baseFrom = toScreen(fx.x, flipY ? -fx.y : fx.y);
      const to = toScreen(fx.targetX, flipY ? -fx.targetY : fx.targetY);
      const from = ['basic-projectile','dragon-orb','bone','egg','ball','psychic-blessing','piercing-flame','lightning','poison','spell','electro-shot']
        .includes(fx.kind) ? projectileOrigin(fx,baseFrom,to,cellScale,parts?.(fx)) : baseFrom;
      // Real magnetized shots bend into an absorber; the server, not this drawing, cancels their hits.
      if(fx.magnetPull){
        const pull=fx.magnetPull;
        const start=toScreen(pull.fromX,flipY?-pull.fromY:pull.fromY);
        const end=toScreen(pull.toX,flipY?-pull.toY:pull.toY);
        const k=Math.min(1,Math.max(0,(fx.time-pull.startTime)/pull.duration));
        const ux=end.x-start.x,uy=end.y-start.y,normal=Math.hypot(ux,uy)||1;
        const curve=cellScale*.18*Math.sin(k*Math.PI);
        const x=start.x+ux*k-uy/normal*curve,y=start.y+uy*k+ux/normal*curve-cellScale*.22;
        ctx.save();ctx.shadowColor='#7adfff';ctx.shadowBlur=11;ctx.fillStyle='#c2f4ff';ctx.strokeStyle='#62c8fc';
        ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(start.x,start.y-cellScale*.22);
        ctx.quadraticCurveTo(start.x+ux*.6-uy/normal*cellScale*.3,start.y+uy*.6+ux/normal*cellScale*.3-cellScale*.22,x,y);ctx.stroke();
        ctx.beginPath();ctx.arc(x,y,Math.max(3,cellScale*.08),0,PI2);ctx.fill();ctx.restore();continue;
      }
      if(fx.kind==='flame-jet' || fx.kind==='electric-punch'){
        ctx.save();
        if(fx.kind==='flame-jet'){
          const angle=Math.atan2(to.y-from.y,to.x-from.x),length=Math.hypot(to.x-from.x,to.y-from.y);
          const spread=(fx.value||42)*Math.PI/360;
          ctx.globalAlpha=(1-t)*.65;
          const gradient=ctx.createRadialGradient(from.x,from.y,cellScale*.13,from.x,from.y,length);
          gradient.addColorStop(0,'#fff0a7b5');gradient.addColorStop(.45,'#ff9b3b8c');gradient.addColorStop(1,'#ee402400');
          ctx.fillStyle=gradient;ctx.shadowBlur=18;ctx.shadowColor='#ff642b';
          ctx.beginPath();ctx.moveTo(from.x,from.y-cellScale*.3);
          ctx.arc(from.x,from.y-cellScale*.3,length,angle-spread,angle+spread);
          ctx.closePath();ctx.fill();
          for(let i=0;i<7;i++){
            const a=angle+(i-3)*spread/4,dist=length*(.25+((i*13+time*1.9)%7)/10);
            ctx.fillStyle=i%2?'#ffcc63':'#ff5e30';ctx.beginPath();
            ctx.arc(from.x+Math.cos(a)*dist,from.y-cellScale*.3+Math.sin(a)*dist,Math.max(2,cellScale*(.04+(1-t)*.035)),0,PI2);ctx.fill();
          }
        }else{
          ctx.globalAlpha=(1-t)*.92;ctx.strokeStyle='#fff4a3';ctx.fillStyle='#edc7294b';
          ctx.shadowColor='#e7d742';ctx.shadowBlur=20;ctx.lineWidth=4;
          for(let i=0;i<6;i++){
            const a=i*PI2/6+time*3.5,R=cellScale*(.12+.42*t);
            ctx.beginPath();ctx.moveTo(to.x,to.y-cellScale*.3);
            ctx.lineTo(to.x+Math.cos(a)*R*.65,to.y-cellScale*.3+Math.sin(a)*R*.65);
            ctx.lineTo(to.x+Math.cos(a+.28)*R,to.y-cellScale*.3+Math.sin(a+.28)*R);ctx.stroke();
          }
          ctx.beginPath();ctx.arc(to.x,to.y-cellScale*.3,cellScale*(.09+.35*t),0,PI2);ctx.fill();
        }
        ctx.restore();continue;
      }
      if(fx.kind==='electro-shot'||fx.kind==='electro-field'||fx.kind==='electro-pulse'||fx.kind==='electro-absorb'||fx.kind==='claw-strip'){
        ctx.save();
        if(fx.kind==='claw-strip'&&fx.claw){
          const hit=fx.claw.hitAt;
          const a=Math.atan2(to.y-from.y,to.x-from.x);
          const length=fx.claw.length*cellScale,width=fx.claw.width*cellScale;
          const phase=Math.min(1,fx.time/Math.max(.05,hit));
          ctx.translate(from.x,from.y-cellScale*.24);ctx.rotate(a);
          ctx.globalAlpha=fx.time>hit?Math.max(0,1-(fx.time-hit)/.23):.75;
          ctx.lineWidth=Math.max(2,cellScale*.043);ctx.lineCap='round';ctx.strokeStyle='#ffedc5';
          ctx.shadowColor='#ffd394';ctx.shadowBlur=12;
          for(const n of [-1,0,1]){
            const y=n*width*.29;
            ctx.beginPath();ctx.moveTo(length*(phase-.33),y-width*.13);
            ctx.quadraticCurveTo(length*(phase-.09),y+width*.12,length*phase,y-width*.07);ctx.stroke();
          }
        }else if(fx.kind==='electro-shot'){
          const pos={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t-cellScale*.25};
          const rad=Math.max(5,cellScale*.13);
          ctx.shadowColor='#6bdcff';ctx.shadowBlur=18;ctx.fillStyle='#6fdbff';ctx.strokeStyle='#d7ffff';ctx.lineWidth=2;
          ctx.beginPath();ctx.arc(pos.x,pos.y,rad,0,PI2);ctx.fill();ctx.stroke();
          ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(pos.x,pos.y,rad*.36,0,PI2);ctx.fill();
          for(let i=0;i<4;i++){const a=i*Math.PI/2+time*7;ctx.strokeStyle='#95f7ff';ctx.beginPath();ctx.moveTo(pos.x+Math.cos(a)*rad,pos.y+Math.sin(a)*rad);
            ctx.lineTo(pos.x+Math.cos(a+.32)*rad*1.7,pos.y+Math.sin(a+.32)*rad*1.7);ctx.stroke();}
        }else if(fx.kind==='electro-field'){
          const R=Math.max(.2,fx.value)*cellScale;
          const grow=Math.min(1,fx.time/.16),shrink=Math.min(1,(fx.duration-fx.time)/.15);
          const pulse=1+.035*Math.sin(time*12+fx.time*6);
          const radius=R*(.2+.8*grow)*Math.max(0,shrink)*pulse;
          ctx.translate(from.x,from.y-cellScale*.25);ctx.globalAlpha=.78;
          ctx.shadowColor='#70f2ff';ctx.shadowBlur=21;ctx.fillStyle='#37bcea43';ctx.strokeStyle='#a6faff';ctx.lineWidth=2.5;
          ctx.beginPath();ctx.arc(0,0,radius,0,PI2);ctx.fill();ctx.stroke();
          ctx.fillStyle='#efffff';ctx.beginPath();ctx.arc(0,0,radius*.19,0,PI2);ctx.fill();
          for(let i=0;i<7;i++){const a=i*PI2/7+time*(i%2?1.4:-.9),r=radius*(.62+.12*Math.sin(time*3+i));
            ctx.strokeStyle=i%2?'#efffff':'#5cdbff';ctx.beginPath();ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);
            ctx.lineTo(Math.cos(a+.22)*(r+6),Math.sin(a+.22)*(r+6));ctx.stroke();}
        }else if(fx.kind==='electro-pulse'){
          const R=Math.max(.1,fx.value)*cellScale;
          ctx.globalAlpha=(1-t)*.72;ctx.strokeStyle='#87edff';ctx.shadowColor='#69edff';ctx.shadowBlur=14;ctx.lineWidth=4*(1-t)+1;
          ctx.beginPath();ctx.ellipse(to.x,to.y-cellScale*.25,R*(.23+.8*t),R*(.18+.77*t),0,0,PI2);ctx.stroke();
        }else{
          ctx.globalAlpha=(1-t)*.95;ctx.fillStyle='#e9ffff';ctx.shadowColor='#62e9ff';ctx.shadowBlur=22;
          ctx.beginPath();ctx.arc(to.x,to.y-cellScale*.25,cellScale*(.07+.28*t),0,PI2);ctx.fill();
        }
        ctx.restore();continue;
      }
      if (renderSynergyEffect(ctx, fx, from, to, t, cellScale, time)) continue;
      if (renderV16Effect(ctx, fx, from, to, t, cellScale, time)) continue;
      if (renderTravelEffects(ctx, fx, from, to, t, cellScale)) continue;
      if (renderImpactEffects(ctx, fx, from, to, t, cellScale)) continue;
      ctx.save();
      if(fx.kind==='meteor-fall' && fx.meteor){
        // Warning ring is visible before impact; the rock lands on the exact server tick.
        const warnEnd=fx.meteor.hitAt, warning=fx.meteor.warning;
        const drop=Math.min(1,Math.max(0,(fx.time-warning)/(warnEnd-warning)));
        const radius=Math.max(.3,fx.value)*cellScale;
        ctx.globalAlpha=.28+.22*Math.sin(time*10);
        ctx.strokeStyle='#fbb96b';ctx.fillStyle='#c36a3733';ctx.lineWidth=2;
        ctx.setLineDash([7,5]);ctx.beginPath();ctx.ellipse(to.x,to.y,radius,radius*.58,0,0,PI2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
        if(fx.time<warnEnd && drop>0){
          const y=to.y-cellScale*(2.3*(1-drop)+.28);
          const size=cellScale*(.22+drop*.10);
          ctx.globalAlpha=Math.min(1,drop*1.6);ctx.shadowBlur=18;ctx.shadowColor='#fca34f';
          ctx.fillStyle='#c78863';ctx.strokeStyle='#ffdf9f';ctx.lineWidth=3;
          ctx.beginPath();for(let i=0;i<7;i++){const a=i*PI2/7;const x=to.x+Math.cos(a)*size,py=y+Math.sin(a)*size;
            if(i===0)ctx.moveTo(x,py);else ctx.lineTo(x,py);
          }ctx.closePath();ctx.fill();ctx.stroke();
          ctx.strokeStyle='#ffb359';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(to.x,y-cellScale*.26);ctx.lineTo(to.x,y-cellScale*.63);ctx.stroke();
        }
      } else if(fx.kind==='meteor-fragment'){
        const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t;
        ctx.globalAlpha=.88;ctx.shadowColor='#e9aa63';ctx.shadowBlur=8;ctx.fillStyle='#d3ae7b';ctx.strokeStyle='#fff0c3';ctx.lineWidth=1.5;
        ctx.beginPath();ctx.moveTo(x-6,y-6);ctx.lineTo(x+5,y-5);ctx.lineTo(x+7,y+4);ctx.lineTo(x-3,y+7);ctx.closePath();ctx.fill();ctx.stroke();
      } else if(fx.kind==='meteor-impact'){
        const radius=Math.max(.16,fx.value)*cellScale;
        ctx.globalAlpha=Math.max(0,1-t)*.82;ctx.shadowColor='#ffb963';ctx.shadowBlur=16;
        ctx.fillStyle='#f6ad4d45';ctx.strokeStyle='#ffe0a1';ctx.lineWidth=Math.max(1.5,4*(1-t));
        ctx.beginPath();ctx.ellipse(to.x,to.y,radius*(.35+t*.8),radius*(.25+t*.6),0,0,PI2);ctx.fill();ctx.stroke();
        for(let i=0;i<7;i++){const a=i*PI2/7;const x=to.x+Math.cos(a)*radius*t,y=to.y+Math.sin(a)*radius*t*.65;
          ctx.fillStyle='#e7b17e';ctx.fillRect(x-3,y-3,6*(1-t)+2,6*(1-t)+2);
        }
      } else if(fx.kind==='cone-slash' && fx.cone){
        // A genuine circular sector; orientation, radius and aperture use the server's parameters.
        const angle=Math.atan2(to.y-from.y,to.x-from.x),half=fx.cone.angle*Math.PI/360;
        const radius=cellScale*fx.cone.range;
        ctx.globalAlpha=(1-t)*.50;ctx.shadowBlur=16;
        ctx.shadowColor=fx.family==='kleavor'?'#ffc87d':'#cef99d';
        ctx.fillStyle=fx.family==='kleavor'?'#efad565a':'#a8ea7565';
        ctx.strokeStyle=fx.family==='kleavor'?'#ffedb7':'#e1ffc2';
        ctx.lineWidth=Math.max(1.5,5*(1-t));
        ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.arc(from.x,from.y,radius,angle-half,angle+half);ctx.closePath();ctx.fill();ctx.stroke();
        for(const skew of [-.14,.14]){
          const a=angle+skew;ctx.beginPath();ctx.moveTo(from.x,from.y);
          ctx.quadraticCurveTo(from.x+Math.cos(a-.30)*radius*.55,from.y+Math.sin(a-.30)*radius*.55,
            from.x+Math.cos(a)*radius,from.y+Math.sin(a)*radius);ctx.stroke();
        }
      } else if(fx.kind==='scizor-dash'){
        const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t;
        ctx.globalAlpha=.7*(1-t);ctx.strokeStyle='#ff9ca8';ctx.shadowColor='#ed4960';ctx.shadowBlur=12;
        ctx.lineWidth=Math.max(1,7*(1-t));ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(from.x,from.y-cellScale*.4);ctx.lineTo(x,y-cellScale*.4);ctx.stroke();
      } else if(fx.kind==='scizor-impact'){
        ctx.globalAlpha=Math.max(0,1-t);ctx.strokeStyle='#fce1ef';ctx.shadowColor='#f75b6e';ctx.shadowBlur=14;
        ctx.lineWidth=4*(1-t)+1;ctx.lineCap='round';
        for(const d of [-1,1]){
          ctx.beginPath();ctx.moveTo(to.x-cellScale*.18,to.y-cellScale*.35+d*cellScale*.11);
          ctx.lineTo(to.x+cellScale*.17,to.y-cellScale*.72-d*cellScale*.12);ctx.stroke();
        }
      } else if(fx.kind==='lullaby-note'){
        const radius=cellScale*(.7+Math.max(0,fx.value)*.15);
        ctx.globalAlpha=.48+.19*Math.sin(time*4);
        for(let i=0;i<10;i++){
          const a=i*PI2/10+time*.4,r=radius*(.35+((time*.14+i*.17)%1)*.75);
          ctx.fillStyle=i%2?'#ffbce7':'#e4b4ff';ctx.font=`${Math.max(11,cellScale*.22)}px sans-serif`;
          ctx.fillText('♪',from.x+Math.cos(a)*r,from.y-cellScale*.35+Math.sin(a)*r*.65);
        }
      } else if(fx.kind==='falling-star'){
        const flight=Math.min(1,t);
        const x=to.x,y=to.y-cellScale*(1.35*(1-flight)+.27);
        ctx.shadowColor='#ffdb91';ctx.shadowBlur=18;ctx.strokeStyle='#ffe6a2';ctx.lineWidth=3;
        ctx.globalAlpha=.9;
        ctx.beginPath();ctx.moveTo(x-cellScale*.22,y-cellScale*.38);ctx.lineTo(x,y);ctx.stroke();
        ctx.fillStyle='#fff5c8';ctx.beginPath();
        for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?cellScale*.07:cellScale*.16;
          if(i===0)ctx.moveTo(x+Math.cos(a)*r,y+Math.sin(a)*r);
          else ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);
        }ctx.closePath();ctx.fill();
      } else if(fx.kind==='wall-impact'){
        ctx.strokeStyle='#e2b6ff';ctx.lineWidth=3*(1-t)+1;
        ctx.globalAlpha=1-t;ctx.beginPath();ctx.arc(to.x,to.y-cellScale*.3,cellScale*(.1+.27*t),0,PI2);ctx.stroke();
      } else if(fx.kind==='surf-wave'){
        ctx.globalAlpha=Math.min(.87, Math.max(.1,(1-t)*1.4));
        ctx.translate(from.x,from.y);ctx.rotate(Math.atan2(to.y-from.y,to.x-from.x));
        const radius=Math.max(.35,fx.value)*cellScale;
        ctx.fillStyle='#68d4f18c';ctx.strokeStyle='#c4fbff';ctx.shadowColor='#5ecdea';ctx.shadowBlur=12;
        ctx.lineWidth=Math.max(2,cellScale*.045);
        ctx.beginPath();ctx.ellipse(0,-radius*.18,radius*.75,radius*.43,0,0,PI2);ctx.fill();
        for(let i=-1;i<=1;i++){
          ctx.beginPath();ctx.arc(-radius*.1,i*radius*.34,radius*.49,-1.45,1.45);ctx.stroke();
        }
      } else if(fx.kind==='transform'){
        ctx.globalAlpha=(1-t)*.82;ctx.strokeStyle='#e5b2ff';ctx.shadowColor='#b87dff';ctx.shadowBlur=18;
        ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(from.x,from.y-16,cellScale*(.19+.8*t),0,PI2);ctx.stroke();
        ctx.beginPath();ctx.arc(from.x,from.y-16,cellScale*(.45-.23*t),0,PI2);ctx.stroke();
      } else if (fx.kind === 'hitmon-spin') {
        const radius=Math.max(.5,fx.value)*cellScale;
        ctx.translate(from.x,from.y-12);
        ctx.globalAlpha=(1-t)*.75;
        ctx.strokeStyle='#ffe6a4';ctx.shadowColor='#f5ba66';ctx.shadowBlur=10;
        ctx.lineWidth=Math.max(1.5,5*(1-t));ctx.lineCap='round';
        for(let i=0;i<2;i++){
          const angle=(t*.7+i*.13)*Math.PI*2;
          ctx.beginPath();ctx.arc(0,0,radius*(.67+.2*t),angle,angle+Math.PI*1.04);ctx.stroke();
        }
      } else if (fx.kind === 'ghost-trail') {
        ctx.globalAlpha=.46*(1-t);ctx.shadowColor='#be84ff';ctx.shadowBlur=12;
        for(let i=0;i<6;i++){
          const a=i*2.3999+time*1.4, r=(4+i%3*4)+t*14;
          ctx.fillStyle=i%2?'#dfbaff':'#9266e9';
          ctx.beginPath();ctx.arc(from.x+Math.cos(a)*r,from.y-10+Math.sin(a)*r,2.3*(1-t)+.3,0,PI2);ctx.fill();
        }
      } else if (fx.kind === 'ghost-slash') {
        const range=Math.max(.6,fx.value)*cellScale;
        ctx.translate(from.x,from.y-15);ctx.globalAlpha=(1-t)*.92;
        ctx.shadowColor='#b47bff';ctx.shadowBlur=17;
        ctx.lineWidth=(4.4-2*t);ctx.lineCap='round';ctx.strokeStyle='#e0c4ff';
        for(let i=-1;i<=1;i++){
          const shift=i*8;
          ctx.beginPath();ctx.moveTo(-range*.7,shift+range*.2);
          ctx.quadraticCurveTo(-range*.15,shift-range*.37,range*.67,shift-range*.46);ctx.stroke();
        }
      } else if (fx.kind === 'ghost-scare') {
        const r=Math.max(1,fx.value)*cellScale*(.35+.7*t);
        ctx.globalAlpha=(1-t)*.8;ctx.shadowColor='#d6a4ff';ctx.shadowBlur=24;
        ctx.fillStyle='#9d65df33';ctx.strokeStyle='#ecd4ff';ctx.lineWidth=3*(1-t)+1;
        ctx.beginPath();ctx.arc(from.x,from.y-20,r,0,PI2);ctx.fill();ctx.stroke();
        for(let i=0;i<9;i++){
          const a=i*PI2/9+time*.3;
          const x=from.x+Math.cos(a)*r, y=from.y-20+Math.sin(a)*r;
          ctx.fillStyle=i%2?'#f9e5ff':'#b77cff';
          ctx.beginPath();ctx.arc(x,y,3.5*(1-t),0,PI2);ctx.fill();
        }
      } else if (fx.kind === 'explosion') {
        const radius=Math.max(1,fx.value)*cellScale*t;
        ctx.strokeStyle=`rgba(255,225,100,${1-t})`;
        ctx.fillStyle=`rgba(255,153,55,${(1-t)*.27})`;
        ctx.lineWidth=Math.max(1,5*(1-t));
        ctx.beginPath();ctx.arc(from.x,from.y-8,radius,0,PI2);ctx.fill();ctx.stroke();
        for(let i=0;i<14;i++) {
          const a=i*2.399963;
          const r=radius*(.5+(i%4)/8);
          ctx.fillStyle=i%2?'#fff4aa':'#ffc36e';
          ctx.globalAlpha=(1-t)*.85;
          ctx.beginPath();ctx.arc(from.x+Math.cos(a)*r,from.y-8+Math.sin(a)*r,Math.max(0.3,(3+i%3)*(1-t)),0,PI2);ctx.fill();
        }
      } else if (fx.kind === 'pollen') {
        // O Morteiro de Pólen leva 0,3 s desde o lançamento até o dano no motor.
        const fly = Math.min(1, t / (.3 / fx.duration));
        const x = from.x + (to.x - from.x) * fly;
        const y = from.y + (to.y - from.y) * fly - Math.sin(fly * Math.PI) * cellScale * .85;
        if (fly < 1) {
          const r = 8 + 4 * Math.sin(fly * Math.PI);
          ctx.fillStyle = '#efffa5'; ctx.shadowColor = '#baff71'; ctx.shadowBlur = 15;
          ctx.beginPath(); ctx.arc(x, y - 12, r, 0, PI2); ctx.fill();
          for (let i = 0; i < 5; i++) {
            const a = i * PI2 / 5 + fly * 3;
            ctx.fillStyle = i % 2 ? '#fff1a0' : '#a9f596';
            ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 12, y - 12 + Math.sin(a) * 10, 3.5, 2.2, a, 0, PI2); ctx.fill();
          }
        } else {
          const q = (t - .3 / fx.duration) / (1 - .3 / fx.duration);
          const radius = (fx.value || 1.65) * cellScale * q;
          ctx.globalAlpha = (1 - q) * .62;
          ctx.fillStyle = '#b9f5a37b'; ctx.strokeStyle = '#e7ffd0'; ctx.lineWidth = 4 * (1 - q);
          ctx.beginPath(); ctx.arc(to.x, to.y - 12, radius, 0, PI2); ctx.fill(); ctx.stroke();
          for (let i = 0; i < 16; i++) {
            const a = i * 2.39996;
            const r = radius * (.3 + (i % 7) / 10);
            ctx.fillStyle = i % 3 ? '#f2fa9a' : '#99eeb8';
            ctx.beginPath(); ctx.arc(to.x + Math.cos(a) * r, to.y - 12 + Math.sin(a) * r, 2 + i % 3, 0, PI2); ctx.fill();
          }
        }
      } else if (fx.kind === 'poison') {
        // Fio Venenoso chega ao alvo na mesma fração .75 do relógio do impacto.
        const flight = Math.min(1, t / .75);
        const x = from.x + (to.x - from.x) * flight;
        const y = from.y + (to.y - from.y) * flight - Math.sin(flight * Math.PI) * 16;
        ctx.shadowColor = '#ad65e5'; ctx.shadowBlur = 12;
        ctx.fillStyle = '#bc86da'; ctx.globalAlpha = .9 * (1 - t);
        for (let i = 0; i < 6; i++) {
          const angle = i * 2.4 + t * 3;
          ctx.beginPath(); ctx.arc(x + Math.cos(angle) * (4 + t * 10), y - 10 + Math.sin(angle) * (4 + t * 9), 2.5 + i % 2, 0, PI2); ctx.fill();
        }
      } else if (fx.kind === 'shield') {
        ctx.strokeStyle = '#d3b4ff'; ctx.shadowColor = '#ae8afa'; ctx.shadowBlur = 14;
        ctx.lineWidth = 3.3; ctx.globalAlpha = 1 - t;
        ctx.beginPath(); ctx.ellipse(to.x, to.y - cellScale * .44, cellScale * (.28 + t * .17), cellScale * (.43 + t * .1), 0, 0, PI2); ctx.stroke();
      } else if (fx.kind === 'gas') {
        // A frente da nuvem atinge o raio máximo após .32 s: mesmo instante do dano.
        const expansion = Math.min(1, t / (.32 / fx.duration));
        const radius = (fx.value || 1.85) * cellScale * expansion;
        ctx.globalAlpha = .58 * (1 - t);
        ctx.strokeStyle = '#d6a9e9'; ctx.fillStyle = '#a267b27d'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(from.x, from.y - 12, radius, 0, PI2); ctx.fill(); ctx.stroke();
        for (let i = 0; i < 9; i++) {
          const a = i * 2.4 + t, r = radius * (.4 + (i % 5) / 8);
          ctx.beginPath(); ctx.arc(from.x + Math.cos(a) * r, from.y - 12 + Math.sin(a) * r * .55, 5 + i % 3, 0, PI2); ctx.fill();
        }
      } else if (fx.kind === 'stomp') {
        const radius = (fx.value || 1.75) * cellScale * Math.min(1, t * 2.6);
        ctx.globalAlpha = 1 - t; ctx.lineWidth = 5 * (1 - t) + 1;
        ctx.strokeStyle = '#e1d5bd'; ctx.shadowColor = '#dfc29c'; ctx.shadowBlur = 15;
        ctx.beginPath(); ctx.ellipse(from.x, from.y, radius, radius * .4, 0, 0, PI2); ctx.stroke();
      } else if (fx.kind === 'water') {
        const radius = (fx.value || 1.7) * cellScale;
        ctx.strokeStyle = '#a8edff'; ctx.lineWidth = 3.5; ctx.globalAlpha = .7 * (1 - t);
        for (let ring = 0; ring < 2; ring++) {
          ctx.beginPath(); ctx.ellipse(from.x, from.y - 9, radius * (.48 + t * .55 + ring * .14), radius * (.23 + t * .22 + ring * .08),
            0, ring * Math.PI / 2 + t * 5, ring * Math.PI / 2 + t * 5 + Math.PI * 1.45); ctx.stroke();
        }
        for (let i = 0; i < 12; i++) {
          const a = i * PI2 / 12 + time * 7;
          const r = radius * (.43 + .29 * Math.sin(i * 3 + t * 6));
          ctx.fillStyle = i % 2 ? '#d2ffff' : '#66c8fa';
          ctx.beginPath(); ctx.arc(from.x + Math.cos(a) * r, from.y - 10 + Math.sin(a) * r * .47,
            2.8 + 2 * Math.sin(t * Math.PI), 0, PI2); ctx.fill();
        }
      } else if (fx.kind === 'lightning') {
        const endX = from.x + (to.x - from.x) * Math.min(1, t * 3);
        const endY = from.y + (to.y - from.y) * Math.min(1, t * 3);
        ctx.strokeStyle = '#fff7af'; ctx.lineWidth = 4; ctx.shadowColor = '#f8d53c'; ctx.shadowBlur = 18;
        ctx.globalAlpha = 1 - Math.max(0, t - .5) * 2;
        const dx = endX - from.x, dy = endY - from.y, len = Math.hypot(dx, dy) || 1;
        ctx.beginPath(); ctx.moveTo(from.x, from.y - 13);
        for (let i = 1; i < 9; i++) {
          const f = i / 9, spread = ((i * 17 + fx.id.length * 7) % 7 - 3) * 3;
          ctx.lineTo(from.x + dx * f + (-dy / len) * spread, from.y + dy * f - 13 + (dx / len) * spread);
        }
        ctx.lineTo(endX, endY - 13); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      } else if (fx.kind === 'flame') {
        const x = from.x + (to.x - from.x) * Math.min(1, t * 2.7);
        const y = from.y + (to.y - from.y) * Math.min(1, t * 2.7);
        ctx.globalAlpha = 1 - t; ctx.shadowColor = '#ff681e'; ctx.shadowBlur = 14;
        for (let i = 0; i < 9; i++) {
          const a = i * 2.4 + fx.id.length;
          const r = (7 + 25 * t) * (.4 + i / 11);
          ctx.fillStyle = i % 3 ? '#ff8e33' : '#fff3a8';
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y - 11 + Math.sin(a) * r - t * 16, 3 + (i % 3) * 2, 0, PI2); ctx.fill();
        }
      } else if (fx.kind === 'seed') {
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t - 12 - 19 * Math.sin(t * Math.PI);
        ctx.fillStyle = '#d6e790'; ctx.shadowColor = '#74bc5d'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.ellipse(x, y, 8, 5, Math.atan2(to.y - from.y, to.x - from.x), 0, PI2); ctx.fill();
        ctx.strokeStyle = '#529c58'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.stroke();
      } else if (fx.kind === 'heal') {
        ctx.globalAlpha = 1 - t; ctx.strokeStyle = '#8af5b1'; ctx.lineWidth = 2.8;
        ctx.beginPath(); ctx.ellipse(to.x, to.y - 16, 10 + t * 26, 5 + t * 15, 0, 0, PI2); ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const a = i * PI2 / 6 + t * 1.8;
          ctx.fillStyle = '#c5ffd6'; ctx.fillRect(to.x + Math.cos(a) * (8 + t * 26) - 2, to.y - 20 + Math.sin(a) * (6 + t * 16) - 2, 4, 4);
        }
        renderFloatingNumber(ctx, to.x, to.y - cellScale * .4 - 24, fx.value, t, 'heal');
      } else if (fx.kind === 'physical') {
        ctx.globalAlpha = 1 - t; ctx.strokeStyle = '#fff6d5'; ctx.lineWidth = 4.5; ctx.shadowColor = '#ffc078'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(to.x, to.y - 16, 8 + t * 18, -.95, .9); ctx.stroke();
      } else {
        const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
        ctx.globalAlpha = 1 - t; ctx.shadowBlur = 20; ctx.shadowColor = SPECIES[fx.family].glow;
        ctx.fillStyle = fx.kind === 'ko' ? '#f1d3a9' : SPECIES[fx.family].glow;
        ctx.beginPath(); ctx.arc(x, y - 11, (fx.kind === 'spell' ? 12 : 6) * (1 + t * .8), 0, PI2); ctx.fill();
      }
      ctx.restore();
    }
  }

