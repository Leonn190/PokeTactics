import pokemonConfig from '../config/pokemons.json';
export type Family = keyof typeof pokemonConfig.species;
export type StatKey = 'hp' | 'speed' | 'atk' | 'def' | 'spa' | 'spd';
export type Stats = Record<StatKey, number>;
export type Element = 'grass' | 'poison' | 'fire' | 'water' | 'electric' | 'ice' | 'flying' | 'psychic' | 'bug' | 'normal' | 'ground' | 'rock' | 'steel' | 'dark' | 'fairy';
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
  pendingEvolution?: string[];
}

export interface CombatMetrics {
  casts: number;
  controlSeconds: number;
  dealt: number;
  physicalDealt: number;
  specialDealt: number;
  taken: number;
  healed: number;
  blocked: number;
  blockedPhysical: number;
  blockedSpecial: number;
  barrierAbsorbed: number;
  abilityMitigated: number;
}

export interface TimedStatEffect { sourceId: string; stat: 'atk' | 'def' | 'spa' | 'spd' | 'speed'; amount: number; until: number }
export interface TimedBarrier { sourceId: string; hp: number; until: number; kind: 'eevee' }

export interface CombatUnit {
  id: string;
  sourceId: string;
  playerId: string;
  family: Family;
  stage: number;
  level: number;
  iv: Stats;
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
  animation: { name: string; elapsed: number; duration: number; next?: string } | null;
  spinTime: number;
  spinDuration: number;
  spinReduction: number;
  waterFxClock: number;
  pendingPollen: { targetId: string; x: number; y: number; remaining: number; launched: boolean } | null;
  flash: number;
  effects: { kind: string; time: number }[];
  damageOverTime: { amount: number; time: number; sourceId: string } | null;
  poison: { amount: number; time: number; sourceId: string; accumulator: number } | null;
  barrier: { hp: number; time: number; maxHp: number } | null;
  barriers: TimedBarrier[];
  buffs: TimedStatEffect[];
  defenseShreds: TimedStatEffect[];
  guardUntil: number;
  combo: { targetId: string; hits: number; time: number; interval: number } | null;
  gasTime: number;
  support: { time: number; moveId: string } | null;
  leap: { fromX: number; fromY: number; toX: number; toY: number; time: number; duration: number } | null;
  charge: { fromX: number; fromY: number; toX: number; toY: number; time: number; duration: number;
    directionX: number; directionY: number; hitIds: string[]; moveId: string } | null;
  jumpHeight: number;
  stunTime: number;
  knockUpTime: number;
  knockUpDuration: number;
  controlImmune?: boolean;
  stunUntil: number;
  knockUpUntil: number;
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
  kind: 'basic-projectile' | 'physical' | 'spell' | 'heal' | 'ko' | 'damage' | 'pollen' | 'seed' | 'water' | 'flame' | 'lightning' | 'trainer-hit' | 'poison' | 'shield' | 'gas' | 'stomp' | 'ball' | 'bone' | 'egg' | 'impact' | 'piercing-flame';
  damageType?: 'physical' | 'special' | 'true';
  basicType?: Element;
  family: Family;
  time: number;
  duration: number;
  value: number;
  piercing?: { sourceId: string; raw: number; attackType: Element; hitIds: string[] };
  pendingHit?: {
    sourceId: string;
    targetId: string;
    raw: number;
    magical: boolean;
    charged: boolean;
    moveId?: string;
    attackType?: Element;
    arrival: number;
    onHit?: 'drain' | 'burn' | 'slow' | 'poison';
    chain?: { remaining: number; visited: string[]; ratio: number; range: number };
    special?: 'eevee-ball' | 'bone-throw' | 'single-knockup' | 'rock-strike' | 'healing-egg';
  };
}

export interface KnockupEvent {
  battle_id: string; target_unit_id: string; source_unit_id: string;
  knockup_instance_id: string; start_time: number;
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
  introElapsed: number;
  outcomeElapsed: number;
  resolved: boolean;
  winner: string | null;
  loser: string | null;
  traitsByPlayer: Record<string, Partial<Record<Element, number>>>;
  benches: Record<string, Pokemon[]>;
  knockupEvents: KnockupEvent[];
}

export interface GoldDrop {
  id: string;
  x: number;
  y: number;
  ownerId: string;
  claimed: boolean;
}

export interface UnitVisualEvent {
  id: string;
  unitId: string;
  ownerId: string;
  kind: 'summon' | 'evolve' | 'fusion' | 'trainer-damage';
  age: number;
  sources?: Array<{ family: Family; stage: number; position: UnitPosition; level: number; id?: string }>;
  pokemon?: { family: Family; stage: number; position: UnitPosition; level: number };
  delay?: number; // stagger evolution after a simultaneous purchase
  value?: number; // effective HP lost by trainer, not the pre-clamp formula
  battleId?: string;

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
  lastOpponentId: string | null;
  visualEvents: UnitVisualEvent[];
  possibleOpponents: Record<string, string[][]>;
  visibleBattle: Battle | null;
  combatStats: Record<string, Record<string, CombatMetrics>>;
  log: string;
  winnerId: string | null;
  trainer: { x: number; y: number; targetX: number; targetY: number };
  collectibleGold: GoldDrop[];
}

export type GameCommand =
  | { kind: 'buy'; slot: number }
  | { kind: 'reroll' }
  | { kind: 'lock' }
  | { kind: 'move'; unitId: string; position: UnitPosition }
  | { kind: 'sell'; unitId: string }
  | { kind: 'choose-eevee'; branch: Family }
  | { kind: 'move-trainer'; x: number; y: number };

export type ClientToServer = { type: 'command'; command: GameCommand } | { type: 'connect' } | { type: 'watch'; playerId: string };
export type ServerToClient = { type: 'snapshot'; snapshot: GameSnapshot } | { type: 'rejected'; reason: string };
