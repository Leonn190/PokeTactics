/** VFX for charged moves. Basic projectile visuals are shared across species by elemental type. */
import { SPECIES } from '../../../server/data';
import type { CombatEffect } from '../../../server/types';
import { renderTravelEffects } from '../vfx/travel-effects';
import { renderImpactEffects } from '../vfx/impact-effects';
import { renderFloatingNumber } from '../vfx/floating-numbers';
import { renderV16Effect } from '../vfx/v16-effects';
import { renderSynergyEffect } from './synergy-effects';
const PI2 = Math.PI * 2;

export function renderCombatEffects(context: CanvasRenderingContext2D, effects: CombatEffect[], flipY: boolean, toScreen: (x:number,y:number)=>{x:number;y:number}, cellScale: number, time: number, resolveTime?: (effect: CombatEffect) => number): void {
    const ctx = context;
    for (const fx of effects) {
      const t = Math.max(0, Math.min(1, (resolveTime ? resolveTime(fx) : fx.time) / fx.duration));
      const from = toScreen(fx.x, flipY ? -fx.y : fx.y);
      const to = toScreen(fx.targetX, flipY ? -fx.targetY : fx.targetY);
      if (renderSynergyEffect(ctx, fx, from, to, t, cellScale, time)) continue;
      if (renderV16Effect(ctx, fx, from, to, t, cellScale, time)) continue;
      if (renderTravelEffects(ctx, fx, from, to, t, cellScale)) continue;
      if (renderImpactEffects(ctx, fx, from, to, t, cellScale)) continue;
      ctx.save();
      if (fx.kind === 'ghost-trail') {
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

