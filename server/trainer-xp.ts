/** Experiência do treinador: independente da experiência dos Pokémon e da rodada. */
import { RULES } from './data';
import type { Player } from './types';
const config=RULES.trainerProgression;
export function trainerXpNeeded(level:number):number {
 return level>=config.maxLevel?0:(config.xpToNextLevel[level-1]??0);
}
export function grantTrainerXp(player:Player,xp:number):void {
 if(!Number.isFinite(xp)||xp<=0||player.level>=config.maxLevel)return;
 player.trainerXp+=xp;
 while(player.level<config.maxLevel){
  const needed=trainerXpNeeded(player.level);
  if(needed<=0||player.trainerXp<needed)break;
  player.trainerXp-=needed;player.level++;
 }
 if(player.level===config.maxLevel)player.trainerXp=0;
}
export function buyTrainerXp(player:Player):boolean {
 if(player.eliminated||player.level>=config.maxLevel||player.gold<config.buyXpCost)return false;
 player.gold-=config.buyXpCost;
 grantTrainerXp(player,config.buyXpAmount);
 return true;
}
