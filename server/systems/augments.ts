import { grantTrainerXp } from '../trainer-xp';
import { blocksEnergy } from '../combat/statuses';
/** V19: data-driven augments; simulation owns rolls, rewards and combat events. */
import config from '../../config/augments.json';
import { ITEM_COLORS, ITEMS, makeComponent, RECIPES } from './items';
import type { Battle, CombatUnit, Element, Player, Pokemon, StatKey, Stats, AugmentChoice } from '../types';
import { RULES, SPECIES } from '../data';

export const AUGMENTS = config.augments;
export type Augment = (typeof AUGMENTS)[number];
export type AugmentRarity = 'bronze' | 'silver' | 'gold' | 'prismatic';
export const AUGMENT_MAP: Readonly<Record<string,Augment>> = Object.fromEntries(AUGMENTS.map(a=>[a.id,a]));
const stats:StatKey[]=['hp','atk','def','spa','spd','speed'];
export const hasAugment = (p: Pick<Player,'augments'>|undefined, id:string):boolean => !!p?.augments?.includes(id);
const number = (id:string,key:string):number => Number((AUGMENT_MAP[id]?.params as Record<string,unknown>)?.[key]||0);
export const tierParam = (id:string,key:string,chapter:number):number => {
  const values=(AUGMENT_MAP[id]?.params as Record<string,unknown>)?.[key];
  return Array.isArray(values)?Number(values[Math.min(2,Math.max(0,chapter-1))]):Number(values||0);
};
const applicable=(id:string,chapter:number):boolean => {
  const v=AUGMENT_MAP[id]?.chapters;
  return !!v&&(v==='all'||v==='C1'&&chapter===1||v==='C2'&&chapter===2||v==='C3+'&&chapter>=3);
};
/** Select three distinct, currently legal cards; each choice has exactly one tier. */
/** A single rarity draw belongs to the chapter, not to each player. */
export function drawAugmentRarity(chapter:number,random:()=>number):AugmentRarity {
 const weights=config.chapterRarityWeights[String(chapter) as '1'|'2']||config.chapterRarityWeights['3+'];
 const groups=Object.entries(weights).filter(([rarity,weight])=>weight>0 && AUGMENTS.filter(a=>a.rarity===rarity&&applicable(a.id,chapter)).length>=3);
 if(!groups.length)throw Error(`Sem augments elegíveis para capítulo ${chapter}`);
 let draw=random()*groups.reduce((sum,[,weight])=>sum+weight,0);
 return (groups.find(([,weight])=>(draw-=weight)<0)||groups[groups.length-1])[0] as AugmentRarity;
}
export function offerAugments(player:Player,chapter:number,random:()=>number,rarity:AugmentRarity):AugmentChoice {
 const pool=AUGMENTS.filter(a=>a.rarity===rarity&&applicable(a.id,chapter)&&!hasAugment(player,a.id));
 if(pool.length<3)throw Error(`Sem três augments ${rarity} elegíveis para capítulo ${chapter}`);
 const remaining=[...pool];
 const offers=Array.from({length:3},()=>remaining.splice(Math.floor(random()*remaining.length),1)[0].id);
 return {chapter,rarity,offers,rerolled:[false,false,false],status:'pending'};
}
export function rerollAugment(choice:AugmentChoice,player:Player,slot:number,random:()=>number):string|null {
 if(choice.status!=='pending'||!Number.isInteger(slot)||slot<0||slot>2||choice.rerolled[slot])return 'Reroll indisponível';
 const candidates=AUGMENTS.filter(a=>a.rarity===choice.rarity&&applicable(a.id,choice.chapter)
   &&!hasAugment(player,a.id)&&!choice.offers.includes(a.id));
 if(!candidates.length)return 'Nenhum aprimoramento alternativo nesta raridade';
 choice.offers[slot]=candidates[Math.floor(random()*candidates.length)].id;
 choice.rerolled[slot]=true;return null;
}
export function bonusTraits(base:Partial<Record<Element,number>>,ids:readonly string[]):Partial<Record<Element,number>> {
 const result={...base};
 const order=(Object.keys(base) as Element[]).filter(k=>(base[k]||0)>0)
   .sort((a,b)=>(base[b]||0)-(base[a]||0)||a.localeCompare(b));
 // Winners are decided from unmodified counts to prevent self-referential selection.
 if(ids.includes('G04')&&order[0])result[order[0]]=(result[order[0]]||0)+number('G04','bonus');
 if(ids.includes('P04'))for(const key of order.slice(0,number('P04','top')))result[key]=(result[key]||0)+number('P04','bonus');
 if(ids.includes('P08')&&order[0])result[order[0]]=(result[order[0]]||0)+number('P08','bonus');
 return result;
}
function addIv(pokemon:Pokemon,value:number,keys:StatKey[]=stats):void {for(const key of keys)pokemon.iv[key]=Math.min(100,pokemon.iv[key]+value);}
function floorIv(pokemon:Pokemon,value:number):void {for(const key of stats)pokemon.iv[key]=Math.max(pokemon.iv[key],value);}
function lowest(pokemon:Pokemon,count:number):StatKey[] {return [...stats].sort((a,b)=>pokemon.iv[a]-pokemon.iv[b]||stats.indexOf(a)-stats.indexOf(b)).slice(0,count);}
export function addLevels(pokemon:Pokemon,levels:number):void {const cap=SPECIES[pokemon.family].babyEvolution ? RULES.baby.levelCap : RULES.maxPokemonLevel;pokemon.xp=Math.max(pokemon.xp,pokemon.level-1);pokemon.xp=Math.min(cap-1,pokemon.xp+levels);pokemon.level=Math.min(cap,1+pokemon.xp);}
export function evolveIv(pokemon:Pokemon):void {pokemon.appliedAugments ||= [];pokemon.acquiredChapter ||= 1;}
/** Runs for an acquired Pokémon, not for each render/snapshot; markers survive merger. */
export function applyPokemonAugments(player:Player,pokemon:Pokemon,chapter:number):void {
 pokemon.appliedAugments ||= [];
 const done=(id:string)=>pokemon.appliedAugments!.includes(id);
 const mark=(id:string)=>pokemon.appliedAugments!.push(id);
 for(const id of player.augments||[]){
  if(done(id))continue;
  if(id==='B03')addIv(pokemon,number(id,'iv'),lowest(pokemon,1));
  if(id==='S03')addIv(pokemon,number(id,'iv'));
  if(id==='G03'||id==='P02')floorIv(pokemon,number(id,'floor'));
  if(id==='G06'&&pokemon.stage===0)continue;
  if(id==='G06'&&pokemon.stage>0)addIv(pokemon,number(id,'iv'));
  if(id==='P03')addLevels(pokemon,tierParam(id,'levels',player.augmentChosenChapters?.[id]||chapter));
  if(id==='P12')addLevels(pokemon,number(id,'levels'));
  if((id==='B10'||id==='S10'||id==='G10'||id==='P10') && pokemon.acquiredChapter===1){
   if(id==='S10')floorIv(pokemon,number(id,'floor'));
   if(id==='P10')addIv(pokemon,number(id,'iv'));
   if(id==='B10'){
    player.augmentCounters||={};const current=player.augmentCounters[id]||0;
    if(current<number(id,'count')){addIv(pokemon,number(id,'iv'));player.augmentCounters[id]=current+1;}
   }
  }
  mark(id);
 }
}
export function applyEvolutionAugments(player:Player,pokemon:Pokemon,chapter:number):void {
 // Evolved form inherits existing effects and gets only the evolved-family bonus.
 pokemon.appliedAugments ||= [];
 if(pokemon.stage>0&&hasAugment(player,'G06')&&!pokemon.appliedAugments.includes('G06')){
   addIv(pokemon,number('G06','iv'));pokemon.appliedAugments.push('G06');
 }
 applyPokemonAugments(player,pokemon,chapter);
}
export function interestCap(ids:readonly string[]):number {return Math.max(RULES.maxInterest,ids.includes('G09')?number('G09','interestCap'):0,ids.includes('P09')?number('P09','interestCap'):0);}
export function battleExperience(player:Player,pokemon:Pokemon):number {
 let xp=pokemon.position.area==='board'?RULES.pokemonExperience.activePerBattle:RULES.pokemonExperience.benchPerBattle;
 for(const id of player.augments||[]){
  const p=AUGMENT_MAP[id]?.params as Record<string,unknown>;
  xp+=Number((pokemon.position.area==='board'?p?.activeXp:p?.benchXp)||0);
 }
 if(pokemon.acquiredChapter===1){if(hasAugment(player,'G10'))xp+=number('G10','xp');if(hasAugment(player,'P10'))xp+=number('P10','xp');}
 return xp;
}
export function immediateAugment(player:Player,id:string,chapter:number,random:()=>number,nextId:()=>string):void {
 const params=AUGMENT_MAP[id]?.params as Record<string,any>;
 if(params.gold)player.gold+=tierParam(id,'gold',chapter);
 if(params.payments)player.gold+=Number(params.payments[String(chapter)]||0);
 if(params.components){player.itemInventory||=[];for(let i=0;i<params.components;i++){
  const component=makeComponent(nextId(),ITEM_COLORS[Math.floor(random()*ITEM_COLORS.length)]);
  if(player.itemInventory.length<ITEMS.inventorySlots)player.itemInventory.push(component);
  else (player.pendingItems||=[]).push(component);
 }}
 if(params.items){
  const keys=Object.keys(RECIPES);
  const recipe=keys[Math.floor(random()*keys.length)];
  const item={id:nextId(),kind:'complete' as const,components:recipe.split('+') as import('../types').ItemColor[],recipe};
  if((player.itemInventory||[]).length<ITEMS.inventorySlots)(player.itemInventory||=[]).push(item);
  else(player.pendingItems||=[]).push(item);
 }
 if(params.ultraball){player.consumables||={pokeball:0,greatball:0,ultraball:0,masterball:0};player.consumables.ultraball+=params.ultraball;}
 if(id==='B11'){for(const p of player.units)addLevels(p,number('B11','levels'));}
 if(id==='G11'||id==='S02'){
  const credit=player.augmentCounters||={};
  const promised=number(id,'trainerXp');
  const previous=credit['precipitado:xp']||0;
  grantTrainerXp(player,Math.max(0,promised-previous));
  credit['precipitado:xp']=Math.max(previous,promised);
 }
 if(id==='P03'||id==='P12'||id==='G06'||id==='B03'||id==='S03'||id==='G03'||id==='P02')for(const p of player.units)applyPokemonAugments(player,p,chapter);
}
export function chapterPayment(player:Player,chapter:number):void {
 for(const id of ['B09','S09'])if(hasAugment(player,id)) {
  const key=`payment:${id}:${chapter}`;
  player.augmentEvents||=[];
  if(!player.augmentEvents.includes(key)) {player.gold+=Number(((AUGMENT_MAP[id]?.params as any).payments||{})[String(chapter)]||0);player.augmentEvents.push(key);}
 }
}
export function startedPreparation(player:Player):void {
 if(!hasAugment(player,'B02')||!player.augmentCounters)return;
 const used=player.augmentCounters['B02:preparations']||0;
 if(used<number('B02','preparations')){player.augmentCounters['B02:preparations']=used+1;player.augmentCounters['B02:bought']=0;player.augmentCounters['B02:free']=0;}
 else player.augmentCounters['B02:free']=0;
}
export function purchasedPokemon(player:Player):void {
 if(!hasAugment(player,'B02')||!player.augmentCounters)return;
 const c=player.augmentCounters;
 if((c['B02:preparations']||0)>0&&(c['B02:preparations']||0)<=number('B02','preparations') &&!c['B02:bought']){
  c['B02:bought']=1;c['B02:free']=number('B02','rolls');
 }
}
/** Called once after the synergy initialization, on simulation-owned combat units. */
export function beginCombatAugments(battle:Battle):void {
 for(const unit of battle.units){
  const ids=battle.augmentsByPlayer?.[unit.playerId]||[];
  const s=unit.synergy;if(!s)continue;
  if(ids.includes('B07')&&unit.equipment.length>=number('B07','items'))s.percents.durability=(s.percents.durability||0)+number('B07','durability');
  if(ids.includes('S12')&&unit.level>=number('S12','level')){s.percents.durability=(s.percents.durability||0)+number('S12','durability');s.percents.amplification=(s.percents.amplification||0)+number('S12','amplification');}
  if(ids.includes('G12')&&unit.level>=number('G12','level')){s.percents.durability=(s.percents.durability||0)+number('G12','durability');s.percents.amplification=(s.percents.amplification||0)+number('G12','amplification');}
  if(ids.includes('G08')){s.percents.critChance=(s.percents.critChance||0)+number('G08','critChance');s.percents.critDamage=(s.percents.critDamage||0)+number('G08','critDamage');s.flags.augmentSpellCritical=true;}
  if(ids.includes('B06'))unit.energy=Math.max(unit.energy,number('B06','energy'));
  if(ids.includes('P05'))unit.energy=Math.max(unit.energy,Math.ceil(unit.energyNeeded*number('P05','fraction')));
  unit.energy=Math.min(unit.energyNeeded,unit.energy);
 }
}
export function onAugmentCast(battle:Battle,source:CombatUnit):void {
 const ids=battle.augmentsByPlayer?.[source.playerId]||[];
 if(!ids.includes('S05'))return;
 const key='augment:S05';if((source.itemTimers[key]||0)>battle.elapsed)return;
 source.itemTimers[key]=battle.elapsed+number('S05','cooldown');
 const receiver=battle.units.filter(u=>u.playerId===source.playerId&&u.hp>0&&u.id!==source.id)
  .sort((a,b)=>a.energy-b.energy||a.id.localeCompare(b.id))[0];
 if(receiver&&!blocksEnergy(receiver,battle.elapsed))receiver.energy=Math.min(receiver.energyNeeded,receiver.energy+number('S05','energy'));
}
export function onAugmentBasic(battle:Battle,source:CombatUnit):void {
 if(!(battle.augmentsByPlayer?.[source.playerId]||[]).includes('B08'))return;
 const attacks=(source.itemStacks['augment:B08']||0)+1;source.itemStacks['augment:B08']=attacks;
 if(attacks%number('B08','every')===0)(!blocksEnergy(source,battle.elapsed) && (source.energy=Math.min(source.energyNeeded,source.energy+number('B08','energy'))));
}
export function onAugmentDamage(battle:Battle,target:CombatUnit):void {
 const ids=battle.augmentsByPlayer?.[target.playerId]||[];
 const s=target.synergy;if(!s||target.hp<=0)return;
 if(ids.includes('S06')&&target.hp/target.maxHp<number('S06','threshold')&&!s.flags['augment:S06']){
  s.flags['augment:S06']=true;s.percents.durability=(s.percents.durability||0)+number('S06','durability');
 }
}
export function onAugmentDeath(battle:Battle,target:CombatUnit):void {
 const ids=battle.augmentsByPlayer?.[target.playerId]||[];
 if(!ids.includes('P06'))return;
 const ally=battle.units.filter(u=>u.playerId===target.playerId&&u.hp>0&&u!==target)
  .sort((a,b)=>b.level-a.level||a.id.localeCompare(b.id))[0];
 if(!ally||!ally.synergy)return;
 const s=ally.synergy;const stacks=s.timers['augment:P06']||0;
 if(stacks>=number('P06','stacks'))return;
 s.timers['augment:P06']=stacks+1;
 for(const key of ['atk','def','spa','spd','speed'] as StatKey[])s.inherit[key]=(s.inherit[key]||0)+target.stats[key]*number('P06','fraction');
}
export function tickCombatAugments(battle:Battle,heal:(battle:Battle,unit:CombatUnit,amount:number,source?:CombatUnit)=>unknown,
 effect:(battle:Battle,source:CombatUnit,target:CombatUnit,kind:any,value:number)=>unknown):void {
 const idsByPlayer=battle.augmentsByPlayer||{};
 for(const playerId of battle.participants){
  const ids=idsByPlayer[playerId]||[];
  const allies=battle.units.filter(u=>u.hp>0&&u.playerId===playerId);
  if(!allies.length)continue;
  if(ids.includes('B05'))for(const unit of allies){
   const key='augment:B05';if(!unit.itemTimers[key])unit.itemTimers[key]=number('B05','interval');
   if(unit.itemTimers[key]<=battle.elapsed){
    unit.itemTimers[key]=battle.elapsed+number('B05','interval');heal(battle,unit,unit.maxHp*number('B05','fraction'),unit);
   }
  }
  if(ids.includes('G05')){
   const key=`augment:G05:${playerId}`;
   battle.augmentTimers ||= {};
   if((battle.augmentTimers[key]||number('G05','interval'))<=battle.elapsed){
    battle.augmentTimers[key]=battle.elapsed+number('G05','interval');
    const target=[...allies].sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id.localeCompare(b.id))[0];
    target.barriers.push({sourceId:key,hp:target.maxHp*number('G05','fraction'),until:battle.elapsed+number('G05','duration'),kind:'item'});
    effect(battle,target,target,'shield',target.maxHp*number('G05','fraction'));
   }
  }
  for(const unit of allies){
   const s=unit.synergy;if(!s)continue;
   const active=ids.includes('B12')&&unit.level>=number('B12','level')&&unit.hp/unit.maxHp<number('B12','threshold');
   const key='augment:B12';const previous=!!s.flags[key];
   if(previous!==active){s.flags[key]=active;s.percents.durability=(s.percents.durability||0)+(active?1:-1)*number('B12','durability');}
  }
 }
}
