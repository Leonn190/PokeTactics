import type { Element, Family, Rarity, Stats } from './types';

export interface SpeciesData {
  family: Family;
  names: string[];
  shape: 'circle' | 'square' | 'triangle' | 'crystal';
  color: string;
  glow: string;
  rarity: Rarity;
  base: Stats;
  range: number;
  energy: number;
  ability: string;
  elements: Element[];
}

export const SPECIES: Record<Family, SpeciesData> = {
  bulbasaur: {
    family: 'bulbasaur', names: ['Bulbasaur', 'Ivysaur', 'Venusaur'],
    shape: 'circle', color: '#72dcb1', glow: '#38f0a5', rarity: 1,
    base: { hp: 45, speed: 45, atk: 49, def: 49, spa: 65, spd: 65 },
    range: 1.55, energy: 40, ability: 'Chicote de Vinha', elements: ['grass', 'poison']
  },
  charmander: {
    family: 'charmander', names: ['Charmander', 'Charmeleon', 'Charizard'],
    shape: 'square', color: '#ffab75', glow: '#ff714c', rarity: 1,
    base: { hp: 39, speed: 65, atk: 52, def: 43, spa: 60, spd: 50 },
    range: 2.25, energy: 35, ability: 'Brasas', elements: ['fire']
  },
  squirtle: {
    family: 'squirtle', names: ['Squirtle', 'Wartortle', 'Blastoise'],
    shape: 'triangle', color: '#82c8fc', glow: '#5aa8ff', rarity: 2,
    base: { hp: 44, speed: 43, atk: 48, def: 65, spa: 50, spd: 64 },
    range: 2.35, energy: 50, ability: 'Jato d’Água', elements: ['water']
  },
  pikachu: {
    family: 'pikachu', names: ['Pikachu', 'Raichu'],
    shape: 'crystal', color: '#ffe17b', glow: '#f8cb4d', rarity: 3,
    base: { hp: 35, speed: 90, atk: 55, def: 40, spa: 50, spd: 50 },
    range: 3.05, energy: 45, ability: 'Choque do Trovão', elements: ['electric']
  }
};

export const ELEMENTS: Record<Element, { name: string; color: string; description: string }> = {
  grass: { name: 'Planta', color: '#81d9a2', description: 'Regeneração de vida' },
  poison: { name: 'Venenoso', color: '#c38aff', description: 'Ataques aplicam veneno' },
  fire: { name: 'Fogo', color: '#ff8a5f', description: 'Ataques mais fortes' },
  water: { name: 'Água', color: '#77bfff', description: 'Mais resistência' },
  electric: { name: 'Elétrico', color: '#f9d769', description: 'Mais velocidade' }
};

export const RARITY_COLORS = ['#76848c', '#8cd0a5', '#76b4ec', '#ce91f4', '#f0bd67'];
export const BENCH_SIZE = 10;
export const SHOP_SIZE = 6;
export const BOARD_COLUMNS = 7;
export const BOARD_ROWS = 4;

/** IV 0 -> 0.8x, IV 50 -> 1x, IV 100 -> 1.2x. Level 100 -> 6x the level-0 value. */
export function calculateStats(family: Family, level: number, iv: Stats, stage: number): Stats {
  const base = SPECIES[family].base;
  const levelScale = 1 + Math.min(100, Math.max(0, level)) * 0.05;
  const evolutionScale = [1, 1.45, 2.1][Math.min(2, stage)] || 1;
  return Object.fromEntries((Object.keys(base) as Array<keyof Stats>).map(key => [
    key, Math.round(base[key] * (0.8 + Math.max(0, Math.min(100, iv[key])) * 0.004) * levelScale * evolutionScale)
  ])) as unknown as Stats;
}

export function displayName(family: Family, stage: number): string {
  return SPECIES[family].names[Math.min(SPECIES[family].names.length - 1, stage)];
}

export function gridXY(col: number, row: number): { x: number; y: number } {
  return { x: (col - 3) * 1.04 + (row % 2 ? 0.52 : 0), y: (row - 3.5) * 0.91 };
}
