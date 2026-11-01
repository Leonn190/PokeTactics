/** Seeded loot tables. Weights are normalized for every color independently. */
import settings from '../../config/espolios.json';
import { ITEM_COLORS } from './items';
import { MEGA } from '../forms';
import { SHOP_FAMILIES, SPECIES } from '../data';
import type { Family, ItemColor, LootColor, LootReward, Rarity, StageType, BallKind } from '../types';
export const LOOT = settings;
export const LOOT_COLORS: LootColor[] = ['gray','blue','yellow'];
export function weighted<T extends {weight: number}>(items: readonly T[], random:()=>number): T {
  const total = items.reduce((sum,x)=>sum+Math.max(0,x.weight),0);
  if (!items.length || total <= 0) throw Error('Tabela de espólios sem pesos válidos');
  let draw=random()*total;
  for (const entry of items) { draw -= Math.max(0,entry.weight); if (draw < 0) return entry; }
  return items[items.length-1];
}
export function eligibleForLoot(type: StageType): boolean { return LOOT.enabled && (LOOT.eligibleTypes as string[]).includes(type); }
export function rollColor(random:()=>number, chapter: number): LootColor {
  const byChapter = (LOOT.chapterModifiers as Record<string,{ colors?:Record<string,number> }>)[String(chapter)];
  const weights=byChapter?.colors || LOOT.colors;
  return weighted(LOOT_COLORS.map(color=>({ color,weight:weights[color] || 0 })),random).color;
}
export function rollReward(color: LootColor, random:()=>number): LootReward {
  if(random()<(MEGA.lootChance[color]||0))return {kind:'mega-stone'};
  const reward=weighted(LOOT.rolls[color],random);
  const bonus=LOOT.ballBonusChance[color] as Record<string,number>;
  const ball=Object.entries(bonus).find(([,chance])=>random()<chance)?.[0] as BallKind | undefined;
  let result:LootReward;
  if (reward.kind === 'gold') result = { kind:'gold', amount:reward.min!+Math.floor(random()*(reward.max!-reward.min!+1)) };
  else if (reward.kind === 'component') result = {kind:'component',color:ITEM_COLORS[Math.floor(random()*ITEM_COLORS.length)] as ItemColor};
  else {
    const pool=SHOP_FAMILIES.filter(f=>SPECIES[f].rarity===reward.rarity);
    // Legendary Mew is legitimately obtained from legendary rewards, even when not in the shop.
    const legendary=(Object.keys(SPECIES) as Family[]).filter(f=>SPECIES[f].rarity===5);
    const candidates = pool.length ? pool : reward.rarity===5 ? legendary : [];
    result = candidates.length ? {kind:'pokemon',family:candidates[Math.floor(random()*candidates.length)],rarity:reward.rarity as Rarity} : {kind:'gold',amount:1};
  }
  if (ball) result.bonusBall=ball;
  return result;
}
