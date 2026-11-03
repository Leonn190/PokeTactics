import { bonusTraits } from '../augments';
import { getStageData, SPECIES } from '../../data';
import type { Element, Family, Player } from '../../types';

/** Family identity is shared by all stages, regional forms, babies and Eevee branches. */
export function traitFamily(family:Family):string {
  const species=SPECIES[family];
  if(species.babyEvolution)return species.babyEvolution;
  if(species.eeveeBranch)return 'eevee';
  if(family==='hitmonchan'||family==='hitmonlee')return 'tyrogue';
  return family;
}

/** A family contributes at most once PER type; stage/form-specific types are unioned. */
export function countTraits(player:Player):Partial<Record<Element,number>> {
  const contributors=new Map<Element,Set<string>>();
  for(const pokemon of player.units){
    if(pokemon.position.area!=='board')continue;
    for(const type of new Set(getStageData(pokemon.family,pokemon.stage,pokemon.formId).elements)){
      if(!contributors.has(type))contributors.set(type,new Set());
      contributors.get(type)!.add(traitFamily(pokemon.family));
    }
  }
  const counts:Partial<Record<Element,number>>={};
  for(const [type,families] of contributors)counts[type]=families.size;
  return bonusTraits(counts,player.augments||[]);
}
