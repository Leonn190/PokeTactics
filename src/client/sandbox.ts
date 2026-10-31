import type {GameCommand,GameSnapshot} from '../../server/types';
/** A single battle action in the regular shop, no parallel team/item editor. */
export class SandboxView {
  private readonly root=document.getElementById('sandboxTools')!;
  private readonly button=document.getElementById('sandboxToggle') as HTMLButtonElement;
  constructor(private send:(command:GameCommand)=>void, _exit:()=>void){
    const shop=document.querySelector('.shop-row');
    if(shop)shop.append(this.root);
    document.getElementById('sandboxPanel')?.remove();
    this.button.textContent='⚔ INICIAR BATALHA';
    this.button.setAttribute('title','Organize os dois lados arrastando Pokémon, depois inicie a batalha');
    this.button.addEventListener('click',()=>this.send({kind:'sandbox-start'}));
  }
  render(snapshot:GameSnapshot):void {
    this.root.classList.toggle('hidden',!snapshot.sandbox);
    this.button.disabled=snapshot.phase!=='planning';
    this.button.textContent=snapshot.phase==='planning'?'⚔ INICIAR BATALHA':'⚔ EM COMBATE';
  }
  reset():void{this.root.classList.add('hidden');}
}
