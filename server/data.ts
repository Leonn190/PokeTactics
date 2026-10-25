import pokemonConfig from '../config/pokemons.json';
import movesConfig from '../config/ataques.json';
import phaseConfig from '../config/fases.json';
import rulesConfig from '../config/regras_gerais.json';
import type { Element, Family, Rarity, StageType, Stats } from './types';

export type BasicAttackData = { stat: 'atk' | 'spa'; category: 'physical' | 'special'; animation: string; projectile?: 'seed' | 'lightning' | 'spell' };
export type StageData = { elements: Element[]; range: number; energy: number; move: string; chargedType: Element; chargedAnimation: string; basic: BasicAttackData };
export interface SpeciesData {
  names: string[];
  pokedexIds: number[];
  rarity: Rarity;
  shop: boolean;
  glow: string;
  base: Stats;
  range: number;
  energy: number;
  attack: string;
  ability: string;
  elements: Element[];
  sprites: string[];
  stageBases?: Stats[];
  bossOnly?: boolean;
  eeveeBranch?: boolean;
  basic?: BasicAttackData;
  stages?: Partial<Omit<StageData, 'basic'>>[];
}

export type MoveData = {
  name: string; effect: 'drain' | 'burn' | 'slow' | 'chain' | 'blast' | 'pollen' | 'spin' | 'flame-strike' | 'shock' | 'poison-shot' | 'heal-powder' | 'sting' | 'shield' | 'multi' | 'gas' | 'stomp' | 'eevee-ball' | 'bone-throw' | 'single-knockup' | 'rock-strike' | 'withdraw-guard' | 'healing-egg' | 'rock-charge' | 'piercing-fire';
  baseDamage: number; attackRatio?: number; specialRatio: number;
  healBase?: number; healRatio?: number; dotBase?: number; dotRatio?: number;
  dotDuration?: number; slowDuration?: number; chainBase?: number;
  chainRatio?: number; chainRange?: number;
  damageByStage?: number[]; healByStage?: number[]; damageRatioByStage?: number[];
  splashRange?: number; shieldByStage?: number[]; seconds?: number;
  secondsPerSpA?: number; durationSpaStep?: number;
  secondaryRatioByStage?: number[]; secondaryTargetsByStage?: number[];
  healRange?: number; healTargets?: number; shieldBase?: number; shieldDefenseRatio?: number;
  shieldDuration?: number; hits?: number; attackRatioByStage?: number[]; radiusByStage?: number[];
  jumpRange?: number; stunDuration?: number;
  splashMultiplier?: number;
  conversion?: { kind: 'none' | 'stat_buff' | 'heal' | 'barrier'; stat?: 'atk' | 'def' | 'spa' | 'spd' | 'speed'; points_per_damage_per_ally?: number; duration_seconds?: number; healing_pool_per_damage?: number; shield_pool_per_damage?: number; max_barrier_fraction_of_target_max_hp?: number };
  shredBase?: number; shredRatio?: number; shredDuration?: number; controlDuration?: number;
  skillRange?: number; guardDuration?: number; guardReduction?: number;
};

export const ATTACKS = movesConfig as unknown as {
  basic: { name: string; offensiveRatio: number; energyGain: number };
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

/** Configuração do estágio; ao contrário da configuração anterior não assume um carregado para toda a família. */
export function getStageData(family: Family, stage: number): StageData {
  const species = SPECIES[family];
  const override = species.stages?.[Math.min(Math.max(0, stage), species.names.length - 1)] || {};
  return {
    elements: override.elements || species.elements,
    range: override.range ?? species.range,
    energy: override.energy ?? species.energy,
    move: override.move || species.attack,
    chargedType: override.chargedType || species.elements[0],
    chargedAnimation: override.chargedAnimation || 'Attack',
    basic: species.basic || { stat: 'atk', category: 'physical', animation: 'Attack' }
  };
}

export const SHOP_FAMILIES = (Object.keys(SPECIES) as Family[]).filter(f => SPECIES[f].shop);
export const LEGENDARY_FAMILIES = (Object.keys(SPECIES) as Family[]).filter(f => SPECIES[f].bossOnly);
export const EEVEE_BRANCHES = ['vaporeon','flareon','jolteon','umbreon','sylveon','leafeon','glaceon','espeon'] as Family[];

export const ELEMENTS: Record<Element, { name: string; color: string; description: string }> = {
  grass: { name: 'Planta', color: '#81d9a2', description: 'Sem bônus de sinergia por enquanto' },
  poison: { name: 'Venenoso', color: '#c38aff', description: 'Sem bônus de sinergia por enquanto' },
  fire: { name: 'Fogo', color: '#ff8a5f', description: 'Sem bônus de sinergia por enquanto' },
  water: { name: 'Água', color: '#77bfff', description: 'Sem bônus de sinergia por enquanto' },
  electric: { name: 'Elétrico', color: '#f9d769', description: 'Sem bônus de sinergia por enquanto' },
  ice: { name: 'Gelo', color: '#a7edff', description: 'Tipo de chefe lendário' },
  flying: { name: 'Voador', color: '#a9d1fa', description: 'Tipo de chefe lendário' },
  psychic: { name: 'Psíquico', color: '#f2b4e5', description: 'Tipo de chefe lendário' }
  ,bug: { name: 'Inseto', color: '#a8c75b', description: 'Sem bônus de sinergia por enquanto' }
  ,normal: { name: 'Normal', color: '#b4bab5', description: 'Sem bônus de sinergia por enquanto' },
  ground: { name: 'Terrestre', color: '#cfad78', description: 'Sem bônus de sinergia por enquanto' },
  rock: { name: 'Pedra', color: '#ae997b', description: 'Sem bônus de sinergia por enquanto' },
  steel: { name: 'Aço', color: '#b4c7d2', description: 'Sem bônus de sinergia por enquanto' },
  dark: { name: 'Sombrio', color: '#9588b5', description: 'Sem bônus de sinergia por enquanto' },
  fairy: { name: 'Fada', color: '#f2aad3', description: 'Sem bônus de sinergia por enquanto' }
};

export const RARITY_COLORS = ['#76848c', '#8cd0a5', '#76b4ec', '#ce91f4', '#f0bd67'];
export const BENCH_SIZE = RULES.benchSize;
export const SHOP_SIZE = RULES.shopSize;
export const BOARD_COLUMNS = RULES.boardColumns;
export const BOARD_ROWS = RULES.boardRows;

/** Níveis além de 100 são intencionais: chefes PvE continuam escalando a cada capítulo. */
export function calculateStats(family: Family, level: number, iv: Stats, stage: number): Stats {
  const species = SPECIES[family];
  const base = species.stageBases?.[Math.min(Math.max(0, stage), species.stageBases.length - 1)] || species.base;
  const formula = RULES.statFormula;
  const levelScale = 1 + Math.max(0, level - 1) * formula.levelPerPoint;
  return Object.fromEntries((Object.keys(base) as Array<keyof Stats>).map(key => [
    key, Math.round(base[key] * (formula.ivBase + Math.max(0, Math.min(100, iv[key])) * formula.ivPerPoint) * levelScale)
  ])) as unknown as Stats;
}

export function displayName(family: Family, stage: number): string {
  return SPECIES[family].names[Math.min(SPECIES[family].names.length - 1, stage)];
}

export function gridXY(col: number, row: number): { x: number; y: number } {
  return { x: (col - 3) * 1.04 + (row % 2 ? 0.26 : -0.26), y: (row - 3.5) * 0.91 };
}
