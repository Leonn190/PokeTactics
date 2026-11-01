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

export interface AugmentChoice { chapter: number; rarity: 'bronze'|'silver'|'gold'|'prismatic'; offers: string[]; rerolled: boolean[]; status:'pending'|'chosen'; selected?: string }
export interface Pokemon {
  id: string;
  family: Family;
  stage: number;
  level: number;
  xp: number;
  iv: Stats;
  position: UnitPosition;
  equipment?: EquippedItem[];
  mimePillars?: Array<{col:number;row:number}>;
  acquiredChapter?: number;
  appliedAugments?: string[];
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
  trainerXp: number;
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
  pendingEvolutionKind?: 'eevee'|'scyther'|'tyrogue';
  firstBattleItemGranted?: boolean;
  itemInventory?: EquippedItem[];
  pendingItems?: EquippedItem[];
  augments?: string[];
  augmentChoice?: AugmentChoice;
  augmentChosenChapters?: Record<string,number>;
  augmentCounters?: Record<string,number>;
  augmentEvents?: string[];
  currentRound?: number;
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
export interface TimedBarrier { sourceId: string; hp: number; until: number; kind: 'eevee' | 'mew' | 'item' | 'synergy' | 'surf' | 'star-ward'; instanceId?: string }

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

export type StatusKey = 'poisoned'|'burning'|'frozen'|'paralyzed'|'sleeping';
export interface StatusInstance {sourceId:string; until:number; started:number; instanceId:string; intensity?:number}
export interface ArenaObstacle {
 id:string; ownerId:string; sourceId:string; kind:'pillar'|'wall'; x:number; y:number;
 // Walls are segments between two positions on the physical hex grid.
 ax:number;ay:number;bx:number;by:number; createdAt:number;until:number;
}
export interface OrbitFlame {
 slot: number; angle: number; impactsLeft: number; maxImpacts?: number; bornAt: number;
 // Hit registry is only used by the simulation (also serializable across snapshots).
 contacts: string[]; lastHit: Record<string,number>;
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
  itemBurn?: { sourceId: string; dps: number; until: number; accumulator?: number; tickTime?: number } | null;
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
  damageOverTime: { amount: number; time: number; sourceId: string; accumulator?: number; tickTime?: number } | null;
  poison: { amount: number; time: number; sourceId: string; accumulator: number } | null;
  barrier: { hp: number; time: number; maxHp: number } | null;
  barriers: TimedBarrier[];
  buffs: TimedStatEffect[];
  defenseShreds: TimedStatEffect[];
  guardUntil: number;
  bossMove?: string;
  attackSpeedDebuffUntil: number;
  dig: DigState | null;
  preferredTargetId?:string;
  /** Sticky regular-attack target and one-hex chase memory (simulation only). */
  combatTargetId?:string;
  basicTargetWasInRange?:boolean;
  chaseOriginX?:number;
  chaseOriginY?:number;
  navBlockedFor?:number;
  persianPursuit?: {targetId:string; elapsed:number; stuck:number};
  babyFlee?: boolean;
  rageStacks?: number;
  rageEmpowered?: boolean;
  rageRebirth?: { used:boolean;pending:boolean; at:number };
  furyLeap?: { phase:'strike'|'retreat'; fromX:number;fromY:number;toX:number;toY:number;elapsed:number;duration:number;targetId?:string };
  flameJet?: { remaining:number; accumulator:number; visualClock:number; dx:number; dy:number; duration:number; };
  wasMoving?:boolean;
  poisonLastTile?:string;
  poisonThresholds?:number;
  poisonDeathEmitted?:boolean;
  absorb?:{targetId:string;until:number;nextTick:number;originalStunUntil:number};
  vine?:{targetId:string;attachedAt:number};
  lastCombatTargetId?:string;
  scizorPending?:boolean;
  scizorAction?:{targetId:string;fromX:number;fromY:number;toX:number;toY:number;elapsed:number;dashTime:number;hitsDone:number;nextHit:number};
  ghost: GhostState | null;
  ghostCasts: number;
  orbitFlames: OrbitFlame[];
  statuses: Partial<Record<StatusKey,StatusInstance>>;
  lullaby: {until:number;instanceId:string;affected:string[]} | null;
  starWard: {instanceId:string;nextStar:number} | null;
  mimePillars?: Array<{col:number;row:number}>;
  obstacleRoute?: {version:number;targetId:string;targetX:number;targetY:number;points:Array<{x:number;y:number}>;expires:number};
  fear: FearState | null;
  storm: StormState | null;
  psychicImbuement: PsychicImbuement | null;
  refractionUntil: number; // absolute simulated combat time, Staryu/Starmie
  hitmonGuaranteed: boolean;
  hitmonAction: {phase:'move'|'strike'|'pause';kind:'uppercut'|'kick';moveId:string;targetId:string;
    fromX:number;fromY:number;toX:number;toY:number;elapsed:number;duration:number;remaining:number;hitDone:boolean} | null;
  combo: { targetId: string; hits: number; time: number; interval: number } | null;
  gasTime: number;
  gasCharge: { startedAt: number; maxDuration: number } | null;
  sleep: { time: number; healed: number } | null;
  surf: { dx: number; dy: number; travelled: number; waveTravel: number; maxTravel: number; maxWave: number; waveX: number; waveY: number; hitIds: string[]; shieldIds: string[]; fxId: string; } | null;
  ditto: { used: boolean; active: boolean; original: { family: Family; stage: number; stats: Stats; iv: Stats; level: number; range: number; energyNeeded: number; hp: number; maxHp: number } } | null;
  guardReductionEffective?: number;
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
  augmentCrit?: boolean;
  windSlow?: number;
}

export interface CombatEffect {
  id: string;
  sourceId?: string; // Presentation-only link to PMD body anchors; never controls damage.
  targetId?: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  kind: 'basic-projectile' | 'physical' | 'spell' | 'heal' | 'ko' | 'damage' | 'pollen' | 'seed' | 'water' | 'flame' | 'lightning' | 'trainer-hit' | 'poison' | 'shield' | 'gas' | 'stomp' | 'ball' | 'bone' | 'egg' | 'impact' | 'piercing-flame' | 'dragon-orb' | 'dragon-tornado' | 'dragon-wave' | 'earth-trail' | 'earth-burst' | 'psychic-blessing' | 'psychic-spark' | 'explosion' | 'ghost-trail' | 'ghost-slash' | 'ghost-scare' | 'synergy-lightning' | 'earthquake' | 'frost' | 'fairy-link' | 'flight' | 'swarm' | 'ghost-revive' | 'kick-impact' | 'tail-sweep' | 'wind-tornado' | 'bite-impact' | 'hitmon-spin' | 'surf-wave' | 'transform' | 'falling-star' | 'lullaby-note' | 'wall-impact' | 'meteor-fall' | 'meteor-warning' | 'meteor-fragment' | 'meteor-impact' | 'cone-slash' | 'scizor-dash' | 'scizor-impact' | 'claw-strip' | 'electro-shot' | 'electro-field' | 'electro-pulse' | 'electro-absorb' | 'flame-jet' | 'electric-punch' | 'psychic-shot' | 'vine-pull' | 'solar-beam';
  magnet?:{ownerId:string;radius:number;attractionRadius:number;absorptionRadius:number;
    pullSpeed:number;pulseRaw:number;pulseCount:number;pulseIndex:number;interval:number};
  magnetPull?:{orbId:string;fromX:number;fromY:number;toX:number;toY:number;startTime:number;duration:number};
  claw?:{length:number;width:number;hitAt:number;done:boolean;raw:number};
  meteor?:{raw:number;radius:number;fragmentRatio:number;speed:number;hitAt:number;warning:number;done:boolean};
  fragment?:{raw:number;speed:number};
  cone?:{raw:number;range:number;angle:number;executeThreshold:number;hitAt:number;done:boolean};
  damageType?: 'physical' | 'special' | 'true';
  basicType?: Element;
  family: Family;
  stage?: number;
  time: number;
  duration: number;
  value: number;
  piercing?: { sourceId: string; raw: number; attackType: Element; hitIds: string[] };
  wind?: { sourceId:string; raw:number; attackType:Element; dx:number; dy:number; speed:number;
    traveled:number; maxDistance:number; radius:number; hitIds:string[]; slowFactor:number; speedFactor:number; };
  obstacleImpact?:boolean;
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
    special?: 'terrain-poison' | 'eevee-ball' | 'bone-throw' | 'single-knockup' | 'rock-strike' | 'healing-egg' | 'dragon-breath' | 'dragon-cyclone' | 'mew-blessing' | 'bite-shred' | 'jynx-kiss' | 'magnet-impact';
    psychicBonus?: number;
  };
}

