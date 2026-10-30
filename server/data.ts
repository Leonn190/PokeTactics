import augmentsConfig from '../config/augments.json';
import pokemonConfig from '../config/pokemons.json';
import movesConfig from '../config/ataques.json';
import phaseConfig from '../config/fases.json';
import rulesConfig from '../config/regras_gerais.json';
import animationConfig from '../config/animacoes.json';
import renderConfig from '../config/renderizacao.json';
import rangeConfig from '../config/alcances.json';
import type { Element, Family, Rarity, StageType, Stats } from './types';

export type BasicAttackData = { stat: 'atk' | 'spa'; category: 'physical' | 'special'; animation: string; projectile?: string };
export const ANIMATIONS = animationConfig;
export const RENDER_SETTINGS = renderConfig;
export type StageData = { elements: Element[]; rangeClass: RangeClass; range: number; energy: number; move: string; chargedType: Element; chargedAnimation: string; basic: BasicAttackData };
export interface SpeciesData {
  names: string[];
  pokedexIds: number[];
  rarity: Rarity;
  shop: boolean;
  glow: string;
  base: Stats;
  range: number;
  rangeClass: RangeClass;
  energy: number;
  attack: string;
  ability: string;
  elements: Element[];
  sprites: string[];
  stageBases?: Stats[];
  bossOnly?: boolean;
  bossBase?: Stats; bossMove?: string; bossRange?: number; bossEnergy?: number;
  eeveeBranch?: boolean;
  basic?: BasicAttackData;
  stages?: Partial<StageData>[];
  physicalSizes?: number[];
  evolutionCopies?: number[];
  babyEvolution?: Family;
  babyEvolutionOptions?: Family[];
}

export type MoveData = {
  name: string; effect: 'drain' | 'burn' | 'slow' | 'chain' | 'blast' | 'pollen' | 'spin' | 'flame-strike' | 'shock' | 'poison-shot' | 'heal-powder' | 'sting' | 'shield' | 'multi' | 'gas' | 'stomp' | 'eevee-ball' | 'bone-throw' | 'single-knockup' | 'rock-strike' | 'withdraw-guard' | 'healing-egg' | 'rock-charge' | 'piercing-fire' | 'dragon-breath' | 'dragon-cyclone' | 'dragon-storm' | 'ghost-ambush' | 'burrow' | 'mew-blessing' | 'self-explosion' | 'brutal-kick' | 'desperate-splash' | 'fang-tail' | 'star-refraction' | 'bite-shred' | 'wind-tornado' | 'hitmonchan-uppercut' | 'hitmonlee-spin-kick' | 'flame-orbit' | 'lapras-surf' | 'ditto-transform' | 'lullaby' | 'star-ward' | 'mime-wall' | 'meteor-rain' | 'cone-slash' | 'scizor-double' | 'jynx-kiss' | 'claw-strip' | 'electromagnetic-ball' | 'flame-jet' | 'electric-punch';
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
  conversion?: { kind: 'none' | 'stat_buff' | 'heal' | 'barrier'; stat?: 'atk' | 'def' | 'spa' | 'spd' | 'speed'; points_per_damage_per_ally?: number; duration_seconds?: number; healing_pool_per_damage?: number; shield_pool_per_damage?: number; spaRatio?: number; max_barrier_fraction_of_target_max_hp?: number };
  shredBase?: number; shredRatio?: number; shredDuration?: number; controlDuration?: number;
  skillRange?: number; selfHpCost?: number; guardDuration?: number; guardReduction?: number;
  chance?: number; push?: number; wallDamage?: number; tailBase?: number; tailRatio?: number; tailRadius?: number;
  tornadoSpeed?: number; tornadoDistance?: number; tornadoRadius?: number; tornadoSlow?: number; tornadoSpeedReduction?: number;
  speedReduction?: number; shieldSpaRatio?: number; bonusBase?: number; bonusSpaRatio?: number; buffDuration?: number;
  dashRange?: number; hitRadius?: number; impactDelay?: number; stunBase?: number; stunSpaRatio?: number; stunHpRatio?: number; stunMin?: number; stunMax?: number;
  orbCount?: number; orbitRadius?: number; rotationSpeed?: number; orbRadius?: number;
  impactsBase?: number; spaPerExtraImpact?: number; maxImpacts?: number; reimpactSeconds?: number;
  speedBonusPercent?: number; defBonusPercent?: number; spdBonusPercent?: number; maxDuration?: number;
  durationBaseByStage?:number[]; durationSpaRatio?:number; durationMax?:number; sleepSeconds?:number;
  shieldBaseByStage?:number[]; starBaseByStage?:number[]; starInterval?:number; starFallSeconds?:number;
  pillarDamageBase?:number; pillarSpaRatio?:number; pillarDuration?:number; wallDuration?:number; wallBonusRatio?:number;
  pierceBase?:number; pierceSpaRatio?:number; pierceMax?:number;
  meteorCount?:number; impactRadius?:number; fragmentRatio?:number; fallSpeed?:number; fragmentSpeed?:number; warningSeconds?:number;
  coneRange?:number; coneAngle?:number; executeThreshold?:number;
  shieldDamageMultiplier?:number; dashSpeed?:number; hitInterval?:number;
  freezeBase?:number; freezeSpaRatio?:number; freezeMax?:number; adjacentRadius?:number; adjacentFreezeRatio?:number;
  stripLength?:number;stripWidth?:number;pursuitByStage?:number[];pursuitSpeed?:number;interruptRange?:number;pursuitTimeout?:number;
  pulseBase?:number;pulseSpaRatio?:number;pulsesByStage?:number[];durationByStage?:number[];
  pulseInterval?:number;pulseRadius?:number;attractionRadius?:number;absorptionRadius?:number;orbSpeed?:number;pullSpeed?:number;
  chargeMaxDuration?: number; gasTimeRatio?: number; gasAttackRatio?: number; gasReleaseDelay?: number;
  sleepDuration?: number; sleepTicks?: number; sleepHealBase?: number; sleepHealSpaRatio?: number;
  controlSpaRatio?: number; controlMax?: number;
  durabilitySpaRatio?: number; durabilityMax?: number;
  guardSpaRatio?: number; guardMaxReduction?: number;
  surfSteps?: number; waveMaxDistance?: number; waveRadius?: number; waveSpeed?: number;
  damageInterval?: number; visualInterval?: number; babyDuration?: number;
  durabilityByStage?: number[]; energyDrainPrimaryByStage?: number[]; energyDrainAdjacentByStage?: number[];
  babyEnergyDrainPrimary?: number; babyEnergyDrainAdjacent?: number; shieldEnergyRatio?: number; shieldMaxHpFraction?: number;
  continuationMultiplier?: number; levelBonusCap?: number; revertHealthRatio?: number;
};

