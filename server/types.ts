import pokemonConfig from '../config/pokemons.json';
export type Family = keyof typeof pokemonConfig.species;
export type ItemColor = 'green' | 'blue' | 'purple' | 'orange' | 'yellow' | 'red';
export type BallKind = 'pokeball' | 'greatball' | 'ultraball' | 'masterball';
export type LootColor = 'gray' | 'blue' | 'yellow';
export interface EquippedItem { id: string; kind: 'component' | 'complete'; components: ItemColor[]; recipe?: string }
export interface PercentStats { vampirism: number; critChance: number; critDamage: number; durability: number; amplification: number }
export interface LootReward { kind: 'gold'|'pokemon'|'component'; amount?: number; family?: Family; rarity?: Rarity; color?: ItemColor; bonusBall?: BallKind }
export interface LootDrop { id: string; ownerId: string; x: number; y: number; color: LootColor; claimed: boolean; reward: LootReward; pending?: boolean }
export type StatKey = 'hp' | 'speed' | 'atk' | 'def' | 'spa' | 'spd';
export type Stats = Record<StatKey, number>;
export type Element = 'ghost' | 'grass' | 'poison' | 'fire' | 'water' | 'electric' | 'ice' | 'flying' | 'psychic' | 'bug' | 'normal' | 'dragon' | 'ground' | 'rock' | 'steel' | 'dark' | 'fairy' | 'fighting';
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
  equipment?: EquippedItem[];
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
  itemInventory?: EquippedItem[];
  pendingItems?: EquippedItem[];
  consumables?: Record<BallKind, number>;
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

export interface PsychicImbuement { sourceId: string; extraDamage: number; until: number }
export interface GhostState { phase: 'fade' | 'travel' | 'appear'; time: number; duration: number; fromX: number; fromY: number; toX: number; toY: number; targetId: string; moveId: string; trailClock: number; scare: boolean }
export interface FearState { fromX: number; fromY: number; toX: number; toY: number; time: number; duration: number }
export interface DigState { phase: 'sink' | 'travel' | 'rise'; time: number; duration: number; fromX: number; fromY: number; toX: number; toY: number; targetId: string; trailClock: number }
export interface StormState { x: number; y: number; nextWave: number; waves: number; targetIds: string[]; elapsed: number }
export interface TimedStatEffect { sourceId: string; stat: 'atk' | 'def' | 'spa' | 'spd' | 'speed'; amount: number; until: number }
export interface TimedBarrier { sourceId: string; hp: number; until: number; kind: 'eevee' | 'mew' | 'item' | 'synergy' }

/** Snapshot-owned combat modifiers; never written back to the Pokemon roster. */
export interface SynergyUnitState {
  originalStats?: Stats;
  ownStats?: Stats;
  statsPercent: Partial<Stats>;
  percents: Partial<PercentStats> & { healingShieldAmp?: number };
  speedBonus: number;
  inherit: Stats;
  revived: boolean;
  intangibleUntil?: number;
  sacredIv?: number;
  flags: Record<string,boolean>;
  timers: Record<string,number>;
  poisoned?: { sourceId:string; playerId:string; until:number };
  chilled?: { durability:number; speed:number; until:number };
  flight?: { fromX:number; fromY:number; toX:number; toY:number; elapsed:number; duration:number };
  splashBonus?: number;
  pendingSkill?: {kind:'kick'|'fang-tail'|'explosion';targetId:string;until:number;moveId:string};
  poisonDurabilityReduction?: number;
  poisonHealReduction?: number;
}

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
  equipment: EquippedItem[];
  itemStacks: Record<string, number>;
  itemTimers: Record<string, number>;
  itemNow: number;
  hitSerial: number;
  focusCount: number;
  itemBurn?: { sourceId: string; dps: number; until: number } | null;
  cooldown: number;
  attackClock: number;
  moving: boolean;
  facingX: number;
  facingY: number;
  animation: { name: string; elapsed: number; duration: number; next?: string; role?: 'basic'|'charged' } | null;
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
  bossMove?: string;
  attackSpeedDebuffUntil: number;
  dig: DigState | null;
  ghost: GhostState | null;
  ghostCasts: number;
  fear: FearState | null;
  storm: StormState | null;
  psychicImbuement: PsychicImbuement | null;
  refractionUntil: number; // absolute simulated combat time, Staryu/Starmie
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
  synergy?: SynergyUnitState;
  metrics: CombatMetrics;
}

export interface CombatEffect {
  id: string;
  sourceId?: string; // Presentation-only link to PMD body anchors; never controls damage.
  targetId?: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  kind: 'basic-projectile' | 'physical' | 'spell' | 'heal' | 'ko' | 'damage' | 'pollen' | 'seed' | 'water' | 'flame' | 'lightning' | 'trainer-hit' | 'poison' | 'shield' | 'gas' | 'stomp' | 'ball' | 'bone' | 'egg' | 'impact' | 'piercing-flame' | 'dragon-orb' | 'dragon-tornado' | 'dragon-wave' | 'earth-trail' | 'earth-burst' | 'psychic-blessing' | 'psychic-spark' | 'explosion' | 'ghost-trail' | 'ghost-slash' | 'ghost-scare' | 'synergy-lightning' | 'earthquake' | 'frost' | 'fairy-link' | 'flight' | 'swarm' | 'ghost-revive' | 'kick-impact' | 'tail-sweep';
  damageType?: 'physical' | 'special' | 'true';
  basicType?: Element;
  family: Family;
  stage?: number;
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
    special?: 'eevee-ball' | 'bone-throw' | 'single-knockup' | 'rock-strike' | 'healing-egg' | 'dragon-breath' | 'dragon-cyclone' | 'mew-blessing';
    psychicBonus?: number;
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
  seed: number;
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
  sacredTiles?: Record<string,{col:number;row:number}>;
  synergyTimers?: Record<string,number>;
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
  battleStatuses: Record<string, 'battling' | 'victorious' | 'defeated' | null>;
  log: string;
  winnerId: string | null;
  trainer: { x: number; y: number; targetX: number; targetY: number };
  collectibleGold: GoldDrop[];
  collectibleLoot: LootDrop[];
  lootMessage: string;
  lootMessageId: string;
}

export type GameCommand =
  | { kind: 'buy'; slot: number }
  | { kind: 'reroll' }
  | { kind: 'lock' }
  | { kind: 'move'; unitId: string; position: UnitPosition }
  | { kind: 'sell'; unitId: string }
  | { kind: 'choose-eevee'; branch: Family }
  | { kind: 'equip-item'; itemId: string; unitId: string; ontoSlot?: number }
  | { kind: 'unequip-item'; unitId: string; slot: number }
  | { kind: 'use-ball'; ball: BallKind; unitId: string }
  | { kind: 'move-trainer'; x: number; y: number };

export type ClientToServer = { type: 'command'; command: GameCommand } | { type: 'connect' } | { type: 'watch'; playerId: string };
export type ServerToClient = { type: 'snapshot'; snapshot: GameSnapshot } | { type: 'rejected'; reason: string };