export interface KnockupEvent {
  battle_id: string; target_unit_id: string; source_unit_id: string;
  knockup_instance_id: string; start_time: number;
}

export interface PoisonTerrain {
 kind:'poison'; col:number; row:number; sourceId:string; ownerId:string; sourceSpa:number;
 intensity:1|2|3; until:number; nextDecay:number; nextTick:number;
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
  terrain?: Record<string,PoisonTerrain>;
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
  augmentsByPlayer?: Record<string,string[]>;
  augmentTimers?: Record<string,number>;
  knockupEvents: KnockupEvent[];
  obstacles: ArenaObstacle[];
  obstacleVersion?:number;
  pillarsSpawned?:boolean;
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
  augmentRarities?:Record<number,AugmentChoice['rarity']>;
  accelerated: boolean;
  observedId: string;
  players: Player[];
  opponentId: string | null;
  lastOpponentId: string | null;
  visualEvents: UnitVisualEvent[];
  possibleOpponents: Record<string, string[][]>;
  visibleBattle: Battle | null;
  sandbox?: boolean;
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
  | { kind:'sandbox-start'|'sandbox-restart' }
  | { kind:'sandbox-add'; ownerId:'p0'|'p1'; family:Family; stage:number; col?:number; row?:number }
  | { kind:'sandbox-move'; unitId:string; ownerId:'p0'|'p1'; col:number; row:number }
  | { kind:'sandbox-transfer'; unitId:string; toOwnerId:'p0'|'p1'; position:UnitPosition }
  | { kind:'sandbox-remove'; unitId:string; ownerId:'p0'|'p1' }
  | { kind:'sandbox-stage'; unitId:string; ownerId:'p0'|'p1'; stage:number }
  | { kind:'sandbox-item'; color?:ItemColor; recipe?:string }
  | { kind:'sandbox-equip-item'; ownerId:'p0'|'p1'; unitId:string; itemId:string }
  | { kind:'sandbox-equip'; ownerId:'p0'|'p1'; unitId:string; color?:ItemColor; recipe?:string; slot?:number }
  | { kind:'sandbox-augment'; ownerId:'p0'|'p1'; id:string; enabled:boolean }
  | { kind: 'buy'; slot: number; offerId: string }
  | { kind: 'reroll' }
  | { kind: 'buy-xp' }
  | { kind: 'augment-reroll'; slot: number }
  | { kind: 'augment-choose'; slot: number }
  | { kind: 'lock' }
  | { kind: 'move'; unitId: string; position: UnitPosition }
  | { kind: 'sell'; unitId: string }
  | { kind: 'choose-eevee'; branch: Family }
  | { kind: 'equip-item'; itemId: string; unitId: string; ontoSlot?: number }
  | { kind: 'unequip-item'; unitId: string; slot: number }
  | { kind: 'use-ball'; ball: BallKind; unitId: string }
  | { kind: 'move-trainer'; x: number; y: number }
  | { kind: 'mime-pillar'; unitId: string; index: number; col: number; row: number };

export type ClientToServer = { type: 'command'; command: GameCommand } | { type: 'connect'; mode?:'normal'|'sandbox' } | { type: 'watch'; playerId: string } | { type:'pause'; paused:boolean };
export type ServerToClient = { type: 'snapshot'; snapshot: GameSnapshot } | { type: 'rejected'; reason: string };
