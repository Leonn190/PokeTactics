import { bonusTraits } from '../../../server/systems/augments';
import { getStageData, SPECIES } from '../../../server/data';
import type { Family } from '../../../server/types';
import { SYNERGIES,tierFor } from '../../../server/systems/synergies/registry';
import type { Element,Player } from '../../../server/types';
const safe=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const labels:Record<string,string>={amplification:'Amplificação',durability:'Durabilidade',atk:'ATK',def:'DEF',spa:'SpA',spd:'SpD',shield:'Barreira (HP máx.)',energyPerSecond:'Energia/s',hp:'Vida máxima',regen:'Regeneração/s',speed:'Velocidade',damage:'Dano base',spaRatio:'Escala SpA',maxSpeed:'Limite de Vel.',landingSpeed:'Vel. ao pousar',healingShieldAmp:'Amplifica cura/barreira',emergencyShield:'Barreira emergência',share:'Compartilhamento',vampirism:'Vampirismo',reviveHp:'Vida ao reviver',critChance:'Chance crítica',critDamage:'Dano crítico extra',inherit:'Herança',iv:'IV da casa',dragonIv:'IV extra (Dragão)',waves:'Ondas',dot:'Veneno/s',deathHeal:'Cura por morte',healReduction:'Anticura',durabilityReduction:'Redução Durabilidade',speedReduction:'Redução Vel.'};
const percentKeys=new Set(['amplification','durability','atk','def','spa','spd','shield','hp','regen','speed','maxSpeed','landingSpeed','healingShieldAmp','emergencyShield','share','vampirism','reviveHp','critChance','critDamage','inherit','dot','deathHeal','healReduction','durabilityReduction','speedReduction','spaRatio']);
function tierText(tier:Record<string,number|number[]>):string {
 return Object.entries(tier).filter(([k])=>k!=='count').map(([k,v])=>{
  if(Array.isArray(v))return `${labels[k]||k}: ${v.join(' / ')}`;
  return `${labels[k]||k}: ${percentKeys.has(k)?`${Math.round(v*1000)/10}%`:Number.isInteger(v)?v:v.toFixed(1)}`;
 }).join(' · ');
}
export class SynergyPanel {
 private visible:Element|null=null;
 private counts:Partial<Record<Element,number>>={};
 private contributing:Partial<Record<Element,Array<{family:Family;stage:number}>>>={};
 private tooltip:HTMLElement;
 private latestTypes='';
 private latestOwnership='';
 private owned=new Set<string>();
 private onBoard=new Set<string>();
 constructor(private rows:HTMLElement,private typeIcon:(type:Element,size:number)=>string,private portrait:(family:Family,size:number,stage:number)=>string){
   this.tooltip=document.createElement('aside');
   this.tooltip.className='synergy-tooltip';this.tooltip.setAttribute('role','tooltip');this.tooltip.hidden=true;
   document.body.appendChild(this.tooltip);
   rows.addEventListener('pointerover',ev=>{
     const btn=(ev.target as HTMLElement).closest<HTMLElement>('[data-synergy]');
     if(btn)this.show(btn.dataset.synergy as Element,btn);
   });
   rows.addEventListener('pointerout',ev=>{
     const related=ev.relatedTarget as Node|null;
     if(this.rows.contains(related)||this.tooltip.contains(related))return;
     this.hide();
   });
   rows.addEventListener('focusin',ev=>{const row=(ev.target as HTMLElement).closest<HTMLElement>('[data-synergy]');if(row)this.show(row.dataset.synergy as Element,row);});
   rows.addEventListener('click',ev=>{const row=(ev.target as HTMLElement).closest<HTMLElement>('[data-synergy]');if(row)this.show(row.dataset.synergy as Element,row);});
   rows.addEventListener('keydown',ev=>{if(ev.key==='Escape')this.hide();});
   this.tooltip.addEventListener('pointerleave',ev=>{if(!this.rows.contains(ev.relatedTarget as Node|null))this.hide();});
 }
 reset():void {this.latestTypes='';this.latestOwnership='';this.visible=null;this.counts={};this.contributing={};this.rows.innerHTML='';this.tooltip.hidden=true;}
 update(watched:Player):void {
   const unique=new Set<string>();this.counts={};this.contributing={};
   this.owned=new Set(watched.units.map(u=>`${u.family}:${u.stage}`));
   this.onBoard=new Set(watched.units.filter(u=>u.position.area==='board').map(u=>`${u.family}:${u.stage}`));
   const ownershipKey=[...this.owned].sort().join('|')+';'+[...this.onBoard].sort().join('|');
   const ownershipChanged=ownershipKey!==this.latestOwnership;this.latestOwnership=ownershipKey;
   for(const unit of watched.units){
     if(unit.position.area!=='board')continue;
     const key=`${unit.family}:${unit.stage}`;if(unique.has(key))continue;unique.add(key);
     for(const element of getStageData(unit.family,unit.stage).elements){
       this.counts[element]=(this.counts[element]||0)+1;
       (this.contributing[element]||=[]).push({family:unit.family,stage:unit.stage});
     }
   }
   this.counts=bonusTraits(this.counts,watched.augments||[]);
   const order=(Object.keys(SYNERGIES) as Element[]).filter(type=>!!this.counts[type]);
   const level=(type:Element)=>SYNERGIES[type].tiers.filter(t=>t.count<=(this.counts[type]||0)).length;
   const closeness=(type:Element)=>{
      const next=SYNERGIES[type].tiers.find(t=>t.count>(this.counts[type]||0));
      return next?next.count-(this.counts[type]||0):0;
   };
   order.sort((a,b)=>level(b)-level(a)||closeness(a)-closeness(b)||a.localeCompare(b));
   const html=order.map(type=>{
      const count=this.counts[type]||0,tiers=SYNERGIES[type].tiers,levelActive=level(type);
      const next=tiers.find(t=>t.count>count),step=next?.count||tiers[tiers.length-1].count;
      const grade=['inactive','bronze','silver','gold','prismatic'][levelActive];
      return `<button type="button" data-synergy="${type}" class="trait-row sy-row tier-${grade}" aria-label="${safe(SYNERGIES[type].name)}, ${count} de ${step}; mostrar efeitos">
        <span class="sy-pentagon">${this.typeIcon(type,25)}</span>
        <span class="sy-name"><strong>${safe(SYNERGIES[type].name)}</strong></span>
        <span class="sy-count">${count} / ${step}</span></button>`;
   }).join('')||'<div class="traits-empty">Nenhum tipo em campo</div>';
   const changed=this.latestTypes!==html;
   if(changed||!this.rows.hasChildNodes()){this.rows.innerHTML=html;this.latestTypes=html;}
   if((changed||ownershipChanged)&&this.visible){const anchor=this.rows.querySelector<HTMLElement>(`[data-synergy="${this.visible}"]`);if(anchor)this.show(this.visible,anchor);else this.hide();}
 }
 private show(type:Element,row:HTMLElement):void {
   const config=SYNERGIES[type];if(!config)return;
   const count=this.counts[type]||0,level=config.tiers.filter(t=>t.count<=count).length;
   // Catalog-wide portraits, not only the player's currently deployed contributors.
   const list=(Object.keys(SPECIES) as Family[]).flatMap(family=>SPECIES[family].names.map((_,stage)=>({family,stage})))
     .filter(u=>getStageData(u.family,u.stage).elements.includes(type))
     .sort((a,b)=>SPECIES[a.family].pokedexIds[a.stage]-SPECIES[b.family].pokedexIds[b.stage]);
   const html=`<header><span class="sy-tooltip-icon">${this.typeIcon(type,27)}</span><div><strong>${safe(config.name.toUpperCase())}</strong><small>${safe(config.subtitle)}</small></div></header>
     <p>${safe(config.description)}</p><div class="sy-tooltip-tiers">${config.tiers.map((tier,i)=>`<div class="sy-tooltip-tier ${i===level-1?'current':i<level?'reached':'future'}"><b>${tier.count}</b><span>${safe(tierText(tier))}</span></div>`).join('')}</div>
     <div class="sy-tooltip-contributors"><b>POKÉMON DA SINERGIA · ${list.length}</b><div class="sy-portraits">${list.map(u=>`<span title="${safe(SPECIES[u.family].names[u.stage])}" class="${this.onBoard.has(`${u.family}:${u.stage}`)?'owned deployed':this.owned.has(`${u.family}:${u.stage}`)?'owned':'unowned'}">${this.portrait(u.family,37,u.stage)}</span>`).join('')}</div></div>`;
   if(this.tooltip.innerHTML!==html)this.tooltip.innerHTML=html;
   this.visible=type;this.tooltip.hidden=false;
   const r=row.getBoundingClientRect(),width=340;
   const left=Math.min(window.innerWidth-width-12,r.right);
   this.tooltip.style.left=`${Math.max(6,left)}px`;
   this.tooltip.style.top=`${Math.max(8,Math.min(window.innerHeight-this.tooltip.offsetHeight-9,r.top-12))}px`;
 }
 private hide():void{this.visible=null;this.tooltip.hidden=true;}
}
