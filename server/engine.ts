import { BENCH_SIZE, BOARD_COLUMNS, BOARD_ROWS, calculateStats, SHOP_SIZE, SPECIES } from './data';
import { battleMetrics, createBattle, forceResolveBattle, survivors, tickBattle } from './systems/combat';
import type { Battle, Family, GameCommand, GameSnapshot, Phase, Player, Pokemon, Rarity, ShopOffer, Stats, UnitPosition } from './types';

class Rng {
  constructor(private seed: number) { this.seed ||= 1; }
  next(): number {
    let x = this.seed | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 4294967296;
  }
  int(max: number): number { return Math.floor(this.next() * max); }
  pick<T>(items: T[]): T { return items[this.int(items.length)]; }
  shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.int(i + 1); [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

const NAMES = ['VOCÊ', 'KAI', 'NOVA', 'LUNA', 'ASTRA', 'NIX', 'ECHO', 'ORION'];
const FAMILIES = Object.keys(SPECIES) as Family[];
const SHOP_ODDS = [
  [100, 0, 0, 0, 0],
  [80, 20, 0, 0, 0],
  [65, 25, 10, 0, 0],
  [50, 30, 15, 5, 0],
  [35, 35, 20, 8, 2],
  [20, 35, 28, 14, 3]
];
const LEVEL_MILESTONES = [1, 4, 8, 13, 19, 26];

export class GameEngine {
  private rng: Rng;
  private idCounter = 0;
  private serial = 0;
  private clock = 0;
  private duration = 19;
  private phase: Phase = 'planning';
  private round = 1;
  private battles: Battle[] = [];
  private opponentId: string | null = null;
  private log = '';
  private winnerId: string | null = null;
  private lastCombatStats: Record<string, Record<string, { dealt: number; taken: number; healed: number; blocked: number }>> = {};
  readonly players: Player[];

  constructor(seed = Date.now()) {
    this.rng = new Rng(seed);
    this.players = NAMES.map((name, i) => ({
      id: `p${i}`, name, health: 100, gold: 9, level: 1,
      units: [], shop: Array(SHOP_SIZE).fill(null), locked: false,
      eliminated: false, lastWin: false, streak: 0, placement: null
    }));
    this.players.forEach((player, i) => {
      const family = i === 0 ? 'bulbasaur' : this.rng.pick(FAMILIES.slice(0, 3));
      player.units.push(this.makePokemon(family, { area: 'board', col: i % 3 + 2, row: 1 }));
      this.refreshShop(player);
    });
  }

  private id(): string { return `u${++this.idCounter}`; }

  private makePokemon(family: Family, position: UnitPosition): Pokemon {
    const iv = Object.fromEntries((Object.keys(SPECIES[family].base) as Array<keyof Stats>)
      .map(stat => [stat, this.rng.int(101)])) as unknown as Stats;
    return { id: this.id(), family, stage: 0, level: 1, xp: 0, iv, position };
  }

  private levelForRound(): number {
    return LEVEL_MILESTONES.reduce((level, start, i) => this.round >= start ? i + 1 : level, 1);
  }

  private refreshShop(player: Player): void {
    const odds = SHOP_ODDS[player.level - 1];
    player.shop = Array.from({ length: SHOP_SIZE }, () => {
      let roll = this.rng.next() * 100;
      let tier: Rarity = 1;
      for (let t = 0; t < 5; t++) {
        roll -= odds[t];
        if (roll < 0) { tier = (t + 1) as Rarity; break; }
      }
      // Rarities 4 and 5 exist in the system but have no released Pokémon yet.
      const available = FAMILIES.filter(f => SPECIES[f].rarity === tier);
      const fallback = FAMILIES.filter(f => SPECIES[f].rarity <= tier);
      const family = this.rng.pick(available.length ? available : fallback);
      return { id: this.id(), family, rarity: SPECIES[family].rarity, price: SPECIES[family].rarity };
    });
  }

  private findFreeBench(player: Player): number {
    for (let i = 0; i < BENCH_SIZE; i++) {
      if (!player.units.some(u => u.position.area === 'bench' && u.position.index === i)) return i;
    }
    return -1;
  }

  private merge(player: Player): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const family of FAMILIES) {
        const maxStage = SPECIES[family].names.length - 1;
        for (let stage = 0; stage < maxStage; stage++) {
          const matches = player.units.filter(u => u.family === family && u.stage === stage);
          if (matches.length < 3) continue;
          const triple = matches.slice(0, 3);
          const anchor = triple.find(u => u.position.area === 'board') || triple[0];
          const iv = Object.fromEntries((Object.keys(anchor.iv) as Array<keyof Stats>).map(stat => [
            stat, Math.round(triple.reduce((sum, u) => sum + u.iv[stat], 0) / 3)
          ])) as unknown as Stats;
          player.units = player.units.filter(u => !triple.includes(u));
          player.units.push({
            id: this.id(), family, stage: stage + 1, iv,
            level: Math.max(...triple.map(u => u.level)),
            xp: Math.max(...triple.map(u => u.xp)), position: { ...anchor.position }
          });
          if (player.id === 'p0') this.log = `${SPECIES[family].names[stage + 1]} evoluiu!`;
          changed = true;
          break;
        }
        if (changed) break;
      }
    }
  }

  private buy(player: Player, slot: number): string | null {
    const offer = player.shop[slot];
    if (!offer) return 'Slot vazio';
    if (player.gold < offer.price) return 'Ouro insuficiente';
    const free = this.findFreeBench(player);
    const eligibleMerge = player.units.filter(u => u.family === offer.family && u.stage === 0).length >= 2;
    if (free < 0 && !eligibleMerge) return 'Banco cheio (10/10)';
    player.gold -= offer.price;
    player.units.push(this.makePokemon(offer.family, { area: 'bench', index: free < 0 ? BENCH_SIZE : free }));
    player.shop[slot] = null;
    this.merge(player);
    return null;
  }

  command(command: GameCommand): string | null {
    const human = this.players[0];
    if (human.eliminated || this.phase !== 'planning') return 'Aguarde a preparação da próxima rodada';
    if (command.kind === 'buy') {
      if (!Number.isInteger(command.slot) || command.slot < 0 || command.slot >= SHOP_SIZE) return 'Slot inválido';
      return this.buy(human, command.slot);
    }
    if (command.kind === 'reroll') {
      if (human.gold < 2) return 'Ouro insuficiente';
      human.gold -= 2;
      this.refreshShop(human);
      return null;
    }
    if (command.kind === 'lock') { human.locked = !human.locked; return null; }
    const unit = human.units.find(u => u.id === command.unitId);
    if (!unit) return 'Pokémon não encontrado';
    if (command.kind === 'sell') {
      human.gold += SPECIES[unit.family].rarity * 3 ** unit.stage;
      human.units = human.units.filter(u => u.id !== unit.id);
      return null;
    }
    if (command.kind === 'move') {
      const target = command.position;
      if (target.area === 'board') {
        if (!Number.isInteger(target.col) || !Number.isInteger(target.row) || target.col < 0 || target.col >= BOARD_COLUMNS || target.row < 0 || target.row >= BOARD_ROWS) return 'Hexágono inválido';
        const deployed = human.units.filter(u => u.position.area === 'board').length;
        if (unit.position.area !== 'board' && deployed >= human.level && !human.units.some(u => u.position.area === 'board' && u.position.col === target.col && u.position.row === target.row)) return `Limite de equipe: ${human.level}`;
      } else if (!Number.isInteger(target.index) || target.index < 0 || target.index >= BENCH_SIZE) return 'Banco inválido';
      const displaced = human.units.find(u => u.id !== unit.id && samePosition(u.position, target));
      const old = unit.position;
      unit.position = { ...target };
      if (displaced) displaced.position = { ...old };
      return null;
    }
    return null;
  }

  private runCPU(player: Player): void {
    if (player.eliminated) return;
    const available = player.shop
      .map((offer, i) => ({ offer, i }))
      .filter((entry): entry is { offer: ShopOffer; i: number } => !!entry.offer && entry.offer.price <= player.gold)
      .sort((a, b) => {
        const aCopies = player.units.filter(u => u.family === a.offer.family).length;
        const bCopies = player.units.filter(u => u.family === b.offer.family).length;
        return (bCopies * 3 + b.offer.price) - (aCopies * 3 + a.offer.price);
      });
    let purchases = Math.min(3, available.length);
    for (const item of available) {
      if (purchases <= 0 || player.gold < item.offer.price) break;
      if (player.gold < 2 && player.units.length >= player.level) break;
      if (this.buy(player, item.i) === null) purchases--;
    }
    // Deploy the strongest available units; the same positional rules apply to CPUs.
    const favorites = [...player.units].sort((a, b) => {
      const score = (u: Pokemon) => {
        const stats = calculateStats(u.family, u.level, u.iv, u.stage);
        return u.stage * 500 + stats.hp + stats.atk + stats.spa + SPECIES[u.family].rarity * 15;
      };
      return score(b) - score(a);
    });
    const fielded = favorites.slice(0, player.level);
    const remaining = favorites.slice(player.level);
    fielded.forEach((u, i) => {
      const front = u.family === 'bulbasaur' || u.family === 'squirtle';
      u.position = { area: 'board', col: [3, 2, 4, 1, 5, 0, 6][i], row: front ? 0 : Math.min(3, 2 + Math.floor(i / 4)) };
    });
    remaining.slice(0, BENCH_SIZE).forEach((u, index) => { u.position = { area: 'bench', index }; });
    // AI does not have access to extra bench capacity.
    if (remaining.length > BENCH_SIZE) {
      const extra = new Set(remaining.slice(BENCH_SIZE).map(u => u.id));
      player.units = player.units.filter(u => !extra.has(u.id));
    }
  }

  private startCombat(): void {
    this.phase = 'combat'; this.clock = 0; this.duration = 30;
    const alive = this.rng.shuffle(this.players.filter(p => !p.eliminated));
    this.battles = [];
    this.opponentId = null;
    for (let i = 0; i + 1 < alive.length; i += 2) {
      const a = alive[i], b = alive[i + 1];
      this.battles.push(createBattle(a, b, `r${this.round}:${i}`));
      if (a.id === 'p0') this.opponentId = b.id;
      if (b.id === 'p0') this.opponentId = a.id;
    }
    this.log = this.opponentId ? `Confronto • ${this.players.find(p => p.id === this.opponentId)?.name}` : 'Rodada de combate';
  }

  private finishCombat(): void {
    this.phase = 'result'; this.clock = 0; this.duration = 3.2;
    this.lastCombatStats = {};
    for (const battle of this.battles) {
      forceResolveBattle(battle);
      const combatStats = battleMetrics(battle);
      Object.assign(this.lastCombatStats, combatStats);
      if (!battle.winner || !battle.loser) continue;
      const winner = this.players.find(p => p.id === battle.winner)!;
      const loser = this.players.find(p => p.id === battle.loser)!;
      const damage = 3 + survivors(battle, winner.id) * 2 + Math.floor((this.round - 1) / 5);
      loser.health = Math.max(0, loser.health - damage);
      loser.lastWin = false; loser.streak = Math.min(-1, loser.streak - 1);
      winner.lastWin = true; winner.streak = Math.max(1, winner.streak + 1);
      if (loser.health === 0) loser.eliminated = true;
      if (battle.playerA === 'p0' || battle.playerB === 'p0') {
        this.log = battle.winner === 'p0' ? `Vitória • ${damage} de dano` : `Derrota • -${damage} de vida`;
      }
    }
    const eliminated = this.players.filter(p => p.eliminated && p.placement === null)
      .sort((a, b) => a.health - b.health);
    for (const p of eliminated) p.placement = this.players.filter(q => q.placement === null).length;
    for (const p of this.players) {
      if (p.eliminated) continue;
      for (const unit of p.units) {
        if (unit.position.area !== 'board') continue;
        unit.xp += 1;
        unit.level = Math.min(100, 1 + unit.xp);
      }
    }
    const surviving = this.players.filter(p => !p.eliminated);
    if (surviving.length === 1) {
      this.winnerId = surviving[0].id;
      surviving[0].placement = 1;
      this.phase = 'finished'; this.duration = 0;
      this.log = surviving[0].id === 'p0' ? 'VITÓRIA' : `${surviving[0].name} VENCEU`;
    }
  }

  private nextRound(): void {
    this.round++;
    this.phase = 'planning'; this.clock = 0; this.duration = 19;
    for (const p of this.players) {
      if (p.eliminated) continue;
      const interest = Math.min(3, Math.floor(p.gold / 10));
      p.gold += 5 + interest + (p.lastWin ? 1 : 0);
      p.level = this.levelForRound();
      if (!p.locked) this.refreshShop(p);
      if (p.id !== 'p0') this.runCPU(p);
    }
    this.log = `Preparação • Rodada ${this.round}`;
  }

  tick(dt: number): void {
    if (this.phase === 'finished') return;
    const step = Math.max(0, Math.min(0.1, dt));
    this.clock += step;
    if (this.phase === 'planning' && this.clock >= this.duration) this.startCombat();
    else if (this.phase === 'combat') {
      for (const battle of this.battles) tickBattle(battle, step);
      if (this.battles.every(b => b.resolved) || this.clock >= this.duration) this.finishCombat();
    } else if (this.phase === 'result' && this.clock >= this.duration) this.nextRound();
  }

  snapshot(): GameSnapshot {
    const battle = this.battles.find(b => b.playerA === 'p0' || b.playerB === 'p0') || null;
    const stats = battle ? battleMetrics(battle) : this.lastCombatStats;
    return {
      serial: ++this.serial, phase: this.phase, phaseSeconds: this.duration,
      timeLeft: Math.max(0, this.duration - this.clock), round: this.round,
      chapter: Math.min(10, Math.ceil(this.round / 3)),
      players: this.players.map(p => ({
        ...p, units: p.units.map(u => ({ ...u, iv: { ...u.iv }, position: { ...u.position } })),
        shop: p.id === 'p0' ? p.shop.map(offer => offer && { ...offer }) : []
      })),
      opponentId: this.opponentId,
      visibleBattle: battle ? structuredClone(battle) : null,
      combatStats: stats, log: this.log, winnerId: this.winnerId
    };
  }
}

function samePosition(a: UnitPosition, b: UnitPosition): boolean {
  return a.area === b.area && (a.area === 'board'
    ? b.area === 'board' && a.col === b.col && a.row === b.row
    : b.area === 'bench' && a.index === b.index);
}