export const ATTACKS = movesConfig as unknown as {
  basic: { name: string; offensiveRatio: number; energyGain: number };
  moves: Record<string, MoveData>;
};
export type RangeClass = 'Curto' | 'Médio' | 'Médio Alto' | 'Alto' | 'Muito Alto' | 'Extremo';
export const RANGES = rangeConfig.levels as Array<{name:RangeClass;value:number}>;
export function rangeValue(name:RangeClass):number {const entry=RANGES.find(r=>r.name===name);if(!entry)throw Error(`Unknown range class: ${name}`);return entry.value;}
export function steppedRange(name:RangeClass,steps:number):number {
 const index=RANGES.findIndex(r=>r.name===name);
 return RANGES[Math.min(RANGES.length-1,Math.max(0,index+steps))].value;
}
export function rangeLabel(value:number, rangeClass?:RangeClass):string {
 const level=rangeClass||RANGES.find(r=>r.value===value)?.name;
 return level?`${level} (${value.toFixed(1)} casas)`:`${value.toFixed(1)} casas`;
}
export const RULES = rulesConfig;
export const PHASES = phaseConfig as unknown as {
  stagesPerChapter: number;
  stages: Array<{ type: StageType; name: string }>;
  bot: { baseLevel: number; levelsPerChapter: number; extraUnitsEveryChapter: number; maxUnits: number; iv: number };
  firstBattleItem: { enabled: boolean; chapter: number; stage: number; color: import('./types').ItemColor; grantToBots: boolean };
  boss: { levelPerChapter: number; firstChapterIv: number; secondChapterIv: number; laterChapterIv: number };
};

export const SPECIES = Object.fromEntries(Object.entries(pokemonConfig.species).map(([family, species]) => [
  family, {
    ...species,
    ability: ATTACKS.moves[species.attack].name,
    sprites: pokemonConfig.sprites[family as keyof typeof pokemonConfig.sprites] || species.pokedexIds.map(id => `${pokemonConfig.spriteBaseUrl}/${id}.png`)
  }
])) as Record<Family, SpeciesData>;

/** One immutable stage configuration per family/form. Data is shared by client and server.
 * Range classifications are authoritative; projectile identity is independent of range.
 * Explicit stats/category remain authoritative to preserve existing balance. */
