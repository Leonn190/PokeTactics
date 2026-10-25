import { ELEMENTS, RULES, SHOP_FAMILIES, SPECIES } from './data';
import type { Element, Family, Player, Rarity } from './types';

/** Pontos são contados por Pokémon e por tipo, inclusive tipos duplos. */
export function typeInfluence(player: Pick<Player, 'units'>): { points: Partial<Record<Element, number>>; shares: Partial<Record<Element, number>>; total: number } {
  const points: Partial<Record<Element, number>> = {};
  for (const unit of player.units) {
    const weight = unit.position.area === 'board' ? RULES.typeShopBias.activePoints : RULES.typeShopBias.benchPoints;
    for (const type of SPECIES[unit.family].elements) points[type] = (points[type] || 0) + weight;
  }
  const total = Object.values(points).reduce((a, b) => a + b, 0);
  const shares: Partial<Record<Element, number>> = {};
  for (const type of Object.keys(points) as Element[]) shares[type] = total ? points[type]! / total : 0;
  return { points, shares, total };
}

/** Tipos duplos: maior bônus + 50% de cada bônus secundário. Ex.: 25% + 15%/2 = 32,5%. */
export function typeBonus(family: Family, shares: Partial<Record<Element, number>>): number {
  const bonuses = SPECIES[family].elements.map(type => (shares[type] || 0) * RULES.typeShopBias.shareBonusMultiplier)
    .sort((a, b) => b - a);
  return (bonuses[0] || 0) + bonuses.slice(1).reduce((sum, bonus) => sum + bonus * RULES.typeShopBias.secondaryTypeMultiplier, 0);
}

export function shopOdds(level: number): number[] {
  return RULES.shopOddsByLevel[Math.max(0, Math.min(RULES.shopOddsByLevel.length - 1, level - 1))];
}

/** Normaliza pesos informados (níveis 5/6 somam 101 por arredondamento). */
export function normalizedOdds(level: number): number[] {
  const weights = shopOdds(level);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => w / total);
}

/** Raridade sorteada primeiro; se não há espécies dela, redistribuímos pelos tiers presentes. */
export function rollFamily(player: Player, rand: () => number): { family: Family; rarity: Rarity } {
  const probabilities = normalizedOdds(player.level);
  const available = [...new Set(SHOP_FAMILIES.map(f => SPECIES[f].rarity))];
  const totalAvailable = available.reduce((sum, tier) => sum + probabilities[tier - 1], 0);
  const tiers = available.filter(t => probabilities[t - 1] > 0);
  const pool = tiers.length ? tiers : available;
  let draw = rand() * (totalAvailable || pool.length);
  let rarity = pool[pool.length - 1];
  for (const tier of pool) {
    draw -= totalAvailable ? probabilities[tier - 1] : 1;
    if (draw < 0) { rarity = tier; break; }
  }
  const families = SHOP_FAMILIES.filter(f => SPECIES[f].rarity === rarity);
  const shares = typeInfluence(player).shares;
  const weights = families.map(f => 1 + typeBonus(f, shares));
  let weighted = rand() * weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < families.length; i++) {
    weighted -= weights[i];
    if (weighted < 0) return { family: families[i], rarity };
  }
  return { family: families[families.length - 1], rarity };
}

export const elementOrder = () => Object.keys(ELEMENTS) as Element[];
