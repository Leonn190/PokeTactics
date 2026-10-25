import type { Element } from '../types';

// Matriz ofensiva dos tipos presentes no elenco, baseada nos confrontos dos jogos.
// Modificador final: metade da distância para 1×, sem imunidades.
const matchup: Record<Element, { strong: Element[]; resisted: Element[] }> = {
  grass: { strong: ['water'], resisted: ['fire', 'grass', 'poison', 'flying'] },
  poison: { strong: ['grass'], resisted: ['poison'] },
  fire: { strong: ['grass', 'ice'], resisted: ['fire', 'water'] },
  water: { strong: ['fire'], resisted: ['water', 'grass'] },
  electric: { strong: ['water', 'flying'], resisted: ['electric', 'grass'] },
  ice: { strong: ['grass', 'flying'], resisted: ['fire', 'water', 'ice'] },
  flying: { strong: ['grass'], resisted: ['electric'] },
  psychic: { strong: ['poison'], resisted: ['psychic'] }
};

export function chargedEffectiveness(attackType: Element, defenseTypes: readonly Element[]): number {
  const info = matchup[attackType];
  const classic = defenseTypes.reduce((factor, type) => factor *
    (info.strong.includes(type) ? 2 : info.resisted.includes(type) ? .5 : 1), 1);
  return classic >= 1 ? 1 + (classic - 1) / 2 : 1 - (1 - classic) / 2;
}
