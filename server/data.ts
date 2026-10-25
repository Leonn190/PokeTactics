import pokemonConfig from '../config/pokemons.json';
import movesConfig from '../config/ataques.json';
import phaseConfig from '../config/fases.json';
import rulesConfig from '../config/regras_gerais.json';
import type { Element, Family, Rarity, StageType, Stats } from './types';

export interface SpeciesData {
  names: string[];
  pokedexIds: number[];
  rarity: Rarity;
  shop: boolean;
  shape: 'circle' | 'square' | 'triangle' | 'crystal';
  color: string;
  glow: string;
  base: Stats;
  range: number;
  energy: number;
  attack: string;
  ability: string;
  elements: Element[];
  sprites: string[];
}

export type MoveData = {
  name: string; effect: 'drain' | 'burn' | 'slow' | 'chain' | 'blast';
  baseDamage: number; attackRatio?: number; specialRatio: number;
  healBase?: number; healRatio?: number; dotBase?: number; dotRatio?: number;
  dotDuration?: number; slowDuration?: number; chainBase?: number;
  chainRatio?: number; chainRange?: number;
};

export const ATTACKS = movesConfig as unknown as {
  basic: { name: string; damageBase: number; physicalAttackRatio: number; energyGain: number };
  moves: Record<string, MoveData>;
};
export const RULES = rulesConfig;
export const PHASES = phaseConfig as unknown as {
  stagesPerChapter: number;
  stages: Array<{ type: StageType; name: string }>;
  bot: { baseLevel: number; levelsPerChapter: number; extraUnitsEveryChapter: number; maxUnits: number; iv: number };
  boss: { levelPerChapter: number; firstChapterIv: number; secondChapterIv: number; laterChapterIv: number };
};

export const SPECIES = Object.fromEntries(Object.entries(pokemonConfig.species).map(([family, species]) => [
  family, {
    ...species,
    ability: ATTACKS.moves[species.attack].name,
    sprites: pokemonConfig.sprites[family as keyof typeof pokemonConfig.sprites] || species.pokedexIds.map(id => `${pokemonConfig.spriteBaseUrl}/${id}.png`)
  }
])) as Record<Family, SpeciesData>;

export const SHOP_FAMILIES = (Object.keys(SPECIES) as Family[]).filter(f => SPECIES[f].shop);
export const LEGENDARY_FAMILIES = (Object.keys(SPECIES) as Family[]).filter(f => !SPECIES[f].shop);

export const ELEMENTS: Record<Element, { name: string; color: string; description: string }> = {
  grass: { name: 'Planta', color: '#81d9a2', description: 'Regeneração de vida' },
  poison: { name: 'Venenoso', color: '#c38aff', description: 'Ataques aplicam veneno' },
  fire: { name: 'Fogo', color: '#ff8a5f', description: 'Ataques mais fortes' },
  water: { name: 'Água', color: '#77bfff', description: 'Mais resistência' },
  electric: { name: 'Elétrico', color: '#f9d769', description: 'Mais velocidade' },
  ice: { name: 'Gelo', color: '#a7edff', description: 'Tipo de chefe lendário' },
  flying: { name: 'Voador', color: '#a9d1fa', description: 'Tipo de chefe lendário' },
  psychic: { name: 'Psíquico', color: '#f2b4e5', description: 'Tipo de chefe lendário' }
};

export const RARITY_COLORS = ['#76848c', '#8cd0a5', '#76b4ec', '#ce91f4', '#f0bd67'];
export const BENCH_SIZE = RULES.benchSize;
export const SHOP_SIZE = RULES.shopSize;
export const BOARD_COLUMNS = RULES.boardColumns;
export const BOARD_ROWS = RULES.boardRows;

/** Níveis além de 100 são intencionais: chefes PvE continuam escalando a cada capítulo. */
export function calculateStats(family: Family, level: number, iv: Stats, stage: number): Stats {
  const base = SPECIES[family].base;
  const formula = RULES.statFormula;
  const levelScale = 1 + Math.max(0, level - 1) * formula.levelPerPoint;
  const evolutionScale = formula.evolutionMultipliers[Math.min(formula.evolutionMultipliers.length - 1, stage)] || 1;
  return Object.fromEntries((Object.keys(base) as Array<keyof Stats>).map(key => [
    key, Math.round(base[key] * (formula.ivBase + Math.max(0, Math.min(100, iv[key])) * formula.ivPerPoint) * levelScale * evolutionScale)
  ])) as unknown as Stats;
}

export function displayName(family: Family, stage: number): string {
  return SPECIES[family].names[Math.min(SPECIES[family].names.length - 1, stage)];
}

export function gridXY(col: number, row: number): { x: number; y: number } {
  return { x: (col - 3) * 1.04 + (row % 2 ? 0.26 : -0.26), y: (row - 3.5) * 0.91 };
}
