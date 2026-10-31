import type {GameSnapshot} from '../../server/types';
import type {Arena} from './arena';
import {itemRackSlots} from './hud';
/** Render the same rack visuals for opponents; DOM is never draggable/interactable. */
export class ObservedItemRacks {
 private root=document.createElement('div');
 private lastSignatures=new Map<string,string>();
 constructor(){this.root.id='observedItemRacks';document.getElementById('app')!.append(this.root);}
 reset():void{this.root.replaceChildren();this.lastSignatures.clear();}
 render(snapshot:GameSnapshot,arena:Arena,scoutId:string):void {
  const battle=snapshot.phase!=='planning'&&!snapshot.visibleBattle?.resolved?snapshot.visibleBattle:null;
  const ids=battle?.participants||[scoutId];
  const visible=ids.filter(id=>snapshot.players.some(p=>p.id===id) && !(id==='p0'&&scoutId==='p0'));
  for(const node of Array.from(this.root.querySelectorAll<HTMLElement>('[data-rack-owner]')))if(!visible.includes(node.dataset.rackOwner||'')){
    this.lastSignatures.delete(node.dataset.rackOwner||'');node.remove();
  }
  for(const id of visible){
   const player=snapshot.players.find(p=>p.id===id)!;
   let node=Array.from(this.root.children).find(e=>(e as HTMLElement).dataset.rackOwner===id) as HTMLElement|undefined;
   if(!node){node=document.createElement('div');node.className='item-inventory view-only enemy-inventory';node.dataset.rackOwner=id;
     node.setAttribute('aria-label',`Itens de ${player.name} (apenas observação)`);this.root.append(node);}
   const signature=JSON.stringify([player.name,player.itemInventory]);
   if(this.lastSignatures.get(id)!==signature){
     this.lastSignatures.set(id,signature);
     node.innerHTML=`<span class="enemy-rack-label">${player.name.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</span><div class="inventory-contents">${itemRackSlots(player.itemInventory||[],null,true)}</div>`;
   }
   const p=arena.ownerPlacement(id);arena.placeWorldRack(node,p.rack.x,p.rack.y);
  }
 }
 position(arena:Arena):void{
  for(const node of Array.from(this.root.querySelectorAll<HTMLElement>('[data-rack-owner]'))){
   const p=arena.ownerPlacement(node.dataset.rackOwner||'');arena.placeWorldRack(node,p.rack.x,p.rack.y);
  }
 }
}
