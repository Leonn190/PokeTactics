/** V26.5: oito componentes / 36 receitas do TFT Set 10, adaptadas aos atributos de Pokémon. */
import settings from '../../config/itens.json';
import type { CombatUnit, EquippedItem, ItemColor, PercentStats, Stats } from '../types';

export const ITEMS = settings;
export const ITEM_COLORS = Object.keys(ITEMS.components) as ItemColor[];
export type Recipe = keyof typeof ITEMS.recipes;
export type ItemRecipe = { name:string; effect: string; description: string; [key: string]: number | string };
export const RECIPES = ITEMS.recipes as Record<string, ItemRecipe>;
export const COMPLETED_KEYS = Object.keys(RECIPES);
export function recipeKey(a: ItemColor, b: ItemColor): string {
  const i=ITEM_COLORS.indexOf(a),j=ITEM_COLORS.indexOf(b);
  if(i<0||j<0)throw Error('Componente inválido');
  return i<=j?`${a}+${b}`:`${b}+${a}`;
}
export function makeComponent(id:string,color:ItemColor):EquippedItem {
  if(!ITEM_COLORS.includes(color))throw Error('Componente inválido');
  return {id,components:[color],kind:'component'};
}
export function craft(id:string,a:EquippedItem,b:EquippedItem):EquippedItem|null {
  if(a.kind!=='component'||b.kind!=='component')return null;
  const key=recipeKey(a.components[0],b.components[0]);
  return RECIPES[key]?{id,kind:'complete',components:key.split('+') as ItemColor[],recipe:key}:null;
}
export function effectCount(unit:Pick<CombatUnit,'equipment'>,effect:string):number {
  return (unit.equipment||[]).filter(item=>item.kind==='complete' && RECIPES[item.recipe||'']?.effect===effect).length;
}
export function effectData(effect:string):ItemRecipe|null {
  return Object.values(RECIPES).find(item=>item.effect===effect)||null;
}
export function numberParam(effect:string,param:string,fallback=0):number {
  const value=effectData(effect)?.[param];
  return typeof value==='number'?value:fallback;
}
/** Apenas os seis status primários aceitam +10 puro; luva = +10 p.p. crítico,
 * gota = +10 de energia inicial, tratados na simulação, não em Stats. */