const stageCache = new Map<string, StageData>();
export function getStageData(family: Family, stage: number): StageData {
  const species = SPECIES[family];
  const index = Math.min(Math.max(0, stage), species.names.length - 1);
  const key = `${family}:${index}`;
  const cached = stageCache.get(key);
  if (cached) return cached;
  const override = species.stages?.[index] || {};
  const elements = override.elements || species.elements;
  const rangeClass = (override.rangeClass || species.rangeClass) as RangeClass;
  const range = rangeValue(rangeClass);
  const basicOriginal = override.basic || species.basic;
  // The old range number must never silently convert a melee attacker into a gunner.
  const ranged = !!basicOriginal?.projectile || basicOriginal?.animation === 'Shoot' || basicOriginal?.animation === 'SpAttack';
  const basic: BasicAttackData = {
    stat: 'atk', // authoritative universal rule; visual element stays unchanged
    category: 'physical',
    animation: basicOriginal?.animation || (ranged ? ANIMATIONS.basic.rangedAnimation : ANIMATIONS.basic.meleeAnimation),
    ...(ranged ? { projectile: 'basic-projectile' as const } : {})
  };
  const result: StageData = {
    elements, range, rangeClass, energy: override.energy ?? species.energy,
    move: override.move || species.attack,
    chargedType: override.chargedType || elements[0],
    chargedAnimation: override.chargedAnimation || 'Attack',
    basic
  };
  stageCache.set(key, result);
  return result;
}

export const SHOP_FAMILIES = (Object.keys(SPECIES) as Family[]).filter(f => SPECIES[f].shop);
export const LEGENDARY_FAMILIES = (Object.keys(SPECIES) as Family[]).filter(f => SPECIES[f].bossOnly);
export const EEVEE_BRANCHES = ['vaporeon','flareon','jolteon','umbreon','sylveon','leafeon','glaceon','espeon'] as Family[];

export const ELEMENTS: Record<Element, { name: string; color: string; description: string }> = {
  ghost: { name: 'Fantasma', color: '#b58af8', description: 'Sem bônus de sinergia por enquanto' },
  dragon: { name: 'Dragão', color: '#afa1ff', description: 'Sem bônus de sinergia por enquanto' },
  grass: { name: 'Planta', color: '#81d9a2', description: 'Sem bônus de sinergia por enquanto' },
  poison: { name: 'Venenoso', color: '#c38aff', description: 'Sem bônus de sinergia por enquanto' },
  fire: { name: 'Fogo', color: '#ff8a5f', description: 'Sem bônus de sinergia por enquanto' },
  water: { name: 'Água', color: '#77bfff', description: 'Sem bônus de sinergia por enquanto' },
  electric: { name: 'Elétrico', color: '#f9d769', description: 'Sem bônus de sinergia por enquanto' },
  ice: { name: 'Gelo', color: '#a7edff', description: 'Tipo de chefe lendário' },
  flying: { name: 'Voador', color: '#a9d1fa', description: 'Tipo de chefe lendário' },
  fighting: { name: 'Lutador', color: '#d39777', description: 'ATK e DEF adicionais' },
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
export function calculateStats(family: Family, level: number, iv: Stats, stage: number, boss = false, effectiveIv = false): Stats {
  const species = SPECIES[family];
  const base = (boss && species.bossBase) || species.stageBases?.[Math.min(Math.max(0, stage), species.stageBases.length - 1)] || species.base;
  const formula = RULES.statFormula;
  const levelScale = 1 + Math.max(0, level - 1) * formula.levelPerPoint;
  return Object.fromEntries((Object.keys(base) as Array<keyof Stats>).map(key => [
    key, Math.round(base[key] * (formula.ivBase + Math.max(0, effectiveIv ? iv[key] : Math.min(100, iv[key])) * formula.ivPerPoint) * levelScale)
  ])) as unknown as Stats;
}

export function displayName(family: Family, stage: number): string {
  return SPECIES[family].names[Math.min(SPECIES[family].names.length - 1, stage)];
}

export function gridXY(col: number, row: number): { x: number; y: number } {
  return { x: (col - 3) * 1.04 + (row % 2 ? 0.26 : -0.26), y: (row - 3.5) * 0.91 };
}

/** Authoritative evolution and physical footprint parameters, shared across AI, HUD and combat. */
export function evolutionCopies(family: Family, stage = 0, enhanced = false): number {
 const species = SPECIES[family];
 const count = species.evolutionCopies?.[Math.min(stage,species.evolutionCopies.length-1)] ?? 3;
 if(enhanced){
  const augment=augmentsConfig.augments.find(entry=>entry.id==='P11');
  const params=augment?.params as Record<string,unknown> | undefined;
  const target=family==='eevee' ? params?.eeveeCopies : params?.evolutionCopies;
  if(typeof target==='number' && Number.isFinite(target))return Math.max(2,Math.min(Math.floor(count),Math.floor(target)));
 }
 return Math.max(2,Math.floor(count));
}
export function physicalSize(family: Family, stage = 0): number {
 const sizes = SPECIES[family].physicalSizes;
 return Math.max(.5,Math.min(1.8,sizes?.[Math.min(stage,sizes.length-1)] ?? 1));
}
export function collisionRadius(family: Family, stage = 0): number { return .295 * physicalSize(family,stage); }
