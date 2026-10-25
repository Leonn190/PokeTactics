import pokemonConfig from '../config/pokemons.json';
export type Family = keyof typeof pokemonConfig.species;
export type StatKey = 'hp' | 'speed' | 'atk' | 'def' | 'spa' | 'spd';
export type Stats = Record<StatKey, number>;
export type Element = 'grass' | 'poison' | 'fire' | 'water' | 'electric' | 'ice' | 'flying' | 'psychic';
export type Rarity = 1 | 2 | 3 | 4 | 5;
export type StageType = 'battle' | 'gold' | 'quad' | 'bot' | 'double' | 'boss';
export type StageResult = 'win' | 'loss' | 'second' | 'third' | 'fourth' | null;
export type Phase = 'planning' | 'combat' | 'result' | 'finished';
export type UnitPosition = { area: 'bench'; index: number } | { area: 'board'; col: number; row: number };

export interface Pokemon {
  id: string;
  family: Family;
  stage: number;
  level: number;
  xp: number;
  iv: Stats;
  position: UnitPosition;
}

export interface ShopOffer {
  id: string;
  family: Family;
  rarity: Rarity;
  price: number;
}

export interface Player {
  id: string;
  name: string;
  health: number;
  gold: number;
  level: number;
  units: Pokemon[];
  shop: Array<ShopOffer | null>;
  locked: boolean;
  eliminated: boolean;
  lastWin: boolean;
  streak: number;
  roundVictory: boolean;
  history: StageResult[];
  placement: number | null;
}

export interface CombatMetrics {
  dealt: number;
  physicalDealt: number;
  specialDealt: number;
  taken: number;
  healed: number;
  blocked: number;
}

export interface CombatUnit {
  id: string;
  sourceId: string;
  playerId: string;
  family: Family;
  stage: number;
  level: number;
  col: number;
  row: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  energy: number;
  energyNeeded: number;
  range: number;
  stats: Stats;
  cooldown: number;
  attackClock: number;
  moving: boolean;
  facingX: number;
  facingY: number;
  animation: { name: 'Rotate' | 'Attack' | 'Shoot' | 'Charge' | 'Withdraw' | 'Strike' | 'Hurt'; elapsed: number; duration: number; next?: 'Shoot' | 'Withdraw' } | null;
  spinTime: number;
  spinDuration: number;
  spinReduction: number;
  waterFxClock: number;
  pendingPollen: { targetId: string; x: number; y: number; remaining: number; launched: boolean } | null;
  flash: number;
  effects: { kind: string; time: number }[];
  damageOverTime: { amount: number; time: number; sourceId: string } | null;
  slow: number;
  metrics: CombatMetrics;
}

export interface CombatEffect {
  id: string;
  targetId?: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  kind: 'physical' | 'spell' | 'heal' | 'ko' | 'damage' | 'pollen' | 'seed' | 'water' | 'flame' | 'lightning';
  damageType?: 'physical' | 'special' | 'true';
  family: Family;
  time: number;
  duration: number;
  value: number;
}

export interface Battle {
  id: string;
  playerA: string;
  playerB: string;
  participants: string[];
  rankings: string[];
  knockoutAt: Record<string, number>;
  goldDrops: GoldDrop[];
  goldRound: boolean;
  kind: StageType;
  units: CombatUnit[];
  effects: CombatEffect[];
  elapsed: number;
  resolved: boolean;
  winner: string | null;
  loser: string | null;
  traitsByPlayer: Record<string, Partial<Record<Element, number>>>;
  benches: Record<string, Pokemon[]>;
}

export interface GoldDrop {
  id: string;
  x: number;
  y: number;
  ownerId: string;
  claimed: boolean;
}

export interface GameSnapshot {
  serial: number;
  phase: Phase;
  phaseSeconds: number;
  timeLeft: number;
  round: number;
  chapter: number;
  stage: number;
  stageType: StageType;
  stageName: string;
  accelerated: boolean;
  observedId: string;
  players: Player[];
  opponentId: string | null;
  possibleOpponents: Record<string, string[][]>;
  visibleBattle: Battle | null;
  combatStats: Record<string, Record<string, CombatMetrics>>;
  log: string;
  winnerId: string | null;
}

export type GameCommand =
  | { kind: 'buy'; slot: number }
  | { kind: 'reroll' }
  | { kind: 'lock' }
  | { kind: 'move'; unitId: string; position: UnitPosition }
  | { kind: 'sell'; unitId: string }
  | { kind: 'collect'; dropId: string };

export type ClientToServer = { type: 'command'; command: GameCommand } | { type: 'connect' } | { type: 'watch'; playerId: string };
export type ServerToClient = { type: 'snapshot'; snapshot: GameSnapshot } | { type: 'rejected'; reason: string };