export function bonusStats(stats:Stats,equipment:EquippedItem[]=[]):Stats {
  const copy={...stats};
  for(const item of equipment)for(const color of item.components){
    const component=ITEMS.components[color];
    const stat=component.stat as keyof Stats;
    if(Object.hasOwn(copy,stat))copy[stat]+=component.value;
  }
  const count=(effect:string)=>equipment.filter(i=>i.kind==='complete'&&RECIPES[i.recipe||'']?.effect===effect).length;
  copy.hp*=Math.pow(1+numberParam('warmog','hpPercent'),count('warmog'))
    *Math.pow(1+numberParam('dragonclaw','hpPercent'),count('dragonclaw'));
  copy.spa*=Math.pow(1+numberParam('rabadon','spaPercent'),count('rabadon'));
  copy.atk*=Math.pow(1+numberParam('deathblade','atkPercent'),count('deathblade'))
    *Math.pow(1+numberParam('infinity','atkPercent'),count('infinity'));
  if(count('justice')){copy.atk*=1+numberParam('justice','atkPercent')*count('justice');copy.spa+=numberParam('justice','spa')*count('justice');}
  return Object.fromEntries(Object.entries(copy).map(([key,value])=>[key,Math.round(value)])) as Stats;
}
export function effectivePercents(unit?:Pick<CombatUnit,'equipment'|'itemStacks'|'itemTimers'> & Partial<Pick<CombatUnit,'synergy'>>,elapsed=0):PercentStats {
  const result:PercentStats={...ITEMS.defaults};
  if(!unit)return result;
  const has=(effect:string)=>effectCount(unit,effect)>0;
  for(const item of unit.equipment||[])for(const color of item.components){
    if(color==='white')result.critChance+=ITEMS.components.white.value/100;
  }
  for(const effect of ['bloodthirster','gunblade','justice'] as const)
    if(has(effect))result.vampirism+=numberParam(effect,'vampirism')*(effect==='justice' && unit.itemStacks.justiceMode===2?2:1);
  if(has('jeweled'))result.critDamage+=numberParam('jeweled','critDamage');
  if(has('infinity'))result.critDamage+=numberParam('infinity','critDamage');
  for(const effect of ['rabadon','redbuff'] as const)if(has(effect))result.amplification+=numberParam(effect,'amplification');
  if(has('guardbreaker') && (unit.itemTimers.guardbreaker||0)>elapsed)result.amplification+=numberParam('guardbreaker','amplification');
  if(has('bluebuff') && (unit.itemTimers.bluebuff||0)>elapsed)result.amplification+=numberParam('bluebuff','amplification');

  const stacks=unit.itemStacks.titan||0;
  if(has('titan')&&stacks>=numberParam('titan','maxStacks'))result.durability+=0;
  result.vampirism=Math.min(ITEMS.limits.vampirism,Math.max(0,result.vampirism));
  result.critChance=Math.min(ITEMS.limits.critChance,Math.max(0,result.critChance));
  result.durability=Math.min(ITEMS.limits.durability,Math.max(0,result.durability));
  result.amplification=Math.min(ITEMS.limits.amplification,Math.max(0,result.amplification));
  const synergy=unit.synergy;
  if(synergy){
    for(const key of ['vampirism','critChance','critDamage','durability','amplification'] as const)
      result[key]+=synergy.percents[key]||0;
    if(synergy.chilled&&synergy.chilled.until>elapsed)result.durability-=synergy.chilled.durability;
    if(synergy.poisoned&&synergy.poisoned.until>elapsed)result.durability=Math.max(-.2,result.durability-(synergy.poisonDurabilityReduction||0));
    result.vampirism=Math.min(ITEMS.limits.vampirism,Math.max(0,result.vampirism));
    result.critChance=Math.min(ITEMS.limits.critChance,Math.max(0,result.critChance));
    result.durability=Math.min(ITEMS.limits.durability,Math.max(-.2,result.durability));
    result.amplification=Math.min(ITEMS.limits.amplification,Math.max(0,result.amplification));
  }
  return result;
}
export function bumpStack(unit:CombatUnit,effect:string,value=1):void {
  if(!effectCount(unit,effect))return;
  const maximum=numberParam(effect,'maxStacks',0)||50;
  unit.itemStacks[effect]=Math.min(maximum,(unit.itemStacks[effect]||0)+value);
}
export function bonusStat(unit:CombatUnit,key:keyof Stats,now:number,focus:number):number {
  const has=(e:string)=>effectCount(unit,e)>0;
  if(key==='speed'){
    return unit.stats.speed*((unit.itemStacks.guinsoo||0)*numberParam('guinsoo','step')
      + (unit.itemTimers.nashor>now?numberParam('nashor','speedPercent'):0)
      + (unit.itemStacks.edgeNightUsed?numberParam('edge_night','speedPercent'):0)
      + (now<ITEMS.combatIntroSeconds+numberParam('quicksilver','duration')?(unit.itemStacks.quicksilver||0)*numberParam('quicksilver','speedPercent'):0));
  }
  if(key==='spa')return (unit.itemStacks.archangel||0)*numberParam('archangel','step')
    + (has('justice')&&unit.itemStacks.justiceMode===1?numberParam('justice','spa'):0)
    + (unit.itemStacks.titan||0)*numberParam('titan','spaPerStack')
    + (has('adaptive')&&!unit.itemStacks.adaptiveFront?numberParam('adaptive','backSpa'):0)
    + (has('crownguard')&&unit.itemTimers.crownEnd>0&&now>=unit.itemTimers.crownEnd?numberParam('crownguard','spa'):0);
  if(key==='atk')return unit.stats.atk*((has('justice')&&unit.itemStacks.justiceMode===1?numberParam('justice','atkPercent'):0)
    + (unit.itemStacks.titan||0)*numberParam('titan','atkPerStack')
    + (unit.itemStacks.sterakUsed?numberParam('sterak','atkPercent'):0));
  if(key==='def'||key==='spd')return (has('gargoyle')?focus*numberParam('gargoyle','perTarget'):0)
    + (has('adaptive')&&unit.itemStacks.adaptiveFront?numberParam('adaptive',key==='def'?'frontDef':'frontSpd'):0)
    + (has('titan')&&(unit.itemStacks.titan||0)>=numberParam('titan','maxStacks')?numberParam('titan',key==='def'?'defAtMax':'spdAtMax'):0)
    + (unit.itemStacks.protectorUsed?numberParam('protector',key):0)
    + (has('evenshroud')&&now<ITEMS.combatIntroSeconds+numberParam('evenshroud','duration')?numberParam('evenshroud',key):0);
  return 0;
}
export function healingMultiplier(unit:CombatUnit):number {
  return unit.itemTimers.burning>unit.itemNow?1-(unit.itemTimers.woundPct||0):1;
}
export function shieldMultiplier(_unit:CombatUnit):number {return 1;}
export function itemTooltip(item:EquippedItem):string {
  if(item.kind==='mega-stone')return 'MEGA PEDRA\nArraste até um Pokémon compatível de nível 10 ou mais. Transformação permanente e sem ocupar equipamento.';
  if(item.kind==='remover')return 'REMOVEDOR MAGNÉTICO\nArraste até um Pokémon durante a preparação para retirar TODOS os seus itens. Consome a ferramenta e exige espaço livre na área de itens.';
  if(item.kind==='reforger')return 'REFORJADOR\nArraste até um Pokémon durante a preparação: remove e transforma todos os itens equipados. Componentes continuam componentes; itens completos continuam completos. Consome a ferramenta.';
  const part=(color:ItemColor)=>{
    const c=ITEMS.components[color];
    const unit=c.stat==='energy'?'ENERGIA INICIAL':c.stat==='critChance'?'P.P. CRÍTICO':c.stat.toUpperCase();
    return `+${c.value} ${unit}`;
  };
  const stats=item.components.map(part).join(' • ');
  if(item.kind==='component')return `${ITEMS.components[item.components[0]].name.toUpperCase()}\n${stats}\nCombine com outro componente para criar um item completo.`;
  const completed=RECIPES[item.recipe||''];
  return `${completed?.name.toUpperCase()||'ITEM COMPLETO'}\n${stats}\n${completed?.description||'Efeito especial'}`;
}
