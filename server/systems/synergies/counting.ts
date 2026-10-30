import { bonusTraits } from '../augments';
import { getStageData } from '../../data';
import type { Element,Player } from '../../types';
/** Distinct deployed forms; duplicates and benches never grant additional traits. */
export function countTraits(player:Player):Partial<Record<Element,number>> {
  const unique=new Set<string>(),result:Partial<Record<Element,number>>={};
  for(const pokemon of player.units){
    if(pokemon.position.area!=='board')continue;
    const key=`${pokemon.family}:${pokemon.stage}`;
    if(unique.has(key))continue;
    unique.add(key);
    for(const element of getStageData(pokemon.family,pokemon.stage).elements) result[element]=(result[element]||0)+1;
  }
  return bonusTraits(result,player.augments||[]);
}
