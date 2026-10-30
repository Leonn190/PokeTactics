import config from '../../config/augments.json';
import type { GameCommand,GameSnapshot } from '../../server/types';
import type { Arena } from './arena';
import { trainerSpot } from '../../server/combat/trainer-position';

const byId=new Map(config.augments.map(a=>[a.id,a]));
const safe=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export class AugmentView {
 private overlay:HTMLElement;
 private cards:HTMLElement;
 private reopen:HTMLButtonElement;
 private stacks:HTMLElement;
 private tooltip:HTMLElement;
 private tipId='';
 private latestChoice='';
 private lastChapter=0;
 private preview=false;
 private current:GameSnapshot|null=null;
 private canChoose=false;
 constructor(private send:(command:GameCommand)=>void){
  this.overlay=document.createElement('div');this.overlay.className='augment-overlay hidden';
  this.overlay.innerHTML=`<section class="augment-dialog" role="dialog" aria-label="Escolher aprimoramento" aria-modal="true">
    <header><span>◆ EVOLUA SUA ESTRATÉGIA ◆</span><h2>ESCOLHA UM APRIMORAMENTO</h2>
      <p>Uma escolha por capítulo · cada cartão pode ser atualizado uma única vez</p></header>
    <div class="augment-cards"></div><footer><button type="button" class="augment-watch">◉ VER JOGO</button>
      <span class="augment-remaining"></span></footer></section>`;
  document.getElementById('app')!.append(this.overlay);
  this.cards=this.overlay.querySelector('.augment-cards')!;
  this.reopen=document.createElement('button');this.reopen.className='augment-reopen hidden';
  this.reopen.textContent='✦ ESCOLHER APRIMORAMENTO';
  document.getElementById('app')!.append(this.reopen);
  this.stacks=document.createElement('div');this.stacks.className='arena-augment-stacks';
  document.getElementById('app')!.append(this.stacks);
  this.tooltip=document.createElement('div');this.tooltip.className='arena-augment-tooltip';
  this.tooltip.id='arenaAugmentTooltip';this.tooltip.setAttribute('role','tooltip');
  this.tooltip.setAttribute('aria-hidden','true');document.body.append(this.tooltip);
  this.stacks.addEventListener('pointerover',event=>this.showTooltip(event.target as HTMLElement));
  this.stacks.addEventListener('pointerout',event=>{
    const next=(event as PointerEvent).relatedTarget as HTMLElement|null;
    if(!next?.closest('.arena-augment-icon'))this.hideTooltip();
  });
  this.stacks.addEventListener('focusin',event=>this.showTooltip(event.target as HTMLElement));
  this.stacks.addEventListener('focusout',event=>{
    const next=(event as FocusEvent).relatedTarget as HTMLElement|null;
    if(!next?.closest('.arena-augment-icon'))this.hideTooltip();
  });
  window.addEventListener('scroll',()=>this.hideTooltip(),true);
  window.addEventListener('resize',()=>this.hideTooltip());
  this.overlay.querySelector<HTMLButtonElement>('.augment-watch')!.addEventListener('click',()=>{this.preview=true;this.draw();});
  this.reopen.addEventListener('click',()=>{this.preview=false;this.draw();});
  this.cards.addEventListener('click',event=>{
    const target=(event.target as HTMLElement).closest<HTMLElement>('[data-augment-slot]');if(!target||!this.canChoose)return;
    const slot=Number(target.dataset.augmentSlot);
    const reroll=target.hasAttribute('data-augment-reroll');
    this.send(reroll?{kind:'augment-reroll',slot}:{kind:'augment-choose',slot});
  });
 }
 reset():void {this.hideTooltip();this.current=null;this.latestChoice='';this.lastChapter=0;this.preview=false;this.stacks.innerHTML='';delete this.stacks.dataset.owners;this.draw();}
 render(snapshot:GameSnapshot,arena:Arena):void {this.current=snapshot;this.draw();this.positionStacks(arena);}
 private draw():void {
  const state=this.current,choice=state?.players[0].augmentChoice;
  const pending=!!choice&&choice.status==='pending'&&state?.phase==='planning'&&!state?.players[0].eliminated;
  if(choice&&this.lastChapter!==choice.chapter){this.lastChapter=choice.chapter;this.preview=false;this.latestChoice='';}
  this.canChoose=pending;
  this.overlay.classList.toggle('hidden',!pending||this.preview);
  this.reopen.classList.toggle('hidden',!pending||!this.preview);
  if(!pending||!choice)return;
  this.overlay.querySelector<HTMLElement>('.augment-remaining')!.textContent=`${Math.ceil(state?.timeLeft||0)}s restantes`;
  const key=JSON.stringify([choice.offers,choice.rerolled,choice.chapter,choice.rarity]);
  if(key===this.latestChoice)return;
  this.latestChoice=key;
  this.cards.innerHTML=choice.offers.map((id,i)=>{
    const augment=byId.get(id);if(!augment)return '';
    return `<div class="augment-card rarity-${augment.rarity}">
      <button class="augment-card-choose" data-augment-slot="${i}" aria-label="Escolher ${safe(augment.name)}">
        <div class="augment-flare"></div><div class="augment-symbol">${safe((augment as any).symbol||'✦')}</div>
        <div class="augment-tier">${safe(({bronze:'BRONZE',silver:'PRATA',gold:'OURO',prismatic:'PRISMÁTICO'} as const)[augment.rarity as 'bronze'|'silver'|'gold'|'prismatic'])}</div>
        <h3>${safe(augment.name)}</h3><p>${safe(augment.description)}</p><span class="augment-pick-text">SELECIONAR APRIMORAMENTO</span>
      </button><button class="augment-card-roll" data-augment-slot="${i}" data-augment-reroll
        ${choice.rerolled[i]?'disabled':''} aria-label="Atualizar cartão ${i+1}">⟳ ${choice.rerolled[i]?'JÁ UTILIZADO':'ATUALIZAR · 1×'}</button>
    </div>`;
  }).join('');
 }
 positionStacks(arena:Arena):void {
  const state=this.current;
  if(!state || state.phase==='finished'){this.hideTooltip();this.stacks.innerHTML='';return;}
  const battle=state.visibleBattle;
  const participants=battle?.participants || [state.observedId];
  const quad=participants.length>2;
  const ids=participants.filter(id=>state.players.some(p=>p.id===id));
  const key=ids.map(id=>`${id}:${state.players.find(p=>p.id===id)?.augments?.join(',')||''}`).join('|');
  if(this.stacks.dataset.owners!==key){
   this.hideTooltip();
   this.stacks.dataset.owners=key;
   this.stacks.innerHTML=ids.map((id,i)=>{
     const player=state.players.find(p=>p.id===id)!;
     return `<section class="arena-augment-owner" data-augment-owner="${id}" aria-label="Augments de ${safe(player.name)}">
       <strong>${safe(player.name)}</strong><div class="arena-augment-icons ${(player.augments||[]).length>5?'many':''}">${(player.augments||[]).map(augmentId=>{
         const a=byId.get(augmentId);if(!a)return '';
         return `<span class="arena-augment-icon rarity-${a.rarity}" tabindex="0" data-augment-id="${safe(a.id)}" aria-describedby="arenaAugmentTooltip" aria-label="${safe(a.name)}: ${safe(a.description)}">${safe((a as any).symbol||'✦')}</span>`;
       }).join('')}</div></section>`;
   }).join('');
  }
  const app=document.getElementById('app')!.getBoundingClientRect();
  const canvas=document.getElementById('battlefield')!.getBoundingClientRect();
  const baseScale=Math.min(.9,Math.max(.58,arena.worldScale()));
  ids.forEach((id,i)=>{
    const el=this.stacks.querySelector<HTMLElement>(`[data-augment-owner="${id}"]`);if(!el)return;
    const slot=participants.indexOf(id),pos=trainerSpot(slot,quad);
    // World coordinates: each player's own LEFT edge, also in 14x8 quadruples.
    const edgeX=quad?(slot<2?-8.65:-.55):-4.65;
    const edgeY=pos.y>0?1.15:-1.15;
    const point=arena.toScreen(edgeX,edgeY);
    el.style.left=`${canvas.left-app.left+point.x}px`;
    el.style.top=`${canvas.top-app.top+point.y}px`;
    el.style.setProperty('--augment-scale',String(baseScale));
    el.classList.toggle('left-owner',pos.x<0);
    el.classList.toggle('top-owner',pos.y<0);
  });
  if(this.tooltip.classList.contains('active')){
   const active=document.activeElement;
   const hovered=this.stacks.querySelector<HTMLElement>('.arena-augment-icon:hover');
   this.showTooltip(hovered || (active instanceof HTMLElement ? active : null));
  }
 }
 private showTooltip(target:HTMLElement|null):void {
  const icon=target?.closest<HTMLElement>('.arena-augment-icon');
  const info=byId.get(icon?.dataset.augmentId||'');
  if(!icon||!info){this.hideTooltip();return;}
  const rarity:{[key:string]:string}={bronze:'BRONZE',silver:'PRATA',gold:'OURO',prismatic:'PRISMÁTICO'};
  if(this.tipId!==info.id){
   this.tipId=info.id;
   this.tooltip.className=`arena-augment-tooltip rarity-${info.rarity} active`;
   this.tooltip.innerHTML=`<div class="arena-augment-tip-symbol">${safe((info as any).symbol||'✦')}</div>
     <div><strong>${safe(info.name)}</strong><span>${rarity[info.rarity]||safe(info.rarity)}</span>
     <p>${safe(info.description)}</p></div>`;
  }
  this.tooltip.setAttribute('aria-hidden','false');
  const rect=icon.getBoundingClientRect(),w=this.tooltip.offsetWidth,h=this.tooltip.offsetHeight;
  const left=Math.max(10,Math.min(window.innerWidth-w-10,rect.right+12));
  const top=Math.max(10,Math.min(window.innerHeight-h-10,rect.top+(rect.height-h)/2));
  this.tooltip.style.left=`${left}px`;this.tooltip.style.top=`${top}px`;
 }
 private hideTooltip():void {
  this.tipId='';this.tooltip?.classList.remove('active');this.tooltip?.setAttribute('aria-hidden','true');
 }
}
