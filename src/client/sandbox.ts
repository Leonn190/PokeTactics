/** V23 sandbox controls — strictly an alternate interface to the authoritative worker. */
import { SPECIES, ELEMENTS, RARITY_COLORS } from '../../server/data';
import { AUGMENTS } from '../../server/systems/augments';
import { countTraits } from '../../server/systems/synergies/counting';
import { tierFor } from '../../server/systems/synergies/registry';
import { ITEM_COLORS, ITEMS, RECIPES } from '../../server/systems/items';
import type { Element, Family, GameCommand, GameSnapshot, ItemColor } from '../../server/types';
import './sandbox.css';

const safe=(s:string|number)=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
type Side='p0'|'p1';
const root=document.getElementById('sandboxTools')!;
const popup=document.getElementById('sandboxPanel')!;
const toggle=document.getElementById('sandboxToggle')!;
export class SandboxView {
  private snapshot:GameSnapshot|null=null;
  private side:Side='p0';
  private tab:'pokemon'|'items'|'augments'='pokemon';
  private search='';
  private rarity='all';
  private type='all';
  private chosen:Family='bulbasaur';
  private stage=0;
  private recipe=Object.keys(RECIPES)[0];
  private gearComponent:ItemColor|null=null;
  private compact=true;
  private lastSignature='';
  constructor(private send:(command:GameCommand)=>void,private exit:()=>void){
    toggle.addEventListener('click',()=>{this.compact=!this.compact;this.draw();});
    popup.addEventListener('click',event=>this.click(event));
    popup.addEventListener('change',event=>this.change(event));
    popup.addEventListener('input',event=>{
      const control=event.target as HTMLInputElement;
      if(control.id==='sandboxSearch'){this.search=control.value;this.renderCatalog();}
    });
  }
  reset():void{this.snapshot=null;this.lastSignature='';this.side='p0';this.tab='pokemon';this.compact=true;root.classList.add('hidden');popup.innerHTML='';}
  render(snapshot:GameSnapshot):void{
    if(!snapshot.sandbox){if(this.snapshot)this.reset();return;}
    this.snapshot=snapshot;root.classList.remove('hidden');
    const signature=JSON.stringify([snapshot.phase,snapshot.players.map(p=>[
      p.augments,p.units.map(u=>[u.id,u.family,u.stage,u.position,u.equipment,u.iv,u.level])]),
      snapshot.players[0].itemInventory?.map(it=>it.id)]);
    if(signature!==this.lastSignature){this.lastSignature=signature;this.draw();}
  }
  private draw():void {
    const s=this.snapshot;if(!s)return;
    popup.classList.toggle('hidden',this.compact);
    toggle.textContent=this.compact?'☰ FERRAMENTAS DO TESTE':'× RECOLHER CONTROLES';
    const preparing=s.phase==='planning';
    popup.innerHTML=`<header class="sandbox-header"><span>POKÉTACTICS · V23</span><h2>MODO TESTE</h2><p>Simulação local · alterações sem ranking</p></header>
      <div class="sandbox-start"><button data-sandbox-action="${preparing?'start':'restart'}" class="sandbox-main-action">${preparing?'⚔ INICIAR BATALHA':'↻ REINICIAR CONFRONTO'}</button>
      <button data-sandbox-action="exit" class="sandbox-exit">↩ SAIR DO TESTE</button></div>
      <div class="sandbox-sides"><button data-sandbox-side="p0" class="${this.side==='p0'?'active':''}">SUA EQUIPE <b>${s.players[0].units.filter(u=>u.position.area==='board').length}/6</b></button><button data-sandbox-side="p1" class="${this.side==='p1'?'active':''}">INIMIGO <b>${s.players[1].units.filter(u=>u.position.area==='board').length}/6</b></button></div>
      <nav class="sandbox-tabs"><button data-sandbox-tab="pokemon" class="${this.tab==='pokemon'?'active':''}">POKÉMON</button><button data-sandbox-tab="items" class="${this.tab==='items'?'active':''}">ITENS</button><button data-sandbox-tab="augments" class="${this.tab==='augments'?'active':''}">AUGMENTS</button></nav>
      <div class="sandbox-content" id="sandboxContent"></div>
      <div class="sandbox-traits">${Object.entries(countTraits(s.players.find(p=>p.id===this.side)!)).filter(([,count])=>count&&count>0).map(([type,count])=>`<span>${safe(ELEMENTS[type as Element].name)} ${count}${tierFor(type as Element,count||0)?' ✦':''}</span>`).join('')||'Sem sinergias'}</div>
      <div class="sandbox-footer">Ouro ∞ · Nível 6 · Preparação livre<br/>Equipes preservadas após cada combate.</div>`;
    this.renderContent();
  }
  private renderContent():void{
    const target=popup.querySelector('#sandboxContent');if(!target||!this.snapshot)return;
    target.innerHTML=this.tab==='pokemon'?this.pokemonHTML():this.tab==='items'?this.itemsHTML():this.augmentsHTML();
  }
  private pokemonHTML():string{
    const s=this.snapshot!,player=s.players.find(p=>p.id===this.side)!;
    const options=(Object.keys(SPECIES) as Family[]).filter(f=>{
      const p=SPECIES[f];return (this.rarity==='all'||String(p.rarity)===this.rarity)
        &&(this.type==='all'||p.elements.includes(this.type as Element))
        &&(p.names.some(name=>name.toLocaleLowerCase('pt-BR').includes(this.search.toLocaleLowerCase('pt-BR')))||f.includes(this.search.toLowerCase()));
    }).sort((a,b)=>SPECIES[a].pokedexIds[0]-SPECIES[b].pokedexIds[0]);
    if(!options.includes(this.chosen)){this.chosen=options[0]||'bulbasaur';this.stage=0;}
    const pick=SPECIES[this.chosen];
    return `<div class="sandbox-filter"><input id="sandboxSearch" type="search" value="${safe(this.search)}" placeholder="Buscar Pokémon..." />
      <select data-sandbox-filter="rarity" aria-label="Raridade"><option value="all">Todas as raridades</option>${RARITY_COLORS.map((_,i)=>`<option value="${i+1}" ${this.rarity===String(i+1)?'selected':''}>${['Comum','Incomum','Raro','Épico','Lendário'][i]}</option>`).join('')}</select>
      <select data-sandbox-filter="type" aria-label="Tipo"><option value="all">Todos os tipos</option>${Object.entries(ELEMENTS).map(([id,t])=>`<option value="${id}" ${this.type===id?'selected':''}>${safe(t.name)}</option>`).join('')}</select></div>
      <div id="sandboxCatalog" class="sandbox-catalog">${this.catalogHTML(options)}</div>
      <label class="sandbox-field">ESTÁGIO <select data-sandbox-stage>${pick.names.map((n,i)=>`<option value="${i}" ${this.stage===i?'selected':''}>${safe(n)}</option>`).join('')}</select></label>
      <button class="sandbox-add" data-sandbox-action="add" ${this.snapshot?.phase!=='planning'?'disabled':''}>+ ADICIONAR ${safe(pick.names[this.stage]||pick.names[0]).toUpperCase()}</button>
      <h3>EM CAMPO · ${this.side==='p0'?'VOCÊ':'ADVERSÁRIO'}</h3>
      <div class="sandbox-units">${player.units.map(unit=>`<div class="sandbox-unit"><div><b>${safe(SPECIES[unit.family].names[unit.stage])}</b><small>${unit.position.area==='board'?`Col ${unit.position.col+1} · Fila ${unit.position.row+1}`:'Banco'}</small></div><div class="sandbox-unit-actions"><button data-sandbox-unit-stage="${unit.id}" data-stage="${Math.max(0,unit.stage-1)}" ${unit.stage===0?'disabled':''} title="Evolução anterior">−</button><button data-sandbox-unit-stage="${unit.id}" data-stage="${Math.min(SPECIES[unit.family].names.length-1,unit.stage+1)}" ${unit.stage===SPECIES[unit.family].names.length-1?'disabled':''} title="Evoluir">+</button><button data-sandbox-remove="${unit.id}" title="Remover Pokémon">✕</button></div></div>`).join('')||'<p class="sandbox-empty">Adicione uma unidade para começar.</p>'}</div>
      <p class="sandbox-hint">Arraste os Pokémon nos dois lados do tabuleiro durante a preparação.</p>`;
  }
  private catalogHTML(list:Family[]):string {
    return list.map(f=>{
      const p=SPECIES[f],dex=p.pokedexIds[0];
      return `<button class="sandbox-pokemon ${this.chosen===f?'active':''}" data-sandbox-family="${safe(f)}" title="${safe(p.names.join(' → '))}">
       <img src="${import.meta.env.BASE_URL}portrait/${String(dex).padStart(4,'0')}/Normal.png" loading="lazy" alt=""/><span>${safe(p.names[0])}</span></button>`;
    }).join('')||'<p>Nenhum Pokémon encontrado.</p>';
  }
  private renderCatalog():void{
    const area=popup.querySelector('#sandboxCatalog');if(!area)return;
    const list=(Object.keys(SPECIES) as Family[]).filter(f=>{
      const p=SPECIES[f];return (this.rarity==='all'||String(p.rarity)===this.rarity)
       &&(this.type==='all'||p.elements.includes(this.type as Element))
       &&p.names.some(name=>name.toLowerCase().includes(this.search.toLowerCase()));
    }).sort((a,b)=>SPECIES[a].pokedexIds[0]-SPECIES[b].pokedexIds[0]);
    area.innerHTML=this.catalogHTML(list);
  }
  private itemsHTML():string{
    const player=this.snapshot!.players.find(p=>p.id===this.side)!;
    return `<h3>COMPONENTES INFINITOS</h3><div class="sandbox-item-grid">${ITEM_COLORS.map(color=>{
      const item=ITEMS.components[color];return `<button data-sandbox-component="${color}" ${this.snapshot!.phase!=='planning'?'disabled':''}><span style="background:${item.color}"></span>${safe(item.name)}</button>`;
    }).join('')}</div>
    <h3>ITENS COMPLETOS</h3><div class="sandbox-item-grid complete">${Object.entries(RECIPES).map(([recipe,item])=>`<button data-sandbox-recipe="${safe(recipe)}" title="${safe(item.description)}" ${this.snapshot!.phase!=='planning'?'disabled':''}>✦ ${safe(item.name||item.effect)}</button>`).join('')}</div>
    <h3>EQUIPAR DIRETAMENTE · ${safe(player.name)}</h3>
    <label class="sandbox-field">ITEM <select data-sandbox-equip-recipe><optgroup label="Itens completos">${Object.entries(RECIPES).map(([key,item])=>`<option value="${key}" ${!this.gearComponent&&this.recipe===key?'selected':''}>${safe(item.name||item.effect)}</option>`).join('')}</optgroup><optgroup label="Componentes">${ITEM_COLORS.map(color=>`<option value="component:${color}" ${this.gearComponent===color?'selected':''}>${safe(ITEMS.components[color].name)}</option>`).join('')}</optgroup></select></label>
    <div class="sandbox-units">${player.units.map(u=>`<div class="sandbox-unit"><div><b>${safe(SPECIES[u.family].names[u.stage])}</b><small>${(u.equipment||[]).map((it,i)=>`<button class="sandbox-equipped" data-sandbox-unequip="${u.id}" data-slot="${i}" title="Remover">${safe(it.recipe?RECIPES[it.recipe]?.name||it.recipe:ITEMS.components[it.components[0]].name)} ×</button>`).join('')||'Sem itens'}</small></div><button data-sandbox-equip="${u.id}" ${this.snapshot!.phase!=='planning'?'disabled':''}>EQUIPAR</button></div>`).join('')}</div>
    <p class="sandbox-hint">No seu lado, os itens do catálogo também entram no inventário normal para arrastar, combinar e equipar. Pokébolas indisponíveis.</p>`;
  }
  private augmentsHTML():string{
    const player=this.snapshot!.players.find(p=>p.id===this.side)!;
    return `<h3>APRIMORAMENTOS LIVRES · ${safe(player.name)}</h3><p class="sandbox-hint">Marque ou desmarque. Os atributos são reconstruídos ao alterar a seleção; o combate seguinte usa o estado atual.</p>
      <div class="sandbox-augments">${AUGMENTS.map(a=>`<label class="sandbox-augment"><input type="checkbox" data-sandbox-augment="${a.id}" ${(player.augments||[]).includes(a.id)?'checked':''} ${this.snapshot!.phase!=='planning'?'disabled':''}/><span class="sandbox-augment-symbol">${safe((a as any).symbol||'✦')}</span><span><b>${safe(a.name)}</b><small>${safe(a.description)}</small></span></label>`).join('')}</div>`;
  }
  private change(event:Event):void{
    const el=event.target as HTMLInputElement|HTMLSelectElement;
    if(el.dataset.sandboxFilter==='rarity')this.rarity=el.value;
    if(el.dataset.sandboxFilter==='type')this.type=el.value;
    if(el.hasAttribute('data-sandbox-stage'))this.stage=Number(el.value);
    if(el.hasAttribute('data-sandbox-equip-recipe')){this.gearComponent=el.value.startsWith('component:')?el.value.slice(10) as ItemColor:null;if(!this.gearComponent)this.recipe=el.value;}
    if(el.dataset.sandboxAugment)this.send({kind:'sandbox-augment',ownerId:this.side,id:el.dataset.sandboxAugment,enabled:(el as HTMLInputElement).checked});
    else if(el.hasAttribute('data-sandbox-filter'))this.renderContent();
    else if(el.hasAttribute('data-sandbox-stage'))this.draw();
  }
  private click(event:Event):void{
    const el=(event.target as HTMLElement).closest<HTMLElement>('button');if(!el)return;
    if(el.dataset.sandboxSide){this.side=el.dataset.sandboxSide as Side;this.draw();return;}
    if(el.dataset.sandboxTab){this.tab=el.dataset.sandboxTab as typeof this.tab;this.draw();return;}
    if(el.dataset.sandboxFamily){this.chosen=el.dataset.sandboxFamily as Family;this.stage=0;this.draw();return;}
    if(el.dataset.sandboxAction==='exit'){this.exit();return;}
    if(el.dataset.sandboxAction==='start')this.send({kind:'sandbox-start'});
    if(el.dataset.sandboxAction==='restart')this.send({kind:'sandbox-restart'});
    if(el.dataset.sandboxAction==='add')this.send({kind:'sandbox-add',ownerId:this.side,family:this.chosen,stage:this.stage});
    if(el.dataset.sandboxRemove)this.send({kind:'sandbox-remove',ownerId:this.side,unitId:el.dataset.sandboxRemove});
    if(el.dataset.sandboxUnitStage)this.send({kind:'sandbox-stage',ownerId:this.side,unitId:el.dataset.sandboxUnitStage,stage:Number(el.dataset.stage)});
    if(el.dataset.sandboxComponent){const color=el.dataset.sandboxComponent as ItemColor;
      if(this.side==='p0')this.send({kind:'sandbox-item',color});
      else {this.gearComponent=color;this.draw();}}
    if(el.dataset.sandboxRecipe){if(this.side==='p0')this.send({kind:'sandbox-item',recipe:el.dataset.sandboxRecipe});
      else {this.gearComponent=null;this.recipe=el.dataset.sandboxRecipe;this.draw();}}
    if(el.dataset.sandboxEquip)this.send({kind:'sandbox-equip',ownerId:this.side,unitId:el.dataset.sandboxEquip,...(this.gearComponent?{color:this.gearComponent}:{recipe:this.recipe})});
    if(el.dataset.sandboxUnequip)this.send({kind:'sandbox-equip',ownerId:this.side,unitId:el.dataset.sandboxUnequip,slot:Number(el.dataset.slot)});
  }
}
