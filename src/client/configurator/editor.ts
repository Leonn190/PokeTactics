import './editor.css';
import { changedFiles,documentOf,filenames,modifications,originalValue,restore,restorePrefix,setValue,valueOf,validate,outputJSON,type PathPart } from './state';
import { zipFiles } from './zip';
import { PhysicalPreview } from './preview';
import { liveDescription, synchronizeDescriptions } from './descriptions';
import type { Family } from '../../../server/types';

const safe=(value:unknown)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const pretty=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replaceAll(/\bspa\b/gi,'SpA').replaceAll(/\bspd\b/gi,'SpD');
const number=(value:number)=>Number.isInteger(value)?String(value):String(+value.toFixed(4));
const route=(file:string,path:PathPart[])=>encodeURIComponent(JSON.stringify([file,...path]));
const decode=(code:string):[string,PathPart[]]=>{const [file,...path]=JSON.parse(decodeURIComponent(code));return [file,path];};
const get=(file:string,path:PathPart[])=>valueOf(file,path);
const tabs=[
 ['pokemon','◈','POKÉMON'],['shop','◉','LOJA'],['augments','✦','AUGMENTS'],['items','◇','ITENS'],
 ['synergies','⬟','SINERGIAS'],['loot','✧','ESPÓLIOS'],['rules','⚙','REGRAS E ECONOMIA'],
 ['phases','◷','FASES'],['ranges','⌖','ALCANCES'],['visual','◐','ANIMAÇÕES'],['other','⋯','OUTROS']
] as const;
type Tab=typeof tabs[number][0];
const rarities=['COMUM','INCOMUM','RARO','ÉPICO','LENDÁRIO'];
type PokemonEntry={family:string;stage:number;name:string;dex:number};
const entries:PokemonEntry[]=Object.entries(documentOf('pokemons.json').species as Record<string,any>)
 .flatMap(([family,species])=>species.names.map((name:string,stage:number)=>({family,stage,name,dex:species.pokedexIds[stage]})))
 .sort((a,b)=>a.dex-b.dex);
