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
  this.overlay.querySelector<HTMLButtonElement>('.augment-watch')!.addEventListener('click',()=>{this.preview=true;this.draw();});
  this.reopen.addEventListener('click',()=>{this.preview=false;this.draw();});
  this.cards.addEventListener('click',event=>{
    const target=(event.target as HTMLElement).closest<HTMLElement>('[data-augment-slot]');if(!target||!this.canChoose)return;
    const slot=Number(target.dataset.augmentSlot);
    const reroll=target.hasAttribute('data-augment-reroll');
    this.send(reroll?{kind:'augment-reroll',slot}:{kind:'augment-choose',slot});
  });
 }
 reset():void {this.current=null;this.latestChoice='';this.lastChapter=0;this.preview=false;this.stacks.innerHTML='';delete this.stacks.dataset.owners;this.draw();}
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
  if(!state || state.phase==='finished'){this.stacks.innerHTML='';return;}
  const battle=state.visibleBattle;
  const participants=battle?.participants || [state.observedId];
  const quad=participants.length>2;
  const ids=participants.filter(id=>state.players.some(p=>p.id===id));
  const key=ids.map(id=>`${id}:${state.players.find(p=>p.id===id)?.augments?.join(',')||''}`).join('|');
  if(this.stacks.dataset.owners!==key){
   this.stacks.dataset.owners=key;
   this.stacks.innerHTML=ids.map((id,i)=>{
     const player=state.players.find(p=>p.id===id)!;
     return `<section class="arena-augment-owner" data-augment-owner="${id}" aria-label="Augments de ${safe(player.name)}">
       <strong>${safe(player.name)}</strong><div class="arena-augment-icons ${(player.augments||[]).length>5?'many':''}">${(player.augments||[]).map(augmentId=>{
         const a=byId.get(augmentId);if(!a)return '';
         return `<span class="arena-augment-icon rarity-${a.rarity}" tabindex="0" title="${safe(a.name)}: ${safe(a.description)}" aria-label="${safe(a.name)}: ${safe(a.description)}">${safe((a as any).symbol||'✦')}</span>`;
       }).join('')}</div></section>`;
   }).join('');
  }
  const app=document.getElementById('app')!.getBoundingClientRect();
  const canvas=document.getElementById('battlefield')!.getBoundingClientRect();
  const baseScale=Math.min(.9,Math.max(.58,arena.worldScale()));
  ids.forEach((id,i)=>{
    const el=this.stacks.querySelector<HTMLElement>(`[data-augment-owner="${id}"]`);if(!el)return;
    const slot=participants.indexOf(id),pos=trainerSpot(slot,quad);
    // The right-hand edge of each participant's *own* board, including quadruplicates.
    const edgeX=quad?(slot<2?-.2:8.5):4.55;
    const edgeY=pos.y>0?2.0:-2.0;
    const point=arena.toScreen(edgeX,edgeY);
    el.style.left=`${canvas.left-app.left+point.x}px`;
    el.style.top=`${canvas.top-app.top+point.y}px`;
    el.style.setProperty('--augment-scale',String(baseScale));
    el.classList.toggle('left-owner',pos.x<0);
    el.classList.toggle('top-owner',pos.y<0);
  });
 }
}
