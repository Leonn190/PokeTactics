import type { Element } from '../types';

// Matriz ofensiva dos tipos presentes no elenco, baseada nos confrontos dos jogos.
// Modificador final: metade da distância para 1×, sem imunidades.
const matchup: Record<Element, { strong: Element[]; resisted: Element[] }> = {
  ghost: { strong:['ghost','psychic'], resisted:['dark','normal'] },
  dragon: { strong: ['dragon'], resisted: ['steel','fairy'] },
  grass: { strong: ['water'], resisted: ['fire', 'grass', 'poison', 'flying'] },
  poison: { strong: ['grass'], resisted: ['poison'] },
  fire: { strong: ['grass', 'ice'], resisted: ['fire', 'water'] },
  water: { strong: ['fire'], resisted: ['water', 'grass'] },
  electric: { strong: ['water', 'flying'], resisted: ['electric', 'grass'] },
  ice: { strong: ['grass', 'flying'], resisted: ['fire', 'water', 'ice'] },
  flying: { strong: ['grass'], resisted: ['electric'] },
  fighting: { strong: ['normal','rock','steel','ice','dark'], resisted: ['flying','poison','bug','psychic','fairy','ghost'] },
  psychic: { strong: ['poison'], resisted: ['psychic'] },
  bug: { strong: ['grass', 'psychic'], resisted: ['fire', 'flying', 'poison'] },
  normal: { strong: [], resisted: ['rock','steel'] },
  ground: { strong: ['fire','electric','poison','rock','steel'], resisted: ['grass','bug','flying'] },
  rock: { strong: ['fire','ice','flying','bug'], resisted: ['ground','steel'] },
  steel: { strong: ['ice','rock','fairy'], resisted: ['fire','water','electric','steel'] },
  dark: { strong: ['psychic'], resisted: ['dark','fairy'] },
  fairy: { strong: ['dark'], resisted: ['fire','poison','steel'] }
};

export function chargedEffectiveness(attackType: Element, defenseTypes: readonly Element[]): number {
  const info = matchup[attackType];
  const classic = defenseTypes.reduce((factor, type) => factor *
    (info.strong.includes(type) ? 2 : info.resisted.includes(type) ? .5 : 1), 1);
  return classic >= 1 ? 1 + (classic - 1) / 2 : 1 - (1 - classic) / 2;
}