function portrait(id:number,name:string){return `<img src="${import.meta.env.BASE_URL}portrait/${String(id).padStart(4,'0')}/Normal.png" alt="${safe(name)}" loading="lazy" />`;}
function same(a:any,b:any){return JSON.stringify(a)===JSON.stringify(b);}
function field(file:string,path:PathPart[],label?:string,help=''){
 const current=get(file,path),before=originalValue(file,path);
 if(typeof current!=='number' || !Number.isFinite(current))return '';
 const changed=!same(current,before);
 const integer=Number.isInteger(before);
 const numericLabel=label??pretty(String(path.at(-1)));
 const step=integer?'1':'any';
 const restrict=before>=0?'min="0"':'';
 return `<label class="cfg-field ${changed?'modified':''}" title="${safe(help||path.join(' / '))}">
  <span class="cfg-field-label">${safe(numericLabel)}${changed?'<i>●</i>':''}</span>
  <span class="cfg-field-control"><input type="number" step="${step}" ${restrict} value="${safe(current)}" data-cfg-path="${route(file,path)}" />
  <small>${changed?`Antes: ${number(before)}`:integer?'UNIDADES':'VALOR'}</small></span></label>`;
}
function fields(file:string,base:PathPart[],obj:any,labelPrefix='',depth=0):string {
 if(typeof obj==='number')return field(file,base,labelPrefix||pretty(String(base.at(-1))));
 if(obj===null||typeof obj!=='object'||depth>8)return '';
 return Object.entries(obj).map(([key,value])=>{
  const path=[...base,Array.isArray(obj)?Number(key):key];
  if(typeof value==='number')return field(file,path,Array.isArray(obj)?`${labelPrefix||'Nível'} ${Number(key)+1}`:pretty(key));
  if(value && typeof value==='object'){
   if(!Object.values(value).some(v=>typeof v==='number' || typeof v==='object'))return '';
   return `<section class="cfg-subgroup"><h4>${safe(Array.isArray(obj)?`${labelPrefix||'Etapa'} ${Number(key)+1}`:pretty(key))}</h4><div class="cfg-fields">${fields(file,path,value,'',depth+1)}</div></section>`;
  }
  return '';
 }).join('');
}
function section(title:string,body:string,description=''){
 if(!body)return '';
 return `<section class="cfg-panel"><header><div><span class="cfg-overline">CENTRO DE BALANCEAMENTO</span><h3>${safe(title)}</h3>${description?`<p>${safe(description)}</p>`:''}</div></header>${body}</section>`;
}
function choose(file:string,path:PathPart[],choices:Array<[string|number,string]>){
 const current=get(file,path);
 return `<select class="cfg-choice" data-cfg-path="${route(file,path)}">${choices.map(([value,label])=>`<option value="${safe(value)}" ${current===value?'selected':''}>${safe(label)}</option>`).join('')}</select>`;
}
function recursive(file:string,title:string,keys?:string[]){
 const cfg=documentOf(file);
 const relevant=keys?keys.filter(k=>k in cfg):Object.keys(cfg);
 return section(title,relevant.map(key=>`<div class="cfg-group"><h4>${safe(pretty(key))}</h4><div class="cfg-fields">${fields(file,[key],cfg[key],pretty(key))}</div></div>`).join(''));
}
export class Configurator {
 private el:HTMLElement;
 private passwordDialog:HTMLDialogElement;
 private tab:Tab='pokemon';
 private entry=entries[0];
 private search='';
 private rarity='all';
 private type='all';
 private onlyShop=false;
 private selectedAugment='';
 private selectedItem='';
 private preview:PhysicalPreview|null=null;
 private openPage=false;
 constructor(private goBack:()=>void){
  this.el=document.getElementById('settingsScreen')!;
  this.passwordDialog=document.getElementById('settingsPassword') as HTMLDialogElement;
  this.el.addEventListener('input',event=>this.onInput(event));
  this.el.addEventListener('change',event=>this.onChange(event));
  this.el.addEventListener('click',event=>this.onClick(event));
  this.passwordDialog.querySelector('form')!.addEventListener('submit',event=>{
   event.preventDefault();
   const input=this.passwordDialog.querySelector('input')!;
   if(input.value==='1900'){this.passwordDialog.close();input.value='';this.open();}
   else {this.passwordDialog.querySelector<HTMLElement>('.cfg-password-error')!.textContent='Senha incorreta.';input.select();}
  });
  this.passwordDialog.addEventListener('close',()=>{this.passwordDialog.querySelector<HTMLElement>('.cfg-password-error')!.textContent='';});
 }
 requestAccess():void{
  if(this.openPage){this.open();return;}
  this.passwordDialog.showModal();this.passwordDialog.querySelector('input')?.focus();
 }
 private open():void{this.openPage=true;this.el.classList.remove('hidden');this.render();}
 private back():void{
  if(modifications().length && !confirm('Existem alterações que ainda não foram exportadas. Deseja voltar mesmo assim?'))return;
  this.preview?.stop();this.el.classList.add('hidden');this.openPage=false;this.goBack();
 }
 private render():void {
  this.preview?.stop();this.preview=null;
  const changed=modifications().length;
  const target=this.el.querySelector<HTMLElement>('.cfg-body')!;
  this.el.querySelector<HTMLElement>('.cfg-count')!.textContent=`${changed} ${changed===1?'ALTERAÇÃO':'ALTERAÇÕES'}`;
  this.el.querySelector<HTMLElement>('.cfg-nav')!.innerHTML=tabs.map(([name,icon,title])=>`<button data-cfg-tab="${name}" class="${name===this.tab?'active':''}"><b>${icon}</b>${title}<span>${changedFiles().length && this.tab===name?'•':''}</span></button>`).join('');
  target.innerHTML= this.tab==='pokemon'?this.pokemon():this.tab==='shop'?this.shop():this.tab==='augments'?this.augments():
   this.tab==='items'?this.items():this.tab==='synergies'?this.synergies():this.tab==='loot'?recursive('espolios.json','ESPÓLIOS E RECOMPENSAS'):
   this.tab==='rules'?recursive('regras_gerais.json','REGRAS GERAIS E ECONOMIA',Object.keys(documentOf('regras_gerais.json')).filter(k=>k!=='shopOddsByLevel')):
   this.tab==='phases'?recursive('fases.json','CAPÍTULOS, FASES E ADVERSÁRIOS'):
   this.tab==='ranges'?recursive('alcances.json','CLASSES DE ALCANCE'):
   this.tab==='visual'?recursive('animacoes.json','PERFIS E ANIMAÇÕES')+recursive('renderizacao.json','RENDERIZAÇÃO'):
   recursive('ataques.json','ATAQUES REGULARES', ['basic'])+recursive('pokemons.json','REFERÊNCIAS GLOBAIS', ['other'])+
     recursive('regras_gerais.json','PARÂMETROS COMPLEMENTARES', ['matchmaking']);
  if(this.tab==='pokemon'){
   const cv=target.querySelector<HTMLCanvasElement>('#cfgPhysicalPreview');
   if(cv){this.preview=new PhysicalPreview(cv);this.refreshPreview();}
  }
 }
 private pokemon():string{
  const pokemon=documentOf('pokemons.json');
  const list=entries.filter(e=>{
   const s=pokemon.species[e.family];
   return (this.rarity==='all'||String(s.rarity)===this.rarity)&& (this.type==='all'||s.elements.includes(this.type)) &&
    (!this.onlyShop||s.shop) && (!this.search || `${e.name} ${e.dex} ${s.elements.join(' ')} ${e.family}`.toLowerCase().includes(this.search.toLowerCase()));
  });
  const e=this.entry,s=pokemon.species[e.family],stage=s.stages?.[e.stage]||{},
   stageStats=s.stageBases?.[e.stage]||s.base;
  const statPath=(key:string):PathPart[]=>s.stageBases?.[e.stage] ? ['species',e.family,'stageBases',e.stage,key]:['species',e.family,'base',key];
  const stats=['hp','atk','def','spa','spd','speed'];
  const total=Math.round(stageStats.hp/5+stageStats.atk+stageStats.def+stageStats.spa+stageStats.spd+stageStats.speed);
  const moveId=stage.move||s.attack;
  const move=documentOf('ataques.json').moves[moveId];
  const size=s.physicalSizes?.[e.stage]??1;
  const moved=modifications().some(c=>c.file==='pokemons.json' && c.path[0]==='species' && c.path[1]===e.family);
  const types=Array.from(new Set(Object.values(pokemon.species).flatMap((v:any)=>v.elements))).sort() as string[];
  const controls=`<div class="cfg-poke-content">
   <div class="cfg-poke-head" style="--cfg-pokemon-glow:${safe(s.glow)}">
     ${portrait(e.dex,e.name)}<div><span>#${String(e.dex).padStart(3,'0')} · ${rarities[s.rarity-1]}</span><h2>${safe(e.name)}</h2>
     <p>${safe(s.elements.join(' / ').toUpperCase())} · ESTÁGIO ${e.stage+1}/${s.names.length}</p><strong>${total} <small>PODER BASE</small></strong></div>
     ${moved?'<span class="cfg-changed-chip">MODIFICADO</span>':''}
   </div>
   ${section('ATRIBUTOS BÁSICOS',`<div class="cfg-fields">${stats.map(key=>field('pokemons.json',statPath(key),{hp:'VIDA',atk:'ATK',def:'DEF',spa:'SpA',spd:'SpD',speed:'VEL'}[key])).join('')}</div>`,'Valores consumidos pelo motor de combate, separados por evolução.')}
   ${section('ATAQUE REGULAR',`<div class="cfg-kv"><span>Atributo</span><strong>${safe(stage.basic?.stat||s.basic?.stat||'atk').toUpperCase()}</strong><span>Tipo de golpe</span><strong>${safe(stage.basic?.category||s.basic?.category||'physical')}</strong></div><div class="cfg-fields">${fields('ataques.json',['basic'],documentOf('ataques.json').basic)}</div>`,'Parâmetros compartilhados entre as espécies.')}
   ${section('HABILIDADE · '+move.name,`<p class="cfg-context">${safe(moveId)} · Valores utilizados diretamente pelo servidor.</p><div class="cfg-fields">${fields('ataques.json',['moves',moveId],move)}</div>`,'Se outra forma usar a mesma habilidade, seus valores também serão afetados.')}
   ${section('ENERGIA E ALCANCE',`<div class="cfg-fields">${typeof stage.energy==='number'?field('pokemons.json',['species',e.family,'stages',e.stage,'energy'],'CUSTO DE ENERGIA'):field('pokemons.json',['species',e.family,'energy'],'CUSTO DE ENERGIA')}</div><p class="cfg-context">CLASSE: ${safe(stage.rangeClass||s.rangeClass)} · Os valores efetivos são editáveis na aba Alcances.</p>`)}
   ${section('EVOLUÇÃO, RARIDADE E TAMANHO',`<div class="cfg-fields">
      ${e.stage<s.names.length-1?field('pokemons.json',['species',e.family,'evolutionCopies',e.stage],'CÓPIAS PARA EVOLUIR'):''}
      <label class="cfg-field"><span class="cfg-field-label">RARIDADE DA FAMÍLIA</span>${choose('pokemons.json',['species',e.family,'rarity'],rarities.map((name,i)=>[i+1,name]))}</label>
      ${field('pokemons.json',['species',e.family,'physicalSizes',e.stage],'TAMANHO FÍSICO')}
    </div><div class="cfg-preview-wrap"><canvas id="cfgPhysicalPreview" width="430" height="270" aria-label="Prévia animada do corpo e sombra"></canvas><p>ESCALA PMD · SOMBRA · CORPO FÍSICO · 1 CASA DE REFERÊNCIA<br><strong>${number(size)}×</strong> · A configuração não aparece no painel da partida.</p></div>`)}
  </div>`;
  return `<div class="cfg-poke-layout"><aside class="cfg-poke-list"><div class="cfg-poke-filter"><input data-cfg-search placeholder="⌕ Buscar Pokémon..." value="${safe(this.search)}" />
    <div class="cfg-filter-line"><select data-cfg-rarity><option value="all">Todas raridades</option>${rarities.map((name,i)=>`<option value="${i+1}" ${this.rarity===String(i+1)?'selected':''}>${name}</option>`).join('')}</select>
    <select data-cfg-type><option value="all">Todos tipos</option>${types.map(t=>`<option ${t===this.type?'selected':''} value="${safe(t)}">${safe(t)}</option>`).join('')}</select></div>
    <label class="cfg-shop-toggle"><input type="checkbox" data-cfg-shoponly ${this.onlyShop?'checked':''}/> Apenas loja</label>
    <span class="cfg-context">${list.length} de ${entries.length} formas</span></div>
    <div class="cfg-poke-cards">${list.map(a=>{const sp=pokemon.species[a.family];return `<button class="cfg-poke-card ${a===this.entry?'active':''}" data-cfg-pokemon="${entries.indexOf(a)}" style="--rarity:${['#758492','#8fcd9c','#77b8f1','#cf91ec','#ffc96c'][sp.rarity-1]}">
     ${portrait(a.dex,a.name)}<span><small>#${String(a.dex).padStart(3,'0')} · ${rarities[sp.rarity-1]}</small><strong>${safe(a.name)}</strong></span><b>${modifications().some(c=>c.path[1]===a.family)?'●':''}</b></button>`;}).join('')}</div></aside>${controls}</div>`;
 }
 private shop():string{
  const rows=documentOf('regras_gerais.json').shopOddsByLevel as number[][];
  const names=rarities;
  const table=`<div class="cfg-odds-scroll"><table class="cfg-odds"><thead><tr><th>NÍVEL</th>${names.map((name,i)=>`<th class="r-${i+1}">${name}</th>`).join('')}<th>TOTAL</th><th></th></tr></thead><tbody>
  ${rows.map((row,index)=>{const total=row.reduce((x,y)=>x+y,0);return `<tr><th>${index+1}</th>${row.map((v,i)=>`<td style="--odd-color:${['#8598ac','#80c4a0','#6ca9e4','#be87e4','#f4bf5a'][i]}"><div class="cfg-odd"><input data-cfg-path="${route('regras_gerais.json',['shopOddsByLevel',index,i])}" type="number" min="0" max="100" step="1" value="${v}"/><span>%</span></div><div class="cfg-odd-bar"><i style="width:${Math.min(100,v)}%"></i></div></td>`).join('')}
    <td class="${Math.abs(total-100)>.001?'cfg-bad-odds':''}">${total.toFixed(1)}%</td><td><button data-cfg-normalize="${index}" title="Normalizar até 100%">100%</button><button data-cfg-restore-row="${index}" title="Restaurar linha">↺</button></td></tr>`;}).join('')}</tbody></table></div>`;
  return section('PROBABILIDADES POR NÍVEL',table,'Cada linha deve somar 100%. Nenhuma normalização é aplicada automaticamente.') +
   recursive('regras_gerais.json','OUTROS PARÂMETROS DA LOJA',['rerollCost','shopSize','typeShopBias']);
 }
 private augments():string{
  const aug=documentOf('augments.json');
  const selected=aug.augments.find((a:any)=>a.id===this.selectedAugment)||aug.augments[0];
  this.selectedAugment=selected?.id||'';
  return section('PESOS POR CAPÍTULO',`<div class="cfg-fields">${fields('augments.json',['chapterRarityWeights'],aug.chapterRarityWeights)}</div>`)+
   `<div class="cfg-split"><div class="cfg-tile-list">${aug.augments.map((a:any)=>`<button data-cfg-augment="${safe(a.id)}" class="cfg-augment-tile rarity-${safe(a.rarity)} ${this.selectedAugment===a.id?'active':''}"><b>${safe(a.symbol||'✦')}</b><span><small>${safe(a.rarity.toUpperCase())} · ${safe(a.id)}</small><strong>${safe(a.name)}</strong></span>${modifications().some(c=>c.file==='augments.json'&&get('augments.json',['augments',Number(c.path[1]),'id'])===a.id)?'<i>●</i>':''}</button>`).join('')}</div>
   ${section(selected?selected.name:'AUGMENT',selected?`<p class="cfg-context">${safe(liveDescription('augments.json',['augments',aug.augments.indexOf(selected)]))}</p><div class="cfg-fields">${fields('augments.json',['augments',aug.augments.indexOf(selected),'params'],selected.params)}</div>`:'Nenhum augment disponível.','Parâmetros usados pela simulação; mecânica preservada.')}</div>`;
 }
 private items():string{
  const cfg=documentOf('itens.json');
  const recipes=Object.keys(cfg.recipes||{});
  const key=recipes.includes(this.selectedItem)?this.selectedItem:recipes[0];this.selectedItem=key||'';
  return section('COMPONENTES E REGRAS DE EQUIPAMENTOS',`<div class="cfg-fields">${fields('itens.json',['components'],cfg.components)}</div><div class="cfg-fields">${fields('itens.json',['defaults'],cfg.defaults)}</div>`)+
   `<div class="cfg-split"><div class="cfg-tile-list">${recipes.map(recipe=>`<button data-cfg-item="${safe(recipe)}" class="cfg-augment-tile ${key===recipe?'active':''}"><b>◇</b><span><small>RECEITA · ${safe(recipe)}</small><strong>${safe(cfg.recipes[recipe].effect)}</strong></span></button>`).join('')}</div>
    ${section('ITEM · '+key,`<p class="cfg-context">${safe(liveDescription('itens.json',['recipes',key]))}</p><div class="cfg-fields">${fields('itens.json',['recipes',key],cfg.recipes[key])}</div>`,'O equipamento permanece no mundo físico, não no HUD.')}</div>`+
   recursive('itens.json','LIMITES DE ITENS',['maxSlots','limits','combatIntroSeconds','inventorySlots']);
 }
 private synergies():string{
  const cfg=documentOf('sinergias.json');
  return section('SINERGIAS POR TIPAGEM',`<div class="cfg-fields">${fields('sinergias.json',[],cfg)}</div>`,'Altere níveis e bônus próprios sem substituir as mecânicas específicas.');
 }
 private onInput(event:Event):void {
  const el=event.target as HTMLInputElement;
  if(el.matches('[data-cfg-search]')){this.search=el.value;const pos=el.selectionStart;this.render();const input=this.el.querySelector<HTMLInputElement>('[data-cfg-search]');if(input){input.focus();input.setSelectionRange(pos,pos);}return;}
  if(!el.matches('[data-cfg-path]'))return;
  const [file,path]=decode(el.dataset.cfgPath!);
  const prev=get(file,path);
  const raw=el.value.trim();if(!raw)return;
  const next=typeof prev==='number'?Number(raw):raw;
  if(typeof next==='number'&&!Number.isFinite(next))return;
  setValue(file,path,next);
  if(file==='pokemons.json' && path[0]==='species' && path[2]==='stageBases' && path[3]===0){
   setValue(file,['species',path[1],'base',path[4]],next);
  }
  this.el.querySelector<HTMLElement>('.cfg-count')!.textContent=`${modifications().length} ALTERAÇÕES`;
  el.closest('.cfg-field')?.classList.toggle('modified',!same(next,originalValue(file,path)));
  if(file==='pokemons.json' && path[2]==='physicalSizes')this.refreshPreview();
 }
 private onChange(event:Event):void {
  const el=event.target as HTMLInputElement;
  if(el.matches('[data-cfg-rarity]')){this.rarity=el.value;this.render();return;}
  if(el.matches('[data-cfg-type]')){this.type=el.value;this.render();return;}
  if(el.matches('[data-cfg-shoponly]')){this.onlyShop=el.checked;this.render();return;}
  if(el.matches('select[data-cfg-path]')){const [file,path]=decode(el.dataset.cfgPath!);setValue(file,path,Number(el.value));}
  if(el.matches('[data-cfg-path]'))this.render();
 }
 private onClick(event:Event):void {
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if(!button)return;
  if(button.dataset.cfgTab){this.tab=button.dataset.cfgTab as Tab;this.render();return;}
  if(button.dataset.cfgPokemon){this.entry=entries[Number(button.dataset.cfgPokemon)];this.render();return;}
  if(button.dataset.cfgAugment){this.selectedAugment=button.dataset.cfgAugment;this.render();return;}
  if(button.dataset.cfgItem){this.selectedItem=button.dataset.cfgItem;this.render();return;}
  if(button.dataset.cfgNormalize){
   const index=Number(button.dataset.cfgNormalize),arr=get('regras_gerais.json',['shopOddsByLevel',index]) as number[];
   const positive=arr.map(n=>Math.max(0,Number(n)||0)),sum=positive.reduce((a,b)=>a+b,0);
   const normalized=sum?positive.map(n=>Math.floor(n*100/sum)):positive.map((_,i)=>i===0?100:0);
   let remain=100-normalized.reduce((a,b)=>a+b,0);
   for(const i of positive.map((_,i)=>i).sort((a,b)=>(positive[b]*100/sum-normalized[b])-(positive[a]*100/sum-normalized[a])||a-b)){
    if(remain<=0)break;normalized[i]++;remain--;
   }
   normalized.forEach((v,i)=>setValue('regras_gerais.json',['shopOddsByLevel',index,i],v));this.render();return;
  }
  if(button.dataset.cfgRestoreRow){const index=Number(button.dataset.cfgRestoreRow);restorePrefix('regras_gerais.json',['shopOddsByLevel',index]);this.render();return;}
 }
 private refreshPreview():void{
  if(!this.preview)return;
  const s=documentOf('pokemons.json').species[this.entry.family];
  this.preview.show({family:this.entry.family as Family,stage:this.entry.stage,dex:this.entry.dex,size:s.physicalSizes[this.entry.stage],name:this.entry.name});
  const summary=this.el.querySelector<HTMLElement>('.cfg-preview-wrap strong');if(summary)summary.textContent=`${number(s.physicalSizes[this.entry.stage])}×`;
 }
 export():void{
  synchronizeDescriptions();
  const errors=validate();
  if(errors.length){alert('Não é possível exportar configurações inválidas:\n\n'+errors.slice(0,18).join('\n'));return;}
  const files=Object.fromEntries(filenames().map(file=>[`config/${file}`,outputJSON(file)]));
  const zip=zipFiles(files),url=URL.createObjectURL(zip);
  const a=document.createElement('a');a.href=url;a.download='PokeTactics-config-V20.zip';document.body.append(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),2000);
 }
 attachGlobals():void {
  this.el.querySelector('[data-cfg-export]')!.addEventListener('click',()=>this.export());
  this.el.querySelector('[data-cfg-back]')!.addEventListener('click',()=>this.back());
  this.el.querySelector('[data-cfg-restore-all]')!.addEventListener('click',()=>{
   if(confirm('Restaurar todos os valores originais?')){restore();this.render();}
  });
  this.el.querySelector('[data-cfg-restore-section]')!.addEventListener('click',()=>{
   if(!confirm('Restaurar os valores da seção atual?'))return;
   const files:Record<Tab,string[]>={pokemon:['pokemons.json','ataques.json'],shop:[],augments:['augments.json'],items:['itens.json'],synergies:['sinergias.json'],loot:['espolios.json'],rules:[],phases:['fases.json'],ranges:['alcances.json'],visual:['animacoes.json','renderizacao.json'],other:[]};
   for(const file of files[this.tab])restore(file);
   const ruleKeys=Object.keys(documentOf('regras_gerais.json'));
   if(this.tab==='shop')for(const key of ruleKeys.filter(k=>['shopOddsByLevel','rerollCost','shopSize','typeShopBias'].includes(k)))restorePrefix('regras_gerais.json',[key]);
   if(this.tab==='rules')for(const key of ruleKeys.filter(k=>k!=='shopOddsByLevel' && !['rerollCost','shopSize','typeShopBias'].includes(k)))restorePrefix('regras_gerais.json',[key]);
   if(this.tab==='other')restorePrefix('ataques.json',['basic']);
   this.render();
  });
  this.el.querySelector('[data-cfg-changes]')!.addEventListener('click',()=>{
   const changes=modifications(),modal=document.getElementById('cfgChanges') as HTMLDialogElement;
   modal.querySelector('.cfg-changes-list')!.innerHTML=changes.length?changes.map(c=>`<div><strong>${safe(c.file)} / ${safe(c.path.join(' / '))}</strong><span>${safe(JSON.stringify(c.before))} → ${safe(JSON.stringify(c.after))}</span></div>`).join(''):'Nenhuma alteração pendente.';
   modal.showModal();
  });
 }
}
